import { describe, expect, it } from 'vitest';

import {
  answer,
  buildTest,
  finish,
  kindsFor,
  matchPair,
  overrideWritten,
  progress,
  reconcile,
  score,
  splitCount,
  type Question,
  type Test,
  type TestOptions,
} from './test';
import type { StudyCard } from './write';

const cards: StudyCard[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  term: `term ${i + 1}`,
  definition: `meaning number ${i + 1}`,
}));

/** A seeded random, so a test is the same every run. */
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

const all: TestOptions = { count: 12, answerWith: 'definition', kinds: ['truefalse', 'choice', 'matching', 'written'] };

function build(options: Partial<TestOptions> = {}, set = cards): Test {
  return buildTest(set, { ...all, ...options }, seeded(), 1000);
}

/** The right answer to every question of a test. */
function answerAllRight(test: Test): Test {
  let t = test;
  for (const q of t.questions) {
    if (q.kind === 'written') t = answer(t, q.id, cards.find((c) => c.id === q.cardId)![q.answerWith]);
    else if (q.kind === 'choice') t = answer(t, q.id, q.cardId);
    else if (q.kind === 'truefalse') t = answer(t, q.id, q.shownId === q.cardId);
    else for (const id of q.cardIds) t = matchPair(t, q.id, id, id);
  }
  return t;
}

describe('a test', () => {
  it('splits the questions evenly over the kinds, sections in order', () => {
    expect([...splitCount(10, ['written', 'truefalse', 'choice', 'matching'])]).toEqual([
      ['truefalse', 3],
      ['choice', 3],
      ['matching', 2],
      ['written', 2],
    ]);
    // A matching block of one is not matching.
    expect(Object.fromEntries(splitCount(5, ['truefalse', 'choice', 'matching', 'written']))).toEqual({
      truefalse: 3,
      choice: 1,
      matching: 0,
      written: 1,
    });
  });

  it('asks every card once, as many points as asked for', () => {
    const t = build();
    const asked = t.questions.flatMap((q) => (q.kind === 'matching' ? q.cardIds : [q.cardId]));
    expect(asked).toHaveLength(12);
    expect(new Set(asked).size).toBe(12);
    expect(progress(t)).toEqual({ answered: 0, total: 12 });
    const kinds = t.questions.map((q) => q.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => ['truefalse', 'choice', 'matching', 'written'].indexOf(a) - ['truefalse', 'choice', 'matching', 'written'].indexOf(b)));
  });

  it('never asks more than the set has', () => {
    expect(progress(build({ count: 50 })).total).toBe(12);
    expect(progress(build({ count: 4 })).total).toBe(4);
  });

  it('gives multiple choice four different options, the right one among them', () => {
    const t = build({ kinds: ['choice'] });
    for (const q of t.questions as Extract<Question, { kind: 'choice' }>[]) {
      expect(q.kind).toBe('choice');
      expect(new Set(q.options).size).toBe(4);
      expect(q.options).toContain(q.cardId);
    }
  });

  it('writes the questions of a small set out, when choice cannot be had', () => {
    const few = cards.slice(0, 3);
    expect(kindsFor(few)).toEqual({ truefalse: true, choice: false, matching: true, written: true });
    const t = build({ kinds: ['choice'], count: 3 }, few);
    expect(t.questions.every((q) => q.kind === 'written')).toBe(true);
  });

  it('marks everything right when it is', () => {
    const t = finish(answerAllRight(build()), 61_000);
    const r = score(t, cards, 'exact');
    expect(r).toMatchObject({ right: 12, total: 12, percent: 100, missedCardIds: [] });
  });

  it('marks unanswered questions wrong and lists their cards as missed', () => {
    const t = build({ kinds: ['written'], count: 3 });
    const first = t.questions[0] as Extract<Question, { kind: 'written' }>;
    const r = score(answer(t, first.id, 'nonsense'), cards, 'exact');
    expect(r.right).toBe(0);
    expect(r.missedCardIds).toHaveLength(3);
  });

  it('counts a written miss marked "I was right" as right', () => {
    const t = build({ kinds: ['written'], count: 1 });
    const q = t.questions[0];
    const marked = overrideWritten(finish(answer(t, q.id, 'close enough')), q.id);
    expect(score(marked, cards, 'exact').right).toBe(1);
  });

  it('moves a matching answer that is put next to a second prompt', () => {
    const t = build({ kinds: ['matching'], count: 4 });
    const q = t.questions[0] as Extract<Question, { kind: 'matching' }>;
    const [a, b] = q.cardIds;
    const once = matchPair(t, q.id, a, a);
    const moved = matchPair(once, q.id, b, a);
    expect(moved.answers[q.id]).toEqual({ [b]: a });
  });

  it('builds matching blocks of at most five, never a block of one', () => {
    const t = build({ kinds: ['matching'], count: 11 });
    const sizes = t.questions.map((q) => (q.kind === 'matching' ? q.cardIds.length : 0));
    expect(sizes.reduce((x, y) => x + y)).toBe(11);
    expect(sizes.every((n) => n >= 2 && n <= 5)).toBe(true);
  });

  it('cannot be changed once handed in', () => {
    const t = finish(build({ kinds: ['written'], count: 1 }));
    expect(answer(t, t.questions[0].id, 'late')).toBe(t);
  });

  it('drops questions about cards deleted since, and keeps its answers', () => {
    const t = answerAllRight(build({ kinds: ['written', 'choice'], count: 6 }));
    const gone = t.questions[0].kind === 'matching' ? 0 : t.questions[0].cardId;
    const left = cards.filter((c) => c.id !== gone);
    const r = reconcile(t, left)!;
    expect(r.questions.some((q) => q.kind !== 'matching' && q.cardId === gone)).toBe(false);
    expect(reconcile(t, cards)).toBe(t);
    expect(reconcile(t, [])).toBeNull();
  });
});
