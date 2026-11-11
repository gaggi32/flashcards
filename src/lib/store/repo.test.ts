import { beforeEach, describe, expect, it } from 'vitest';

import { useDb } from './db';
import { ApiError } from './errors';
import * as repo from './repo';
import { testDb } from './testDb';
import { exportAll, importAll, parseExport, FORMAT } from './transfer';

const TODAY = '2026-11-10';

let raw: ReturnType<typeof testDb>['raw'];

beforeEach(() => {
  const t = testDb();
  raw = t.raw;
  useDb(t);
});

async function setWith(n: number, title = 'Spanish') {
  const set = await repo.createSet({ title, description: '', folder: null });
  const cards = await repo.addCards(
    set.id,
    Array.from({ length: n }, (_, i) => ({ term: `t${i}`, definition: `d${i}` })),
  );
  return { set, cards };
}

describe('sets and cards', () => {
  it('creates, lists and reads a set with its cards in order', async () => {
    const { set, cards } = await setWith(3);
    expect(cards.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(cards.map((c) => c.term)).toEqual(['t0', 't1', 't2']);
    const list = await repo.listSets();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Spanish', cardCount: 3, description: null, isOwner: true });
    const full = await repo.getSet(set.id);
    expect(full.cards.map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });

  it('returns real ids for a bulk add bigger than one INSERT', async () => {
    const { set, cards } = await setWith(1203);
    const full = await repo.getSet(set.id);
    expect(cards.map((c) => c.id)).toEqual(full.cards.map((c) => c.id));
  });

  it('rejects empty sides and missing sets the way the API did', async () => {
    const { set } = await setWith(0 + 1);
    await expect(repo.addCards(set.id, [{ term: ' ', definition: 'x' }])).rejects.toMatchObject({ status: 400 });
    await expect(repo.addCards(999, [{ term: 'a', definition: 'b' }])).rejects.toMatchObject({ status: 404 });
    await expect(repo.createSet({ title: '' })).rejects.toBeInstanceOf(ApiError);
  });

  it('applies the editor save in one go and ignores ids from another set', async () => {
    const a = await setWith(3);
    const b = await setWith(1, 'Other');
    const res = await repo.patchCards(a.set.id, {
      remove: [a.cards[0].id, b.cards[0].id],
      update: [{ id: a.cards[1].id, term: 'changed' }],
    });
    expect(res).toEqual({ removed: 1, updated: 1 });
    expect((await repo.getSet(b.set.id)).cards).toHaveLength(1);
    expect((await repo.getSet(a.set.id)).cards.map((c) => c.term)).toEqual(['changed', 't2']);
  });

  it('keeps card text as data, never as SQL', async () => {
    const { set } = await setWith(1);
    const evil = "x'); DROP TABLE cards; --";
    await repo.addCards(set.id, [{ term: evil, definition: 'y' }]);
    expect((await repo.getSet(set.id)).cards.at(-1)?.term).toBe(evil);
  });

  it('renames and dissolves folders', async () => {
    await repo.createSet({ title: 'A', folder: 'Uni' });
    await repo.createSet({ title: 'B', folder: 'Uni' });
    expect(await repo.listFolders()).toEqual(['Uni']);
    expect(await repo.renameFolder('Uni', 'School')).toBe(2);
    expect(await repo.listFolders()).toEqual(['School']);
    await repo.renameFolder('School', null);
    expect(await repo.listFolders()).toEqual([]);
  });

  it('deleting a set removes its cards and their progress', async () => {
    const { set, cards } = await setWith(2);
    await repo.reviewCard(cards[0].id, 5, TODAY, null);
    await repo.deleteSet(set.id);
    const n = raw.prepare('SELECT (SELECT COUNT(*) FROM cards) + (SELECT COUNT(*) FROM progress) AS n').get() as { n: number };
    expect(n.n).toBe(0);
  });
});

describe('learning', () => {
  it('stores SM-2 steps and counts each answer once', async () => {
    const { set, cards } = await setWith(3);
    const first = await repo.reviewCard(cards[0].id, 5, TODAY, null);
    expect(first.rescheduled).toBe(true);
    expect(first.progress?.repetitionNumber).toBe(1);
    // A retry carrying the old streak changes nothing.
    const retry = await repo.reviewCard(cards[0].id, 5, TODAY, null);
    expect(retry.rescheduled).toBe(false);
    await repo.reviewCard(cards[0].id, 5, TODAY, 1);
    expect(await repo.learnStats(set.id)).toEqual({ total: 3, new: 2, learning: 0, learned: 1 });
    const queue = await repo.learnQueue(set.id);
    expect(queue.map((c) => c.status)).toEqual(['new', 'new', 'learned']);
  });

  it('counts a set by learn status, without dates', async () => {
    const { set, cards } = await setWith(5);
    const other = await setWith(2);
    await repo.reviewCard(cards[3].id, 1, '2026-11-08', null); // missed: still learning
    await repo.reviewCard(cards[4].id, 5, TODAY, null);
    await repo.reviewCard(cards[4].id, 5, TODAY, 1); // two right: learned
    expect(await repo.overview(TODAY, set.id)).toEqual({ fresh: 3, learning: 1, learned: 1, streak: 1, answeredToday: true });
    expect((await repo.overview(TODAY, other.set.id)).fresh).toBe(2);
  });

  it('counts a streak that ends today or yesterday', () => {
    expect(repo.streakFrom(['2026-11-10', '2026-11-09', '2026-11-07'], TODAY)).toBe(2);
    expect(repo.streakFrom(['2026-11-09', '2026-11-08'], TODAY)).toBe(2);
    expect(repo.streakFrom(['2026-11-05'], TODAY)).toBe(0);
    expect(repo.streakFrom([], TODAY)).toBe(0);
  });
});

describe('export and import', () => {
  it('round-trips sets, cards and progress', async () => {
    const { cards } = await setWith(3);
    await repo.createSet({ title: 'Empty', folder: 'F' });
    await repo.reviewCard(cards[1].id, 4, TODAY, null);
    const file = await exportAll();
    const text = JSON.stringify(file);

    useDb(testDb());
    const res = await importAll(parseExport(text));
    expect(res).toEqual({ sets: 2, cards: 3, withProgress: 1 });
    const sets = await repo.listSets();
    expect(sets.map((s) => s.title).sort()).toEqual(['Empty', 'Spanish']);
    const spanish = sets.find((s) => s.title === 'Spanish')!;
    const queue = await repo.learnQueue(spanish.id);
    expect(queue.find((c) => c.term === 't1')?.progress?.repetitionNumber).toBe(1);
  });

  it('refuses files that are not exports, with a reason', () => {
    expect(() => parseExport('nope')).toThrow('not JSON');
    expect(() => parseExport('{"format":"other"}')).toThrow('not a Flashcards export');
    const bad = JSON.stringify({ format: FORMAT, version: 1, sets: [{ title: 'x', cards: [{ term: '', definition: 'y' }] }] });
    expect(() => parseExport(bad)).toThrow('sets.0.cards.0.term');
  });

  it('still reads exports made before the format was renamed', () => {
    const old = JSON.stringify({ format: '404canvas-flashcards', version: 1, sets: [{ title: 'x', cards: [{ term: 'a', definition: 'b' }] }] });
    expect(parseExport(old).sets[0].title).toBe('x');
  });
});
