// The bridge to the SQLite database Rust owns (src-tauri/src/db.rs).
//
// Two calls: `select` for reads and `batch` for writes, where a batch runs in
// one transaction. Card text always goes in as a bound `?` parameter. Tests
// swap in a node:sqlite database with the same schema (testDb.ts).

import { invoke } from '@tauri-apps/api/core';

export type Row = Record<string, unknown>;
/** A bound value, or the row id inserted by statement `$lastId` of this batch. */
export type Param = string | number | boolean | null | { $lastId: number };
export type Stmt = { sql: string; params?: Param[] };
export type ExecResult = { rowsAffected: number; lastInsertId: number };

export interface Db {
  select<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  batch(statements: Stmt[]): Promise<ExecResult[]>;
}

const tauriDb: Db = {
  select: <T,>(sql: string, params: Param[] = []) => invoke<T[]>('db_select', { sql, params }),
  batch: (statements: Stmt[]) =>
    invoke<ExecResult[]>('db_batch', {
      statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
    }),
};

let current: Db = tauriDb;

export function db(): Db {
  return current;
}

/** Tests only. */
export function useDb(next: Db): void {
  current = next;
}
