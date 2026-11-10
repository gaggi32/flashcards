// An in-memory stand-in for the Rust database (src-tauri/src/db.rs), built on
// node:sqlite with the same schema file and the same batch semantics: one
// transaction per batch, `{ $lastId: k }` parameters, booleans stored as 0/1.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import type { Db, ExecResult, Param, Stmt } from './db';

const SCHEMA = ['001_init.sql'].map((f) =>
  readFileSync(fileURLToPath(new URL(`../../../src-tauri/schema/${f}`, import.meta.url)), 'utf8'),
);

type Bound = string | number | null;

function bind(p: Param, lastIds: number[]): Bound {
  if (p === null || typeof p === 'string' || typeof p === 'number') return p;
  if (typeof p === 'boolean') return p ? 1 : 0;
  const id = lastIds[p.$lastId];
  if (id === undefined) throw new Error('$lastId points past this statement');
  return id;
}

export function testDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const sql of SCHEMA) raw.exec(sql);

  return {
    raw,
    async select<T>(sql: string, params: Param[] = []) {
      const rows = raw.prepare(sql).all(...params.map((p) => bind(p, [])));
      return rows as T[];
    },
    async batch(statements: Stmt[]) {
      const results: ExecResult[] = [];
      const lastIds: number[] = [];
      raw.exec('BEGIN');
      try {
        for (const s of statements) {
          const r = raw.prepare(s.sql).run(...(s.params ?? []).map((p) => bind(p, lastIds)));
          lastIds.push(Number(r.lastInsertRowid));
          results.push({ rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) });
        }
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
      return results;
    },
  };
}
