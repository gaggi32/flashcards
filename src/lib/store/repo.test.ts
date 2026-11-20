import { beforeEach, describe, expect, it } from 'vitest';

import { useDb } from './db';
import { ApiError } from './errors';
import * as repo from './repo';
import { testDb } from './testDb';
import { exportAll, exportSet, importAll, parseExport, setFileName, FORMAT } from './transfer';

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

  it('keeps an empty folder until it is removed', async () => {
    expect(await repo.createFolder('  Uni  ')).toBe('Uni');
    await repo.createFolder('Uni');
    expect(await repo.listFolders()).toEqual(['Uni']);
    const set = await repo.createSet({ title: 'A', folder: 'Uni' });
    await repo.updateSet(set.id, { folder: null });
    expect(await repo.listFolders()).toEqual(['Uni']);
    await repo.renameFolder('Uni', 'School');
    expect(await repo.listFolders()).toEqual(['School']);
    await repo.renameFolder('School', null);
    expect(await repo.listFolders()).toEqual([]);
    await expect(repo.createFolder('   ')).rejects.toThrow();
  });

  it('remembers a folder a set is moved into, but not for a set that is not there', async () => {
    const set = await repo.createSet({ title: 'A' });
    await repo.updateSet(set.id, { folder: 'Lang' });
    await repo.updateSet(set.id, { folder: null });
    expect(await repo.listFolders()).toEqual(['Lang']);
    await expect(repo.updateSet(set.id + 99, { folder: 'Ghost' })).rejects.toThrow();
    expect(await repo.listFolders()).toEqual(['Lang']);
  });

  it('merges a folder renamed into one that exists', async () => {
    await repo.createSet({ title: 'A', folder: 'Uni' });
    await repo.createSet({ title: 'B', folder: 'School' });
    await repo.renameFolder('Uni', 'School');
    expect(await repo.listFolders()).toEqual(['School']);
    expect((await repo.listSets()).map((s) => s.folder)).toEqual(['School', 'School']);
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

  it('lists each set with its learn counts, when it was studied and its first terms', async () => {
    const { set, cards } = await setWith(6);
    const empty = { set: await repo.createSet({ title: 'Empty', description: '', folder: null }) };
    await repo.reviewCard(cards[1].id, 1, TODAY, null); // learning
    await repo.reviewCard(cards[2].id, 5, TODAY, null);
    await repo.reviewCard(cards[2].id, 5, TODAY, 1); // learned
    const list = await repo.listSets();
    const glance = list.find((s) => s.id === set.id)?.glance;
    expect(glance).toMatchObject({ learned: 1, learning: 1, peek: ['t0', 't1', 't2', 't3'] });
    expect(glance?.studiedAt).toEqual(expect.any(String));
    expect(list.find((s) => s.id === empty.set.id)?.glance).toEqual({ learned: 0, learning: 0, studiedAt: null, peek: [] });
  });

  it('counts a streak that ends today or yesterday', () => {
    expect(repo.streakFrom(['2026-11-10', '2026-11-09', '2026-11-07'], TODAY)).toBe(2);
    expect(repo.streakFrom(['2026-11-09', '2026-11-08'], TODAY)).toBe(2);
    expect(repo.streakFrom(['2026-11-05'], TODAY)).toBe(0);
    expect(repo.streakFrom([], TODAY)).toBe(0);
  });
});

describe('reset', () => {
  it('makes every card of the set new again and leaves other sets and the review log alone', async () => {
    const { set, cards } = await setWith(3);
    const other = await setWith(1, 'French');
    await repo.reviewCard(cards[0].id, 5, TODAY, null);
    await repo.reviewCard(cards[1].id, 2, TODAY, null);
    await repo.reviewCard(other.cards[0].id, 5, TODAY, null);
    const logged = (raw.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number }).n;

    expect(await repo.resetProgress(set.id)).toBe(2);
    expect(await repo.learnStats(set.id)).toEqual({ total: 3, new: 3, learning: 0, learned: 0 });
    expect((await repo.learnStats(other.set.id)).new).toBe(0);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number }).n).toBe(logged);
    expect((await repo.getSet(set.id)).cards).toHaveLength(3);
  });

  it('refuses a set that does not exist', async () => {
    await expect(repo.resetProgress(999)).rejects.toBeInstanceOf(ApiError);
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
    expect(res).toMatchObject({ sets: 2, cards: 3, withProgress: 1 });
    const sets = await repo.listSets();
    expect([...res.setIds].sort()).toEqual(sets.map((s) => s.id).sort());
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

describe('sending one set', () => {
  it('holds that set and its cards, not its progress, folder or dates', async () => {
    const { set, cards } = await setWith(3, 'Französisch: Essen');
    await setWith(2, 'other');
    await repo.reviewCard(cards[0].id, 5, TODAY, null);
    raw.prepare('UPDATE sets SET folder = ? WHERE id = ?').run('Schule', set.id);

    const file = await exportSet(set.id);
    expect(file.format).toBe(FORMAT);
    expect(file.sets).toHaveLength(1);
    const [only] = file.sets;
    expect(only.title).toBe('Französisch: Essen');
    expect(only.cards.map((c) => c.term)).toEqual(['t0', 't1', 't2']);
    expect(only.cards.every((c) => c.progress === undefined)).toBe(true);
    expect(only.folder).toBeUndefined();
    expect(only.createdAt).toBeUndefined();
  });

  it('opens as a new set, in the folder showing, and says which', async () => {
    const { set } = await setWith(2, 'Spanish');
    const text = JSON.stringify(await exportSet(set.id));
    const res = await importAll(parseExport(text), { folder: 'Von Lea' });
    expect(res.setIds).toHaveLength(1);
    expect(res.setIds[0]).not.toBe(set.id);
    const copy = await repo.getSet(res.setIds[0]);
    expect(copy.title).toBe('Spanish');
    expect(copy.cards.map((c) => c.definition)).toEqual(['d0', 'd1']);
    expect(raw.prepare('SELECT folder FROM sets WHERE id = ?').get(res.setIds[0])).toEqual({ folder: 'Von Lea' });
    // Opening it twice gives two copies, never an overwrite.
    const again = await importAll(parseExport(text));
    expect(again.setIds[0]).not.toBe(res.setIds[0]);
  });

  it('names the file after the set', () => {
    expect(setFileName('Französisch: Essen & Trinken')).toBe('franzosisch-essen-trinken.json');
    expect(setFileName('???')).toBe('set.json');
  });

  it('refuses a set that is gone', async () => {
    await expect(exportSet(999)).rejects.toThrow('no longer exists');
  });
});
