// The web version's database (engine.ts) under the store the screens use:
// the same batch semantics as db.rs, saved after every batch, foreign keys
// on (deleting a set takes its cards along), and two tabs writing in turn
// without losing each other's changes.

import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { useDb } from '@/lib/store/db';
import * as repo from '@/lib/store/repo';
import { exportAll, importAll } from '@/lib/store/transfer';
import { MIGRATIONS, checkSql, createEngine, type Persist } from './engine';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

/** IndexedDB as the engine sees it, in memory; one per "browser". */
function memoryStore() {
  let file: { bytes: Uint8Array; version: number } | null = null;
  let saves = 0;
  let lock = Promise.resolve();
  const persist: Persist = {
    load: async () => (file ? { bytes: file.bytes.slice(), version: file.version } : null),
    version: async () => file?.version ?? 0,
    save: async (bytes, version) => {
      file = { bytes: bytes.slice(), version };
      saves++;
    },
    exclusive<T>(f: () => Promise<T>) {
      const run = lock.then(f);
      lock = run.then(
        () => {},
        () => {},
      );
      return run;
    },
  };
  return { persist, saves: () => saves };
}

let store: ReturnType<typeof memoryStore>;
beforeEach(() => {
  store = memoryStore();
  useDb(createEngine(SQL, store.persist));
});

describe('the web database', () => {
  it('starts on the full schema and saves it', async () => {
    const tabs = await createEngine(SQL, store.persist).select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(tabs.map((t) => t.name)).toEqual(
      expect.arrayContaining(['cards', 'folders', 'progress', 'reviews', 'sets', 'study_sessions', 'study_sides']),
    );
    expect(store.saves()).toBe(1);
    expect(MIGRATIONS).toHaveLength(4);
  });

  it('runs a batch as one transaction with $lastId, and saves it', async () => {
    const db = createEngine(SQL, store.persist);
    const res = await db.batch([
      { sql: "INSERT INTO sets (title, created_at, updated_at) VALUES (?, '2026-01-01', '2026-01-01')", params: ['A'] },
      {
        sql: "INSERT INTO cards (set_id, term, definition, position, created_at, updated_at) VALUES (?, 't', 'd', 0, '2026-01-01', '2026-01-01')",
        params: [{ $lastId: 0 }],
      },
    ]);
    expect(res[0]).toEqual({ rowsAffected: 1, lastInsertId: 1 });
    expect(res[1]).toEqual({ rowsAffected: 1, lastInsertId: 1 });
    await expect(
      db.batch([
        { sql: "INSERT INTO sets (title, created_at, updated_at) VALUES ('B', '2026-01-01', '2026-01-01')" },
        { sql: 'INSERT INTO nowhere VALUES (1)' },
      ]),
    ).rejects.toMatch(/nowhere/);
    // Reopened from what was saved: the failed batch left nothing.
    const again = createEngine(SQL, store.persist);
    expect(await again.select('SELECT title FROM sets')).toEqual([{ title: 'A' }]);
  });

  it('refuses what db.rs refuses', () => {
    expect(() => checkSql('PRAGMA foreign_keys = OFF')).toThrow();
    expect(() => checkSql("ATTACH 'x' AS y")).toThrow();
    expect(() => checkSql('SELECT * FROM sets')).not.toThrow();
  });

  it('has foreign keys on, so deleting a set deletes its cards and their progress', async () => {
    const set = await repo.createSet({ title: 'Spanish' });
    const [card] = await repo.addCards(set.id, [{ term: 'hola', definition: 'hello' }]);
    await repo.reviewCard(card.id, 5, '2026-11-22');
    await repo.deleteSet(set.id);
    const db = createEngine(SQL, store.persist);
    expect(await db.select('SELECT COUNT(*) AS n FROM cards')).toEqual([{ n: 0 }]);
    expect(await db.select('SELECT COUNT(*) AS n FROM progress')).toEqual([{ n: 0 }]);
  });

  it('round-trips an export file into a fresh browser', async () => {
    const set = await repo.createSet({ title: 'Capitals', folder: 'Geo' });
    await repo.addCards(set.id, [
      { term: 'France', definition: 'Paris' },
      { term: 'Italy', definition: 'Rome' },
    ]);
    const file = await exportAll();

    useDb(createEngine(SQL, memoryStore().persist));
    const res = await importAll(file);
    expect(res).toMatchObject({ sets: 1, cards: 2 });
    const [summary] = await repo.listSets();
    expect(summary).toMatchObject({ title: 'Capitals', folder: 'Geo', cardCount: 2 });
  });

  it('two tabs writing in turn keep both changes', async () => {
    const a = createEngine(SQL, store.persist);
    const b = createEngine(SQL, store.persist);
    const add = (title: string) => [
      { sql: "INSERT INTO sets (title, created_at, updated_at) VALUES (?, '2026-01-01', '2026-01-01')", params: [title] },
    ];
    await a.select('SELECT 1');
    await b.select('SELECT 1');
    await a.batch(add('from a'));
    await b.batch(add('from b')); // b loaded before a wrote: it must catch up first
    await a.batch(add('from a again'));
    const titles = (await createEngine(SQL, store.persist).select<{ title: string }>('SELECT title FROM sets ORDER BY id')).map(
      (r) => r.title,
    );
    expect(titles).toEqual(['from a', 'from b', 'from a again']);
    // And a tab that only reads catches up when asked.
    expect(await b.refresh()).toBe(true);
    expect(await b.select('SELECT COUNT(*) AS n FROM sets')).toEqual([{ n: 3 }]);
  });
});
