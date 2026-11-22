// The web version's database: the same SQLite schema and the same two calls
// as src-tauri/src/db.rs (`select`, and `batch` = one transaction with
// `{ $lastId: k }` parameters), run by sql.js (SQLite compiled to
// WebAssembly) in memory. After every batch the whole file is written to
// IndexedDB, so a batch that resolved is saved.
//
// Several tabs may be open. Each batch runs under a Web Lock and first checks
// the saved version: if another tab wrote since this one loaded, it reloads
// before writing, so no tab overwrites another's changes. After saving it
// tells the other tabs, which reload and announce a data change.

import type { Database, SqlJsStatic, SqlValue } from 'sql.js';

import type { ExecResult, Param, Row, Stmt } from '@/lib/store/db';

import s001 from '../../src-tauri/schema/001_init.sql?raw';
import s002 from '../../src-tauri/schema/002_study_sessions.sql?raw';
import s003 from '../../src-tauri/schema/003_study_sides.sql?raw';
import s004 from '../../src-tauri/schema/004_folders.sql?raw';

/** Schema steps, counted in `PRAGMA user_version`, as in db.rs. Append only. */
export const MIGRATIONS = [s001, s002, s003, s004];

/** Where the file is kept. The browser's is IndexedDB (persist.ts); tests use memory. */
export interface Persist {
  load(): Promise<{ bytes: Uint8Array; version: number } | null>;
  version(): Promise<number>;
  save(bytes: Uint8Array, version: number): Promise<void>;
  /** Runs `f` holding the write lock every tab shares. */
  exclusive<T>(f: () => Promise<T>): Promise<T>;
}

// The same limits and refusals as check_sql in db.rs.
const MAX_SQL = 200_000;
const FORBIDDEN = new Set(['attach', 'detach', 'vacuum', 'pragma', 'load_extension']);

export function checkSql(sql: string): void {
  if (sql.length > MAX_SQL) throw 'Query too long';
  for (const word of sql.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (FORBIDDEN.has(word)) throw `'${word}' is not allowed`;
  }
}

function bind(p: Param, lastIds: number[]): SqlValue {
  if (p === null || typeof p === 'string' || typeof p === 'number') return p;
  if (typeof p === 'boolean') return p ? 1 : 0;
  const id = lastIds[p.$lastId];
  if (id === undefined) throw '$lastId points past this statement';
  return id;
}

const message = (err: unknown) => (typeof err === 'string' ? err : err instanceof Error ? err.message : String(err));

export type Engine = {
  select<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  batch(statements: Stmt[]): Promise<ExecResult[]>;
  /** Reads the saved file again if another tab changed it; true when it did. */
  refresh(): Promise<boolean>;
};

export function createEngine(SQL: SqlJsStatic, persist: Persist, hooks: { saved?: (version: number) => void } = {}): Engine {
  let db: Database | null = null;
  let version = 0;
  let opening: Promise<Database> | null = null;
  // Writes and reloads run one at a time, in the order they were asked for.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(f: () => Promise<T>): Promise<T> => {
    const run = queue.then(f, f);
    queue = run.catch(() => {});
    return run;
  };

  // Connection settings: after every open, and again after every export
  // (older sql.js versions reopened the connection there, which reset them).
  const configure = (d: Database) => d.run('PRAGMA foreign_keys = ON');

  function migrate(d: Database): boolean {
    const current = Number(d.exec('PRAGMA user_version')[0]?.values[0]?.[0] ?? 0);
    let changed = false;
    for (let i = Math.max(0, current); i < MIGRATIONS.length; i++) {
      d.run('BEGIN');
      try {
        d.exec(MIGRATIONS[i]);
        d.run(`PRAGMA user_version = ${i + 1}`);
        d.run('COMMIT');
      } catch (err) {
        d.run('ROLLBACK');
        throw `migration ${i + 1}: ${message(err)}`;
      }
      changed = true;
    }
    return changed;
  }

  async function load(): Promise<Database> {
    const saved = await persist.load();
    const next = new SQL.Database(saved?.bytes);
    configure(next);
    const migrated = migrate(next);
    db?.close();
    db = next;
    version = saved?.version ?? 0;
    if (migrated) await save();
    return next;
  }

  async function save(): Promise<void> {
    const d = db!;
    const bytes = d.export();
    configure(d);
    await persist.save(bytes, version + 1);
    version += 1;
    hooks.saved?.(version);
  }

  function ready(): Promise<Database> {
    if (db) return Promise.resolve(db);
    opening ??= persist.exclusive(load).catch((err: unknown) => {
      opening = null;
      throw err;
    });
    return opening;
  }

  async function select<T>(sql: string, params: Param[] = []): Promise<T[]> {
    checkSql(sql);
    await ready();
    // The current connection, not the one ready() saw: a reload may have
    // replaced it in between.
    const stmt = db!.prepare(sql);
    try {
      stmt.bind(params.map((p) => bind(p, [])));
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } catch (err) {
      throw message(err);
    } finally {
      stmt.free();
    }
  }

  function batch(statements: Stmt[]): Promise<ExecResult[]> {
    for (const s of statements) checkSql(s.sql);
    return serial(async () => {
      await ready();
      return persist.exclusive(async () => {
        if ((await persist.version()) !== version) await load();
        const d = db!;
        const results: ExecResult[] = [];
        const lastIds: number[] = [];
        d.run('BEGIN');
        try {
          for (const s of statements) {
            const stmt = d.prepare(s.sql);
            try {
              stmt.run((s.params ?? []).map((p) => bind(p, lastIds)));
            } finally {
              stmt.free();
            }
            const rowsAffected = d.getRowsModified();
            const lastInsertId = Number(d.exec('SELECT last_insert_rowid()')[0].values[0][0]);
            lastIds.push(lastInsertId);
            results.push({ rowsAffected, lastInsertId });
          }
          d.run('COMMIT');
        } catch (err) {
          d.run('ROLLBACK');
          throw message(err);
        }
        try {
          await save();
        } catch (err) {
          // Not saved, so not done: go back to what is saved.
          await load().catch(() => {});
          throw message(err);
        }
        return results;
      });
    });
  }

  function refresh(): Promise<boolean> {
    return serial(async () => {
      if (!db) return false;
      if ((await persist.version()) === version) return false;
      await persist.exclusive(load);
      return true;
    });
  }

  return { select, batch, refresh };
}
