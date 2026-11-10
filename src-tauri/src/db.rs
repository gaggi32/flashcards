//! The study database: one SQLite file in the per-user app data directory,
//! opened once here and shared by both windows.
//!
//! The webviews send SQL with bound parameters (see `src/lib/store/db.ts`).
//! Card text only ever travels as a parameter, never inside the SQL string, so
//! the guard in [`check_sql`] can refuse the statements this app never needs
//! (ATTACH, VACUUM, PRAGMA, extension loading) without false alarms. That
//! keeps a compromised webview from pointing SQLite at an arbitrary file.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};

pub const FILE: &str = "flashcards.db";

/// Schema steps, applied in order and counted in `PRAGMA user_version`.
/// Never edit a shipped step; append a new one.
const MIGRATIONS: &[&str] = &[
    // Also read by the TypeScript tests (src/lib/store/testDb.ts).
    include_str!("../schema/001_init.sql"),
];

pub struct Db(pub Arc<Mutex<Connection>>);

pub fn path_in(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
    // Schema objects may not call app-defined functions or virtual tables.
    conn.pragma_update(None, "trusted_schema", "OFF").map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
    conn.pragma_update(None, "synchronous", "NORMAL").map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version.max(0) as usize) {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(sql).map_err(|e| format!("migration {}: {e}", i + 1))?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Longest SQL text the UI may send. Its queries are a few hundred bytes; a
/// bulk insert of 2000 cards is ~2000 short placeholder groups.
const MAX_SQL: usize = 200_000;
const MAX_PARAMS: usize = 32_766;

/// Statements the app itself never sends. Matched as whole words, case-blind.
const FORBIDDEN: &[&str] = &["attach", "detach", "vacuum", "pragma", "load_extension"];

pub fn check_sql(sql: &str) -> Result<(), String> {
    if sql.len() > MAX_SQL {
        return Err("Query too long".into());
    }
    let lower = sql.to_ascii_lowercase();
    for word in lower.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')) {
        if FORBIDDEN.contains(&word) {
            return Err(format!("'{word}' is not allowed"));
        }
    }
    Ok(())
}

/// The only things a statement from the UI may do: read and write rows of
/// the app's own tables. Schema changes, ATTACH, PRAGMA and anything else are
/// refused by SQLite itself while it compiles the statement, so this holds no
/// matter how the SQL text is spelled.
const APP_TABLES: &[&str] = &["sets", "cards", "progress", "reviews"];

fn ui_authorizer(ctx: AuthContext<'_>) -> Authorization {
    let own = |t: &str| APP_TABLES.contains(&t);
    match ctx.action {
        AuthAction::Select | AuthAction::Recursive => Authorization::Allow,
        // Reads: the app's tables and the query's own CTEs, never SQLite's
        // internal tables (sqlite_master and friends).
        AuthAction::Read { table_name, .. } if !table_name.starts_with("sqlite_") => Authorization::Allow,
        AuthAction::Insert { table_name } | AuthAction::Delete { table_name } if own(table_name) => {
            Authorization::Allow
        }
        AuthAction::Update { table_name, .. } if own(table_name) => Authorization::Allow,
        AuthAction::Function { function_name } if function_name != "load_extension" => {
            Authorization::Allow
        }
        _ => Authorization::Deny,
    }
}

/// Longest a UI statement may run before SQLite interrupts it, so a runaway
/// query cannot hold the one connection (and both windows) forever.
const UI_TIME_BUDGET: Duration = Duration::from_secs(10);

/// Run `f` with the UI guard on: the authorizer above and the time budget.
fn guarded<T>(conn: &Connection, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    conn.authorizer(Some(ui_authorizer));
    let deadline = Instant::now() + UI_TIME_BUDGET;
    conn.progress_handler(10_000, Some(move || Instant::now() > deadline));
    let out = f();
    conn.progress_handler(0, None::<fn() -> bool>);
    conn.authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
    out
}

fn to_value(j: &Json) -> Result<Value, String> {
    Ok(match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(*b as i64),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().ok_or("Bad number")?),
        },
        Json::String(s) => Value::Text(s.clone()),
        _ => return Err("Parameters must be null, a boolean, a number or a string".into()),
    })
}

fn to_json(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        // The schema has no blobs; never hand raw bytes to the UI.
        ValueRef::Blob(_) => Json::Null,
    }
}

/// A parameter is a plain value, or `{"$lastId": k}`: the row id inserted by
/// statement `k` earlier in the same batch (a new set, then its cards).
fn resolve(j: &Json, last_ids: &[i64]) -> Result<Value, String> {
    if let Json::Object(o) = j {
        if let Some(k) = o.get("$lastId").and_then(Json::as_u64) {
            return last_ids
                .get(k as usize)
                .map(|id| Value::Integer(*id))
                .ok_or_else(|| "$lastId points past this statement".into());
        }
        return Err("Unknown parameter object".into());
    }
    to_value(j)
}

#[derive(Debug, Deserialize)]
pub struct Stmt {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub rows_affected: usize,
    pub last_insert_id: i64,
}

pub fn select(conn: &Connection, sql: &str, params: &[Json]) -> Result<Vec<Map<String, Json>>, String> {
    check_sql(sql)?;
    if params.len() > MAX_PARAMS {
        return Err("Too many parameters".into());
    }
    let values = params.iter().map(to_value).collect::<Result<Vec<_>, _>>()?;
    guarded(conn, || {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query(params_from_iter(values)).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut map = Map::with_capacity(names.len());
            for (i, name) in names.iter().enumerate() {
                map.insert(name.clone(), to_json(row.get_ref(i).map_err(|e| e.to_string())?));
            }
            out.push(map);
        }
        Ok(out)
    })
}

/// Every statement in one transaction: all of them land, or none do.
pub fn batch(conn: &mut Connection, stmts: &[Stmt]) -> Result<Vec<ExecResult>, String> {
    if stmts.len() > 50_000 {
        return Err("Too many statements".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(stmts.len());
    let mut last_ids = Vec::with_capacity(stmts.len());
    // BEGIN above and COMMIT below run unguarded; the UI's statements do not.
    guarded(&tx, || {
    for s in stmts {
        check_sql(&s.sql)?;
        if s.params.len() > MAX_PARAMS {
            return Err("Too many parameters".into());
        }
        let values = s
            .params
            .iter()
            .map(|p| resolve(p, &last_ids))
            .collect::<Result<Vec<_>, _>>()?;
        let n = tx
            .execute(&s.sql, params_from_iter(values))
            .map_err(|e| e.to_string())?;
        let id = tx.last_insert_rowid();
        last_ids.push(id);
        results.push(ExecResult { rows_affected: n, last_insert_id: id });
    }
    Ok(())
    })?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(results)
}

/// A consistent copy of the whole database at `dest` (SQLite's own snapshot).
pub fn backup_to(conn: &Connection, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        std::fs::remove_file(dest).map_err(|e| e.to_string())?;
    }
    let target = dest.to_str().ok_or("Backup path is not valid UTF-8")?;
    conn.execute("VACUUM INTO ?1", [target]).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn migrations_run_once_and_count() {
        let conn = mem();
        migrate(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
    }

    #[test]
    fn refuses_file_reaching_statements() {
        assert!(check_sql("ATTACH DATABASE '/tmp/x' AS x").is_err());
        assert!(check_sql("vacuum into 'x'").is_err());
        assert!(check_sql("SELECT load_extension('x')").is_err());
        assert!(check_sql("PRAGMA writable_schema=1").is_err());
        // A column or table that merely contains the word is fine.
        assert!(check_sql("SELECT attached_count FROM sets").is_ok());
    }

    #[test]
    fn the_authorizer_refuses_schema_changes_however_spelled() {
        let mut conn = mem();
        let run = |conn: &mut Connection, sql: &str| batch(conn, &[Stmt { sql: sql.into(), params: vec![] }]);
        assert!(run(&mut conn, "CREATE TRIGGER t AFTER INSERT ON cards BEGIN DELETE FROM sets; END").is_err());
        assert!(run(&mut conn, "DROP TABLE cards").is_err());
        assert!(run(&mut conn, "CREATE TABLE x (a)").is_err());
        assert!(run(&mut conn, "DELETE FROM sqlite_sequence").is_err());
        assert!(select(&conn, "SELECT sql FROM sqlite_master", &[]).is_err());
        // Ordinary work still goes through, and the guard is off again afterwards.
        assert!(run(&mut conn, "INSERT INTO sets (title, created_at, updated_at) VALUES ('ok','n','n')").is_ok());
        assert!(conn.execute_batch("CREATE TABLE internal_ok (a)").is_ok());
    }

    #[test]
    fn a_runaway_query_is_interrupted() {
        let conn = mem();
        let started = Instant::now();
        let r = select(
            &conn,
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n",
            &[],
        );
        let err = r.expect_err("an endless query must be stopped");
        assert!(err.contains("interrupt"), "stopped for the wrong reason: {err}");
        assert!(started.elapsed() >= UI_TIME_BUDGET);
        assert!(started.elapsed() < UI_TIME_BUDGET + Duration::from_secs(5));
    }

    #[test]
    fn batch_links_rows_and_rolls_back_on_error() {
        let mut conn = mem();
        let ok = batch(
            &mut conn,
            &[
                Stmt {
                    sql: "INSERT INTO sets (title, created_at, updated_at) VALUES (?1, 'n', 'n')".into(),
                    params: vec![Json::from("A")],
                },
                Stmt {
                    sql: "INSERT INTO cards (set_id, term, definition, created_at, updated_at) VALUES (?1, 't', 'd', 'n', 'n')".into(),
                    params: vec![serde_json::json!({"$lastId": 0})],
                },
            ],
        )
        .unwrap();
        assert_eq!(ok.len(), 2);

        let bad = batch(
            &mut conn,
            &[
                Stmt { sql: "INSERT INTO sets (title, created_at, updated_at) VALUES ('B', 'n', 'n')".into(), params: vec![] },
                Stmt { sql: "INSERT INTO nope VALUES (1)".into(), params: vec![] },
            ],
        );
        assert!(bad.is_err());
        let sets = select(&conn, "SELECT COUNT(*) AS n FROM sets", &[]).unwrap();
        assert_eq!(sets[0]["n"], Json::from(1));
    }

    #[test]
    fn deleting_a_set_takes_its_cards_and_progress() {
        let mut conn = mem();
        batch(
            &mut conn,
            &[
                Stmt { sql: "INSERT INTO sets (title, created_at, updated_at) VALUES ('A','n','n')".into(), params: vec![] },
                Stmt { sql: "INSERT INTO cards (set_id, term, definition, created_at, updated_at) VALUES (1,'t','d','n','n')".into(), params: vec![] },
                Stmt { sql: "INSERT INTO progress VALUES (1, 1, 2.5, 1, '2026-01-01', NULL)".into(), params: vec![] },
                Stmt { sql: "DELETE FROM sets WHERE id = 1".into(), params: vec![] },
            ],
        )
        .unwrap();
        let n = select(&conn, "SELECT (SELECT COUNT(*) FROM cards) + (SELECT COUNT(*) FROM progress) AS n", &[]).unwrap();
        assert_eq!(n[0]["n"], Json::from(0));
    }
}
