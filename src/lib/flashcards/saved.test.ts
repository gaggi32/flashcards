// Unfinished rounds in the database (study_sessions), against the test store:
// saving and loading each mode, rebuilding a round over cards edited or
// deleted since, and the one-time carry-over from the 0.1.14 localStorage
// snapshots, which held the whole session with its card text.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mark, move, startDeck, type Deck } from './deck';
import {
  advance,
  answerChoice,
  answerWritten,
  currentCard,
  giveUp,
  resumeCheckpoint,
  startLearn,
  type LearnSession,
} from './learn';
import {
  TEST_KEPT_MS,
  isLegacySessionKey,
  legacySnapshots,
  packLearn,
  packWrite,
  unpackLearn,
  unpackTest,
  unpackWrite,
} from './saved';
import { TEST_KINDS, answer, buildTest, finish, matchPair } from './test';
import type { LearnCardDTO } from './types';
import { advance as next, dontKnow, startSession, submitAnswer, type WriteSession } from './write';
import { testDb } from '@/lib/store/testDb';

/** localStorage as the webview has it: the items are the own keys. */
class FakeStorage {
  [key: string]: unknown;
  getItem(key: string): string | null {
    return Object.hasOwn(this, key) ? String(this[key]) : null;
  }
  setItem(key: string, value: string) {
    this[key] = String(value);
  }
  removeItem(key: string) {
    delete this[key];
  }
}

/** The same every run. */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

// client.ts keeps its queue and the carry-over per window, so each test gets
// a fresh copy of it, wired to a fresh database. settings.json is Rust's, so
// the one flag the carry-over reads and sets stands in for it here.
type Client = typeof import('./client');
type Repo = typeof import('@/lib/store/repo');
let client: Client;
let repo: Repo;
let db: ReturnType<typeof testDb>;
let raw: ReturnType<typeof testDb>['raw'];
let storage: FakeStorage;
const settingsFile = { sessionsCarriedOver: false, failMark: false };

/** A fresh start of the app: new window code, same database, settings and localStorage. */
async function restart() {
  vi.resetModules();
  vi.doMock('@/lib/app/native', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/app/native')>()),
    getSettings: async () => ({ sessionsCarriedOver: settingsFile.sessionsCarriedOver }),
    markSessionsCarriedOver: async () => {
      if (settingsFile.failMark) throw new Error('disk full');
      settingsFile.sessionsCarriedOver = true;
      return {};
    },
  }));
  (await import('@/lib/store/db')).useDb(db);
  repo = await import('@/lib/store/repo');
  client = await import('./client');
}

beforeEach(async () => {
  storage = new FakeStorage();
  vi.stubGlobal('localStorage', storage);
  settingsFile.sessionsCarriedOver = false;
  settingsFile.failMark = false;
  db = testDb();
  raw = db.raw;
  await restart();
});

async function setWith(n: number, title = 'Spanish') {
  const set = await repo.createSet({ title, description: '', folder: null });
  const cards = await repo.addCards(
    set.id,
    Array.from({ length: n }, (_, i) => ({ term: `term ${i}`, definition: `definition ${i}` })),
  );
  return { setId: set.id, cards };
}

const rows = () =>
  raw.prepare('SELECT set_id, mode, data FROM study_sessions ORDER BY set_id, mode').all() as {
    set_id: number;
    mode: string;
    data: string;
  }[];

/** A Learn session a few answers in, with a multiple-choice question up. */
async function learnUnderway(setId: number, random = seeded()) {
  const queue = await repo.learnQueue(setId);
  const pool = (await repo.getSet(setId)).cards;
  let s = startLearn(queue, pool, 'term', random);
  for (let i = 0; i < 3; i++) {
    const card = currentCard(s)!;
    s = s.question?.kind === 'choice' ? answerChoice(s, card.id, 1500) : answerWritten(s, card.term, 1500);
    s = advance(s, random);
  }
  s = giveUp(s);
  s = advance(s, random);
  return { s, queue, pool };
}

describe('a round is kept per set and mode', () => {
  it('saves and loads each mode, card ids only', async () => {
    const { setId, cards } = await setWith(6);
    const ids = cards.map((c) => c.id);

    let deck = startDeck(ids, false);
    deck = mark(mark(deck, 'known'), 'missed');
    client.saveDeck(setId, deck);

    let write = startSession(cards, { answerWith: 'term', shuffled: false });
    // What was typed is kept (the screen shows it); capitals so it isn't the card's text.
    write = submitAnswer(write, 'TERM 0');
    expect(write.step.kind).toBe('correct');
    client.saveWrite(setId, write);

    const { s: learn, queue, pool } = await learnUnderway(setId);
    client.saveLearn(setId, learn);

    // Loads wait for this window's saves, so no flush is needed.
    expect(await client.loadDeck(setId, ids)).toEqual(deck);
    expect(packWrite((await client.loadWrite(setId, cards))!.session)).toEqual(packWrite(write));
    const back = (await client.loadLearn(setId, queue, pool))!.session;
    expect(packLearn(back)).toEqual(packLearn(learn));
    expect(back.question).toEqual(learn.question);

    expect(rows().map((r) => r.mode)).toEqual(['cards', 'learn', 'write']);
    for (const r of rows()) expect(r.data).not.toMatch(/term \d|definition \d/);
  });

  it('forgets a finished round, and a round of a set that is gone', async () => {
    const { setId, cards } = await setWith(2);
    let deck = startDeck(
      cards.map((c) => c.id),
      false,
    );
    client.saveDeck(setId, deck);
    deck = mark(mark(deck, 'known'), 'known');
    expect(deck.done).toBe(true);
    client.saveDeck(setId, deck);
    expect(await client.loadDeck(setId, [])).toBeNull();
    expect(rows()).toEqual([]);

    client.saveDeck(setId, startDeck([cards[0].id], false));
    await client.loadDeck(setId, []);
    expect(rows()).toHaveLength(1);
    await repo.deleteSet(setId);
    expect(rows()).toEqual([]);
    // Saving for a deleted set keeps nothing and breaks nothing.
    client.saveDeck(setId, startDeck([cards[1].id], false));
    expect(await client.loadDeck(setId, [cards[1].id])).toBeNull();
  });

  it('keeps saves in the order they were made', async () => {
    const { setId, cards } = await setWith(5);
    const ids = cards.map((c) => c.id);
    let deck = startDeck(ids, false);
    for (let i = 0; i < 4; i++) {
      deck = move(deck, 1);
      client.saveDeck(setId, deck);
    }
    expect((await client.loadDeck(setId, ids))!.index).toBe(4);
  });

  it('writes nothing when a screen saves what it just loaded', async () => {
    const { setId, cards } = await setWith(3);
    const ids = cards.map((c) => c.id);
    client.saveDeck(setId, startDeck(ids, false));
    const loaded = (await client.loadDeck(setId, ids))!;
    raw.prepare("UPDATE study_sessions SET updated_at = 'untouched'").run();
    client.saveDeck(setId, loaded);
    await client.loadDeck(setId, ids);
    expect(raw.prepare('SELECT updated_at FROM study_sessions').get()).toEqual({ updated_at: 'untouched' });
  });

  it("resetting Learn drops Learn's round and leaves the others", async () => {
    const { setId, cards } = await setWith(5);
    client.saveDeck(setId, startDeck(cards.map((c) => c.id), false));
    client.saveWrite(setId, startSession(cards, { answerWith: 'term', shuffled: false }));
    client.saveLearn(setId, (await learnUnderway(setId)).s);
    await client.resetLearnProgress(setId);
    expect(rows().map((r) => r.mode)).toEqual(['cards', 'write']);
  });
});

describe('a round over cards changed since', () => {
  it('Flashcards drops deleted cards and stays on the card it was on', async () => {
    const { setId, cards } = await setWith(5);
    const ids = cards.map((c) => c.id);
    let deck: Deck = startDeck(ids, false);
    deck = mark(mark(mark(deck, 'known'), 'missed'), 'known'); // on card 3
    client.saveDeck(setId, deck);
    await repo.deleteCard(ids[1]);
    const back = (await client.loadDeck(setId, ids.filter((id) => id !== ids[1])))!;
    expect(back.order).toEqual([ids[0], ids[2], ids[3], ids[4]]);
    expect(back.order[back.index]).toBe(ids[3]);
    expect(back.marks).toEqual({ [ids[0]]: 'known', [ids[2]]: 'known' });

    // The card on screen deleted: on to the next one; every card deleted: no round.
    expect((await client.loadDeck(setId, [ids[0], ids[4]]))!.order).toEqual([ids[0], ids[4]]);
    expect(await client.loadDeck(setId, [])).toBeNull();
  });

  it('Write shows edited text and drops deleted cards', async () => {
    const { setId, cards } = await setWith(4);
    let write = startSession(cards, { answerWith: 'term', shuffled: false });
    write = next(submitAnswer(write, 'term 0'));
    write = dontKnow(write); // card 1 missed, its answer showing
    client.saveWrite(setId, write);

    await repo.updateCard(cards[2].id, { term: 'edited' });
    await repo.deleteCard(cards[1].id);
    const now = (await repo.getSet(setId)).cards;
    const back = (await client.loadWrite(setId, now))!.session;
    expect(back.cards.map((c) => c.term)).toEqual(['term 0', 'edited', 'term 3']);
    expect(back.queue).toEqual([cards[0].id, cards[2].id, cards[3].id]);
    // The card whose answer was showing is gone: the next one is asked.
    expect(back.index).toBe(1);
    expect(back.step).toEqual({ kind: 'ask' });
    expect(back.missed).toEqual([]);

    // The rest of the round deleted: the round is over, with its misses.
    const ended = unpackWrite(packWrite(write), [cards[0]])!;
    expect(ended.step).toEqual({ kind: 'summary' });
    expect(ended.rounds).toHaveLength(1);
  });

  it('Learn shows edited text, asks afresh when an option is gone, and drops deleted cards', async () => {
    const { setId } = await setWith(8);
    const { s } = await learnUnderway(setId);
    // Go on to a multiple-choice question, then delete one of its wrong options.
    let asking: LearnSession = s;
    const random = seeded(3);
    for (let i = 0; i < 50 && !(asking.step.kind === 'ask' && asking.question?.kind === 'choice'); i++) {
      asking = asking.step.kind === 'checkpoint' ? resumeCheckpoint(asking, random) : advance(giveUp(asking), random);
    }
    if (asking.step.kind !== 'ask' || asking.question?.kind !== 'choice') throw new Error('no choice question came up');
    client.saveLearn(setId, asking);
    const answer = currentCard(asking)!;
    const wrong = asking.question.options.find((o) => o.id !== answer.id)!;

    await repo.updateCard(answer.id, { term: 'edited answer' });
    await repo.deleteCard(wrong.id);
    const queue = await repo.learnQueue(setId);
    const pool = (await repo.getSet(setId)).cards;
    const back = (await client.loadLearn(setId, queue, pool))!.session;
    expect(back.turns.some((t) => t.card.id === wrong.id)).toBe(false);
    expect(back.cards.some((c) => c.id === wrong.id)).toBe(false);
    expect(currentCard(back)!.id).toBe(answer.id);
    expect(currentCard(back)!.term).toBe('edited answer');
    expect(back.step).toEqual({ kind: 'ask', hinted: false });
    if (back.question?.kind === 'choice') {
      expect(back.question.options.some((o) => o.id === wrong.id)).toBe(false);
      expect(back.question.options.find((o) => o.id === answer.id)!.term).toBe('edited answer');
    }

    // The card being asked deleted: the next turn is asked.
    await repo.deleteCard(answer.id);
    const q2 = await repo.learnQueue(setId);
    const again = unpackLearn(packLearn(asking), q2, (await repo.getSet(setId)).cards)!;
    expect(again.turns.some((t) => t.card.id === answer.id)).toBe(false);
    expect(['ask', 'checkpoint']).toContain(again.step.kind);
    if (again.step.kind === 'ask') expect(again.question).not.toBeNull();
    // Nothing left of it at all: no session.
    expect(unpackLearn(packLearn(asking), [], [])).toBeNull();
  });

  it('a row that is not a round loads as none', async () => {
    const { setId, cards } = await setWith(2);
    raw.prepare("INSERT INTO study_sessions VALUES (?, 'write', '{\"cardIds\":\"x\"}', 'n')").run(setId);
    raw.prepare("INSERT INTO study_sessions VALUES (?, 'learn', 'not json', 'n')").run(setId);
    expect(await client.loadWrite(setId, cards)).toBeNull();
    expect(await client.loadLearn(setId, [], cards)).toBeNull();
  });
});

describe('the carry-over from localStorage', () => {
  /** What 0.1.14 saved: JSON.stringify of the live session, card text and all. */
  const legacy = (session: unknown) => JSON.stringify(session);

  it('moves every snapshot in, card ids only, and removes the keys', async () => {
    const a = await setWith(6, 'A');
    const b = await setWith(6, 'B');
    const ids = a.cards.map((c) => c.id);

    const deck = mark(startDeck(ids, true, seeded()), 'missed');
    let write: WriteSession = startSession(a.cards, { answerWith: 'definition', shuffled: true }, seeded());
    write = submitAnswer(write, 'wrong');
    const { s: learn, queue, pool } = await learnUnderway(a.setId);
    expect(learn.question).not.toBeNull();

    storage.setItem(`fc-deck-session-${a.setId}`, legacy(deck));
    storage.setItem(`fc-write-session-${a.setId}`, legacy(write));
    storage.setItem(`fc-session-${a.setId}`, legacy(learn));
    // Set B: only dated Learn keys, from before sessions were kept per set.
    const { s: older } = await learnUnderway(b.setId, seeded(1));
    const { s: newer } = await learnUnderway(b.setId, seeded(2));
    storage.setItem(`fc-session-${b.setId}-2026-10-01`, legacy(older));
    storage.setItem(`fc-session-${b.setId}-2026-10-03`, legacy(newer));
    // Keys that are not sessions stay.
    storage.setItem('flashcards:theme', '{"theme":"dark"}');

    await client.carryOverSessions();

    expect(Object.keys(storage)).toEqual(['flashcards:theme']);
    expect(rows().map((r) => `${r.set_id}:${r.mode}`)).toEqual([
      `${a.setId}:cards`,
      `${a.setId}:learn`,
      `${a.setId}:write`,
      `${b.setId}:learn`,
    ]);
    for (const r of rows()) expect(r.data).not.toMatch(/term \d|definition \d/);

    // Each comes back as the round it was.
    expect(await client.loadDeck(a.setId, ids)).toEqual(deck);
    expect(packWrite((await client.loadWrite(a.setId, a.cards))!.session)).toEqual(packWrite(write));
    const backLearn = (await client.loadLearn(a.setId, queue, pool))!.session;
    expect(packLearn(backLearn)).toEqual(packLearn(learn));
    expect(backLearn.step).toEqual(learn.step);
    const qb = await repo.learnQueue(b.setId);
    const backB = (await client.loadLearn(b.setId, qb, (await repo.getSet(b.setId)).cards))!.session;
    expect(packLearn(backB)).toEqual(packLearn(newer));
  });

  it('runs before the first load, so a screen never starts over a waiting round', async () => {
    const { setId, cards } = await setWith(3);
    const write = submitAnswer(startSession(cards, { answerWith: 'term', shuffled: false }), 'term 0');
    storage.setItem(`fc-write-session-${setId}`, legacy(write));
    const back = await client.loadWrite(setId, cards);
    expect(back && packWrite(back.session)).toEqual(packWrite(write));
    expect(storage.getItem(`fc-write-session-${setId}`)).toBeNull();
  });

  it('never replaces a round the database already has', async () => {
    const { setId, cards } = await setWith(3);
    const mine = startSession(cards, { answerWith: 'term', shuffled: false });
    await repo.saveSession(setId, 'write', packWrite(mine));
    const old = submitAnswer(startSession(cards, { answerWith: 'definition', shuffled: false }), 'x');
    storage.setItem(`fc-write-session-${setId}`, legacy(old));

    await client.carryOverSessions();
    expect(packWrite((await client.loadWrite(setId, cards))!.session)).toEqual(packWrite(mine));
    expect(storage.getItem(`fc-write-session-${setId}`)).toBeNull();
  });

  it('happens once: keys left behind never bring back a round finished since', async () => {
    const { setId, cards } = await setWith(3);
    const write = submitAnswer(startSession(cards, { answerWith: 'term', shuffled: false }), 'TERM 0');
    const key = `fc-write-session-${setId}`;
    storage.setItem(key, legacy(write));
    expect(await client.loadWrite(setId, cards)).not.toBeNull();
    expect(settingsFile.sessionsCarriedOver).toBe(true);

    // The round is finished, and the webview lost the removal of the old key.
    client.clearSession(setId, 'write');
    await client.loadWrite(setId, cards);
    expect(rows()).toEqual([]);
    storage.setItem(key, legacy(write));

    await restart();
    expect(await client.loadWrite(setId, cards)).toBeNull();
    expect(rows()).toEqual([]);
    expect(storage.getItem(key)).toBeNull(); // still cleaned up
  });

  it('sets the flag only once the rows are in, and tries again until it is set', async () => {
    const { setId, cards } = await setWith(3);
    const write = submitAnswer(startSession(cards, { answerWith: 'term', shuffled: false }), 'TERM 0');
    const key = `fc-write-session-${setId}`;
    storage.setItem(key, legacy(write));

    // The import fails: no flag, keys kept, and the screen says so.
    const batch = db.batch;
    db.batch = async () => {
      throw new Error('database is locked');
    };
    await expect(client.loadWrite(setId, cards)).rejects.toThrow();
    expect(settingsFile.sessionsCarriedOver).toBe(false);
    expect(storage.getItem(key)).not.toBeNull();
    db.batch = batch;

    // The rows go in but the flag can't be written: keys kept, tried again.
    settingsFile.failMark = true;
    await expect(client.loadWrite(setId, cards)).rejects.toThrow();
    expect(rows()).toHaveLength(1);
    expect(storage.getItem(key)).not.toBeNull();

    settingsFile.failMark = false;
    const back = await client.loadWrite(setId, cards);
    expect(back && packWrite(back.session)).toEqual(packWrite(write));
    expect(settingsFile.sessionsCarriedOver).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(storage.getItem(key)).toBeNull();
  });

  it('sets the flag on a first start with nothing to carry over', async () => {
    await client.carryOverSessions();
    expect(settingsFile.sessionsCarriedOver).toBe(true);
  });

  it('leaves a snapshot it cannot read where it is, and drops finished ones and deleted sets', async () => {
    const { setId, cards } = await setWith(3);
    let done = startSession(cards, { answerWith: 'term', shuffled: false });
    for (const c of cards) done = next(submitAnswer(done, c.term));
    expect(done.step.kind).toBe('summary');
    storage.setItem(`fc-write-session-${setId}`, legacy(done));
    storage.setItem(`fc-deck-session-${setId}`, '{"pile": [1, 2], "order": [1, 2], "ind'); // cut off
    storage.setItem(`fc-session-${setId}`, legacy({ hello: 'world' }));
    storage.setItem('fc-deck-session-999', legacy(startDeck([1, 2], false)));

    await client.carryOverSessions();
    expect(rows()).toEqual([]);
    expect(Object.keys(storage).sort()).toEqual([`fc-deck-session-${setId}`, `fc-session-${setId}`].sort());
    // Nothing tries again over what is already done, and the unreadable ones
    // do not stop the screens: they just start afresh.
    expect(await client.loadDeck(setId, [1, 2])).toBeNull();
  });
});

describe('reading 0.1.14 snapshots', () => {
  const card = (id: number): LearnCardDTO => ({
    id,
    term: `t${id}`,
    definition: `d${id}`,
    position: id,
    status: 'new',
    progress: null,
  });

  it('knows the keys', () => {
    expect(isLegacySessionKey('fc-deck-session-3')).toBe(true);
    expect(isLegacySessionKey('fc-write-session-3')).toBe(true);
    expect(isLegacySessionKey('fc-session-3')).toBe(true);
    expect(isLegacySessionKey('fc-session-3-2026-10-01')).toBe(true);
    expect(isLegacySessionKey('fc-write-session-3-2026-10-01')).toBe(false);
    expect(isLegacySessionKey('fc-first-side')).toBe(false);
    expect(isLegacySessionKey('flashcards:theme')).toBe(false);
  });

  it('takes a Learn session from before `cards` and `credits` were kept', () => {
    const turns = [
      { card: card(1), retry: false },
      { card: card(2), retry: false },
      { card: card(1), retry: true },
    ];
    const old = {
      turns,
      pool: [card(1), card(2)],
      answerWith: 'term',
      index: 1,
      question: { kind: 'written' },
      step: { kind: 'ask', hinted: false },
      graded: [{ cardId: 1, quality: 1 }],
    };
    const [snap] = legacySnapshots([['fc-session-4', JSON.stringify(old)]]);
    expect(snap).toMatchObject({ setId: 4, mode: 'learn', keys: ['fc-session-4'] });
    expect(snap.data).toMatchObject({ cardIds: [1, 2], credits: {}, cardsSinceCheckpoint: 0, checkpointBatch: 1 });
    const back = unpackLearn(snap.data, [card(1), card(2)], [card(1), card(2)])!;
    expect(back.turns.map((t) => [t.card.id, t.retry])).toEqual([
      [1, false],
      [2, false],
      [1, true],
    ]);
    expect(currentCard(back)!.id).toBe(2);
  });

  it('an undated Learn key wins over dated ones, which go with it', () => {
    const s = (index: number) =>
      JSON.stringify({ ...startLearn([card(1), card(2)], [card(1), card(2)], 'term', seeded()), index });
    const [snap] = legacySnapshots([
      ['fc-session-5-2026-10-09', s(1)],
      ['fc-session-5', s(0)],
    ]);
    expect((snap.data as { index: number }).index).toBe(0);
    expect(snap.keys.sort()).toEqual(['fc-session-5', 'fc-session-5-2026-10-09']);
  });
});

describe('the side a set was last studied with', () => {
  it('is remembered per set and mode, and goes with the set', async () => {
    const { setId } = await setWith(2);
    const other = await setWith(2, 'French');
    expect(await client.loadSide(setId, 'write')).toBeNull();

    client.rememberSide(setId, 'write', 'definition');
    client.rememberSide(other.setId, 'learn', 'definition');
    expect(await client.loadSide(setId, 'write')).toBe('definition');
    expect(await client.loadSide(setId, 'learn')).toBeNull();

    client.rememberSide(setId, 'write', 'term');
    expect(await client.loadSide(setId, 'write')).toBe('term');

    await repo.deleteSet(setId);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM study_sides WHERE set_id = ?').get(setId)).toEqual({ n: 0 });
    expect(await client.loadSide(other.setId, 'learn')).toBe('definition');
  });
});

describe('what is typed in an answer box goes with the round', () => {
  it('Write keeps the box with its card and step, and drops it when that card is deleted', async () => {
    const { setId, cards } = await setWith(4);
    const write = startSession(cards, { answerWith: 'term', shuffled: false });
    client.saveWrite(setId, write, 'TER');
    const back = (await client.loadWrite(setId, cards))!;
    expect(back.typed).toBe('TER');
    expect(packWrite(back.session)).toEqual(packWrite(write));

    // Missed: the retype box is kept as well.
    const missed = dontKnow(write);
    client.saveWrite(setId, missed, 'TERM');
    expect((await client.loadWrite(setId, cards))!.typed).toBe('TERM');

    await repo.deleteCard(cards[0].id);
    const gone = (await client.loadWrite(setId, (await repo.getSet(setId)).cards))!;
    expect(gone.session.step).toEqual({ kind: 'ask' });
    expect(gone.typed).toBe('');
  });

  it('a round saved before boxes were kept loads with an empty one', async () => {
    const { setId, cards } = await setWith(2);
    await repo.saveSession(setId, 'write', packWrite(startSession(cards, { answerWith: 'term', shuffled: false })));
    expect((await client.loadWrite(setId, cards))!.typed).toBe('');
    // One that can't be read costs the box, not the round.
    await repo.saveSession(setId, 'write', {
      ...packWrite(startSession(cards, { answerWith: 'term', shuffled: false })),
      typed: 42,
    });
    const back = (await client.loadWrite(setId, cards))!;
    expect(back.typed).toBe('');
    expect(back.session.index).toBe(0);
  });

  it('Learn keeps the box of a written question, not of a choice one', async () => {
    const { setId } = await setWith(8);
    const { s, queue, pool } = await learnUnderway(setId);
    const written: LearnSession = { ...s, question: { kind: 'written' } };
    client.saveLearn(setId, written, 'TERM 3');
    expect((await client.loadLearn(setId, queue, pool))!.typed).toBe('TERM 3');

    if (s.question?.kind === 'choice') {
      client.saveLearn(setId, s, 'stray');
      expect((await client.loadLearn(setId, queue, pool))!.typed).toBe('');
    }
  });

  it('a save made by typing waits for a pause; a load, or any other save, sends it at once', async () => {
    const { setId, cards } = await setWith(3);
    const write = startSession(cards, { answerWith: 'term', shuffled: false });
    client.saveWrite(setId, write, 'T', { typing: true });
    client.saveWrite(setId, write, 'TE', { typing: true });
    expect(rows()).toEqual([]);
    await new Promise((r) => setTimeout(r, 400));
    expect(JSON.parse(rows()[0].data).typed).toBe('TE');

    client.saveWrite(setId, write, 'TER', { typing: true });
    expect((await client.loadWrite(setId, cards))!.typed).toBe('TER');

    // Answered right after a key: the answer's save takes the key's place.
    client.saveWrite(setId, write, 'TERM 0', { typing: true });
    const answered = submitAnswer(write, 'TERM 0');
    client.saveWrite(setId, answered);
    await new Promise((r) => setTimeout(r, 400));
    const kept = JSON.parse(rows()[0].data);
    expect(kept.step.kind).toBe('correct');
    expect(kept.typed).toBeUndefined();
  });

  it('starting Learn over drops a key still waiting to be saved', async () => {
    const { setId } = await setWith(8);
    const { s } = await learnUnderway(setId);
    client.saveLearn(setId, s);
    client.saveLearn(setId, { ...s, question: { kind: 'written' } }, 'x', { typing: true });
    await client.resetLearnProgress(setId);
    await new Promise((r) => setTimeout(r, 400));
    expect(rows().filter((r) => r.mode === 'learn')).toEqual([]);
  });
});

describe('a test is kept like the other rounds', () => {
  const options = { count: 6, answerWith: 'both' as const, kinds: TEST_KINDS };

  it('saves and loads the paper and its answers, card text only as typed', async () => {
    const { setId, cards } = await setWith(8);
    let test = buildTest(cards, options, seeded());
    for (const q of test.questions) {
      if (q.kind === 'written') test = answer(test, q.id, 'TYPED');
      if (q.kind === 'truefalse') test = answer(test, q.id, false);
      if (q.kind === 'choice') test = answer(test, q.id, q.options[1]);
      if (q.kind === 'matching') test = matchPair(test, q.id, q.cardIds[0], q.answers[1]);
    }
    client.saveTest(setId, test);
    expect(await client.loadTest(setId, cards)).toEqual(test);
    expect(rows()[0].data).not.toMatch(/term \d|definition \d/);

    // Handed in, it stays: its marks show in the other window too.
    const done = finish(test);
    client.saveTest(setId, done);
    expect(await client.loadTest(setId, cards)).toEqual(done);

    client.clearSession(setId, 'test');
    expect(await client.loadTest(setId, cards)).toBeNull();
  });

  it('drops questions about deleted cards, and starts afresh the next day', async () => {
    const { setId, cards } = await setWith(8);
    const test = buildTest(cards, { ...options, count: 8, kinds: ['written'] }, seeded());
    client.saveTest(setId, test);
    await repo.deleteCard(cards[0].id);
    const back = (await client.loadTest(setId, (await repo.getSet(setId)).cards))!;
    expect(back.questions).toHaveLength(7);

    const raw = JSON.parse(rows()[0].data);
    expect(unpackTest(raw, cards, test.startedAt + TEST_KEPT_MS - 1000)).not.toBeNull();
    expect(unpackTest(raw, cards, test.startedAt + TEST_KEPT_MS + 1000)).toBeNull();
    expect(unpackTest({ ...raw, questions: 'x' }, cards)).toBeNull();
  });
});
