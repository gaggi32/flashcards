// A study mode's unfinished round, as it is kept in the database
// (study_sessions, one row per set and mode) so that it survives a restart
// and both windows carry on with the same round.
//
// What is kept is card ids and each card's state in the round, not the
// cards' text (the one exception is the answer on screen, as it was typed or
// picked): loading puts the set's current cards back in (unpack*), so an
// edited card shows its new text, and a card deleted since drops out of the
// round instead of breaking it.
//
// Up to 0.1.14 each mode kept the whole session, card text and all, in the
// webview's localStorage, which loses its newest writes when the webview is
// killed rather than closed. legacySnapshots reads those for the one-time
// carry-over; a snapshot it can't read is left where it is.

import { z } from 'zod';

import type { Deck } from './deck';
import { questionFor, type LearnSession, type LearnStep, type Question } from './learn';
import type { Quality } from './sm2';
import type { LearnCardDTO } from './types';
import { roundSummary, type StudyCard, type WriteSession } from './write';

export type StudyMode = 'cards' | 'write' | 'learn';

// --- the stored shapes ------------------------------------------------------------

const id = z.number().int().positive();
const ids = z.array(id);
const count = z.number().int().min(0);
const side = z.enum(['term', 'definition']);
const quality = z
  .number()
  .int()
  .min(0)
  .max(5)
  .transform((q) => q as Quality);
/** Per-card numbers by card id (JSON keys are strings). */
const perCard = <T extends z.ZodTypeAny>(value: T) => z.record(z.string().regex(/^\d+$/), value);

const deckSchema = z.object({
  pile: ids,
  order: ids,
  index: count,
  shuffled: z.boolean(),
  round: z.number().int().min(1),
  marks: perCard(z.enum(['known', 'missed'])),
  done: z.boolean(),
});

const writeStep = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ask'), hinted: z.boolean().optional() }),
  z.object({ kind: z.literal('correct'), given: z.string(), overridden: z.boolean(), hinted: z.boolean().optional() }),
  z.object({ kind: z.literal('reveal'), given: z.string().nullable(), hinted: z.boolean().optional() }),
  z.object({ kind: z.literal('summary') }),
]);

const writeFields = {
  answerWith: side,
  shuffled: z.boolean(),
  round: z.number().int().min(1),
  queue: ids,
  index: count,
  step: writeStep,
  missed: ids,
  // Rounds saved before the Write hint (1.4.1 and older) have no hinted cards.
  hinted: ids.default([]),
  credits: perCard(count),
  rounds: z.array(z.object({ round: count, total: count, missed: count, hinted: count.default(0), accuracy: count })),
};

const writeSchema = z.object({ cardIds: ids, ...writeFields });

const learnStep = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ask'), hinted: z.boolean().default(false) }),
  z.object({ kind: z.literal('correct'), given: z.string(), quality, overridden: z.boolean() }),
  z.object({
    kind: z.literal('miss'),
    given: z.string().nullable(),
    quality: quality.nullable(),
    elapsedMs: z.number().min(0),
    hinted: z.boolean(),
  }),
  z.object({ kind: z.literal('checkpoint'), batchNumber: z.number().int() }),
  z.object({ kind: z.literal('summary') }),
]);

const learnFields = {
  answerWith: side,
  index: count,
  step: learnStep,
  graded: z.array(z.object({ cardId: id, quality })),
  credits: perCard(count).default({}),
  cardsSinceCheckpoint: count.default(0),
  checkpointBatch: z.number().int().min(1).default(1),
};

const learnSchema = z.object({
  cardIds: ids,
  turns: z.array(z.object({ id, retry: z.boolean() })),
  question: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('written') }),
      z.object({ kind: z.literal('choice'), optionIds: ids }),
    ])
    .nullable(),
  ...learnFields,
});

export type StoredDeck = z.infer<typeof deckSchema>;
export type StoredWrite = z.infer<typeof writeSchema>;
export type StoredLearn = z.infer<typeof learnSchema>;

// The 0.1.14 localStorage shapes: the session objects themselves. Only the
// card ids are read from the cards they carry.
const withId = z.object({ id });
const legacyWrite = z.object({ cards: z.array(withId), ...writeFields });
const legacyLearn = z.object({
  cards: z.array(withId).optional(),
  turns: z.array(z.object({ card: withId, retry: z.boolean() })),
  question: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('written') }),
      z.object({ kind: z.literal('choice'), options: z.array(withId) }),
    ])
    .nullable(),
  ...learnFields,
});

// --- packing (what a screen saves) --------------------------------------------------

export function packDeck(deck: Deck): StoredDeck {
  return { ...deck };
}

export function packWrite(session: WriteSession): StoredWrite {
  const { cards, ...rest } = session;
  return { cardIds: cards.map((card) => card.id), ...rest };
}

export function packLearn(session: LearnSession): StoredLearn {
  const { cards, turns, pool: _pool, question, ...rest } = session;
  return {
    ...rest,
    cardIds: cards.map((card) => card.id),
    turns: turns.map((turn) => ({ id: turn.card.id, retry: turn.retry })),
    question: packQuestion(question),
  };
}

function packQuestion(question: Question | null): StoredLearn['question'] {
  if (question?.kind === 'choice') return { kind: 'choice', optionIds: question.options.map((o) => o.id) };
  return question;
}

// --- unpacking (what a screen loads) ------------------------------------------------

/** `list` without the ids `keep` refuses, and where `index` lands in what is left. */
function dropMissing<T>(list: T[], index: number, keep: (item: T) => boolean) {
  const kept = list.filter(keep);
  const before = list.slice(0, index).filter(keep).length;
  const currentGone = index < list.length && !keep(list[index]);
  return { kept, index: before, currentGone };
}

function keepKeys<V>(record: Record<string, V>, keep: (id: number) => boolean): Record<number, V> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keep(Number(key))));
}

/** A saved deck over the set's card ids now; null when nothing of it is left. */
export function unpackDeck(raw: unknown, cardIds: number[]): Deck | null {
  const parsed = deckSchema.safeParse(raw);
  if (!parsed.success || parsed.data.done) return null;
  const saved = parsed.data;
  const inSet = new Set(cardIds);
  const keep = (id: number) => inSet.has(id);
  const order = dropMissing(saved.order, saved.index, keep);
  if (order.kept.length === 0) return null;
  return {
    pile: saved.pile.filter(keep),
    order: order.kept,
    index: Math.min(order.index, order.kept.length - 1),
    shuffled: saved.shuffled,
    round: saved.round,
    marks: keepKeys(saved.marks, keep),
    done: false,
  };
}

/** A saved Write round over the set's cards now (`cards`, in set order); null when nothing is left. */
export function unpackWrite(raw: unknown, cards: StudyCard[]): WriteSession | null {
  const parsed = writeSchema.safeParse(raw);
  if (!parsed.success || parsed.data.step.kind === 'summary') return null;
  const { cardIds, ...saved } = parsed.data;
  const inSession = new Set(cardIds);
  const own = cards.filter((card) => inSession.has(card.id));
  if (own.length === 0) return null;
  const present = new Set(own.map((card) => card.id));
  const keep = (id: number) => present.has(id);

  const queue = dropMissing(saved.queue, saved.index, keep);
  if (queue.kept.length === 0) return null;
  const session: WriteSession = {
    ...saved,
    cards: own.map(({ id, term, definition }) => ({ id, term, definition })),
    queue: queue.kept,
    index: queue.index,
    step: queue.currentGone ? { kind: 'ask' } : saved.step,
    missed: saved.missed.filter(keep),
    hinted: saved.hinted.filter(keep),
    credits: keepKeys(saved.credits, keep),
  };
  if (session.index < session.queue.length) return session;
  // The rest of the round was deleted: the round is over, as if just answered.
  return { ...session, step: { kind: 'summary' }, rounds: [...session.rounds, roundSummary(session)] };
}

/**
 * A saved Learn session over the set's cards now: `queue` with their current
 * progress (learnQueue), `pool` the set's cards for distractors. Null when
 * nothing of it is left.
 */
export function unpackLearn(
  raw: unknown,
  queue: LearnCardDTO[],
  pool: StudyCard[],
  random: () => number = Math.random,
): LearnSession | null {
  const parsed = learnSchema.safeParse(raw);
  if (!parsed.success || parsed.data.step.kind === 'summary') return null;
  const saved = parsed.data;
  const byId = new Map(queue.map((card) => [card.id, card]));
  const keep = (id: number) => byId.has(id);

  const cards = saved.cardIds.filter(keep).map((id) => byId.get(id)!);
  if (cards.length === 0) return null;
  const turns = dropMissing(saved.turns, saved.index, (turn) => keep(turn.id));
  const session: LearnSession = {
    cards,
    turns: turns.kept.map((turn) => ({ card: byId.get(turn.id)!, retry: turn.retry })),
    pool,
    answerWith: saved.answerWith,
    index: turns.index,
    question: null,
    step: saved.step,
    graded: saved.graded,
    credits: keepKeys(saved.credits, keep),
    cardsSinceCheckpoint: saved.cardsSinceCheckpoint,
    checkpointBatch: saved.checkpointBatch,
  };
  if (session.step.kind === 'checkpoint') return session;

  if (session.index >= session.turns.length) {
    // The rest of the turns were deleted: stop at a checkpoint, which goes on
    // with whatever is not mastered yet.
    return {
      ...session,
      step: { kind: 'checkpoint', batchNumber: session.checkpointBatch },
      checkpointBatch: session.checkpointBatch + 1,
      cardsSinceCheckpoint: 0,
    };
  }
  const reask = () => ({
    ...session,
    question: questionFor(session, random),
    step: { kind: 'ask', hinted: false } as LearnStep,
  });
  if (turns.currentGone || saved.question === null) return reask();
  if (saved.question.kind === 'written') return { ...session, question: { kind: 'written' } };

  const options = saved.question.optionIds.filter(keep).map((id) => byId.get(id)!);
  // Waiting for a pick with an option gone: ask afresh. After the pick, the
  // options are only shown, so the ones left will do.
  if (session.step.kind === 'ask' && options.length < saved.question.optionIds.length) return reask();
  return {
    ...session,
    question: {
      kind: 'choice',
      options: options.map(({ id, term, definition }) => ({ id, term, definition })),
    },
  };
}

// --- the carry-over from localStorage -----------------------------------------------

export type LegacySnapshot = {
  setId: number;
  mode: StudyMode;
  /** In the stored shape; null for a finished round, which is only removed. */
  data: StoredDeck | StoredWrite | StoredLearn | null;
  /** The localStorage keys it came from, removed once it is carried over. */
  keys: string[];
};

const LEGACY_KEY = /^fc-(deck-session|write-session|session)-(\d+)(?:-(\d{4}-\d{2}-\d{2}))?$/;
const MODE_OF: Record<string, StudyMode> = { 'deck-session': 'cards', 'write-session': 'write', session: 'learn' };

/** Whether a localStorage key is one of the 0.1.14 session snapshots. */
export function isLegacySessionKey(key: string): boolean {
  const m = LEGACY_KEY.exec(key);
  // Only Learn ever had dated keys.
  return m !== null && (m[3] === undefined || m[1] === 'session');
}

function packLegacy(mode: StudyMode, json: unknown): StoredDeck | StoredWrite | StoredLearn | null | undefined {
  if (mode === 'cards') {
    const deck = deckSchema.safeParse(json);
    if (!deck.success) return undefined;
    return deck.data.done ? null : deck.data;
  }
  if (mode === 'write') {
    const write = legacyWrite.safeParse(json);
    if (!write.success) return undefined;
    if (write.data.step.kind === 'summary') return null;
    const { cards, ...rest } = write.data;
    return { cardIds: cards.map((card) => card.id), ...rest };
  }
  const learn = legacyLearn.safeParse(json);
  if (!learn.success) return undefined;
  if (learn.data.step.kind === 'summary') return null;
  const { cards, turns, question, ...rest } = learn.data;
  return {
    ...rest,
    // Sessions from before `cards` was kept: the cards asked first time round.
    cardIds: (cards ?? turns.filter((turn) => !turn.retry).map((turn) => turn.card)).map((card) => card.id),
    turns: turns.map((turn) => ({ id: turn.card.id, retry: turn.retry })),
    question:
      question?.kind === 'choice' ? { kind: 'choice', optionIds: question.options.map((o) => o.id) } : question,
  };
}

/**
 * The 0.1.14 snapshots among `entries` (localStorage's keys and values), one
 * per set and mode. Learn's dated keys (`fc-session-<set>-<YYYY-MM-DD>`, from
 * before sessions were kept per set) count only when the set has no undated
 * one, and then the newest; they are all removed with it. A snapshot that is
 * not valid JSON, or not a session, is left out, and so are its keys.
 */
export function legacySnapshots(entries: [string, string][]): LegacySnapshot[] {
  const groups = new Map<string, { setId: number; mode: StudyMode; plain?: string; dated: [string, string][] }>();
  for (const [key, value] of entries) {
    const m = LEGACY_KEY.exec(key);
    if (!m || !isLegacySessionKey(key)) continue;
    const mode = MODE_OF[m[1]];
    const setId = Number(m[2]);
    if (!Number.isSafeInteger(setId) || setId <= 0) continue;
    const group = groups.get(`${mode}:${setId}`) ?? { setId, mode, dated: [] };
    if (m[3] === undefined) group.plain = value;
    else group.dated.push([key, value]);
    groups.set(`${mode}:${setId}`, group);
  }

  const out: LegacySnapshot[] = [];
  for (const { setId, mode, plain, dated } of groups.values()) {
    dated.sort(([a], [b]) => (a < b ? -1 : 1));
    const raw = plain ?? dated[dated.length - 1]?.[1];
    if (raw === undefined) continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const data = packLegacy(mode, json);
    if (data === undefined) continue;
    const keys = [...(plain !== undefined ? [keyFor(mode, setId)] : []), ...dated.map(([key]) => key)];
    out.push({ setId, mode, data, keys });
  }
  return out;
}

function keyFor(mode: StudyMode, setId: number): string {
  const name = mode === 'cards' ? 'deck-session' : mode === 'write' ? 'write-session' : 'session';
  return `fc-${name}-${setId}`;
}
