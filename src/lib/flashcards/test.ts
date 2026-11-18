// Test: a whole set (or part of it) as one paper, answered in any order and
// marked at the end. Four kinds of question, mixed through the paper (each
// kind spread evenly over it, never all of one kind and then the next):
//
//   true or false    a prompt and an answer: do they belong together?
//   multiple choice  a prompt and four answers, one right
//   matching         up to MATCH_GROUP prompts and their answers, shuffled
//   written          a prompt; type the answer (marked like Write)
//
// Every question is about one card, except matching, where each prompt is a
// question of its own (it counts as one point) but they are laid out together.
// A card is asked once per test. Questions name cards by id, never by text, so
// a card edited mid-test shows its new text.

import { MIN_CARDS_FOR_CHOICE, pickDistractors } from './distractors';
import { shuffle } from './shuffle';
import { answerOf, isMatch, normalizeAnswer, type AnswerCheck, type AnswerWith, type StudyCard } from './write';

export type TestKind = 'truefalse' | 'choice' | 'matching' | 'written';
/** Which side the answers are; "both" picks per question. */
export type TestSide = AnswerWith | 'both';

export const TEST_KINDS: TestKind[] = ['truefalse', 'choice', 'matching', 'written'];
export const KIND_LABEL: Record<TestKind, string> = {
  truefalse: 'true or false',
  choice: 'multiple choice',
  matching: 'matching',
  written: 'written',
};

/** The letters of multiple-choice options and matching answers. */
export const LETTERS = 'ABCDEFGHIJ';

/** Prompts per matching block. */
export const MATCH_GROUP = 5;
export const CHOICE_OPTIONS = 4;

export type TestOptions = { count: number; answerWith: TestSide; kinds: TestKind[] };

export type Question =
  | { kind: 'written'; id: string; cardId: number; answerWith: AnswerWith }
  | { kind: 'choice'; id: string; cardId: number; answerWith: AnswerWith; options: number[] }
  /** `shownId`: the card whose answer is shown; the statement is true when it is the card's own. */
  | { kind: 'truefalse'; id: string; cardId: number; answerWith: AnswerWith; shownId: number }
  /** `cardIds`: the prompts in order; `answers`: the same cards in the order their answers are listed. */
  | { kind: 'matching'; id: string; cardIds: number[]; answerWith: AnswerWith; answers: number[] };

/**
 * What was put down. written: the text; choice: the card id picked;
 * truefalse: true/false; matching: for each prompt's card id, the card id of
 * the answer put next to it.
 */
export type Answer = string | number | boolean | Record<number, number>;

export type Test = {
  options: TestOptions;
  questions: Question[];
  answers: Record<string, Answer>;
  startedAt: number;
  /** Set when handed in; the test can no longer be changed. */
  finishedAt: number | null;
  /** Written answers the user marked as right after all, by question id. */
  overridden: string[];
};

/** Which kinds a set of this size can have: choice needs enough wrong answers, the rest two distinct answers. */
export function kindsFor(cards: readonly StudyCard[]): Record<TestKind, boolean> {
  const distinct = (side: AnswerWith) => new Set(cards.map((c) => normalizeAnswer(c[side]))).size;
  const two = Math.min(distinct('term'), distinct('definition')) >= 2;
  return {
    truefalse: two,
    choice: cards.length >= MIN_CARDS_FOR_CHOICE && Math.min(distinct('term'), distinct('definition')) >= CHOICE_OPTIONS,
    matching: two,
    written: cards.length > 0,
  };
}

/**
 * How many questions of each kind, in TEST_KINDS order: as even as it goes,
 * the first kinds taking the remainder. Matching gets none at one question
 * (a block of one is not matching); its share goes to the next kind.
 */
export function splitCount(count: number, kinds: readonly TestKind[]): Map<TestKind, number> {
  const chosen = TEST_KINDS.filter((k) => kinds.includes(k));
  const split = new Map<TestKind, number>(chosen.map((k) => [k, 0]));
  if (chosen.length === 0 || count <= 0) return split;
  const base = Math.floor(count / chosen.length);
  let rest = count % chosen.length;
  for (const k of chosen) {
    split.set(k, base + (rest > 0 ? 1 : 0));
    if (rest > 0) rest--;
  }
  const matching = split.get('matching');
  if (matching === 1 && chosen.length > 1) {
    split.set('matching', 0);
    const to = chosen.find((k) => k !== 'matching')!;
    split.set(to, split.get(to)! + 1);
  }
  return split;
}

/** A new test from `cards`. Kinds the set cannot have are left out; if none is left, everything is written. */
export function buildTest(
  cards: readonly StudyCard[],
  options: TestOptions,
  random: () => number = Math.random,
  now: number = Date.now(),
): Test {
  const can = kindsFor(cards);
  let kinds = options.kinds.filter((k) => can[k]);
  if (kinds.length === 0) kinds = ['written'];
  const count = Math.max(1, Math.min(options.count, cards.length));
  const picked = shuffle(cards, random).slice(0, count);
  const side = (): AnswerWith =>
    options.answerWith === 'both' ? (random() < 0.5 ? 'term' : 'definition') : options.answerWith;

  const questions: Question[] = [];
  let next = 0;
  let n = 0;
  const id = () => `q${++n}`;
  for (const [kind, howMany] of splitCount(count, kinds)) {
    const mine = picked.slice(next, next + howMany);
    next += howMany;
    if (kind === 'matching') {
      for (const block of matchingBlocks(mine)) {
        const answerWith = side();
        questions.push({
          kind,
          id: id(),
          cardIds: block.map((c) => c.id),
          answerWith,
          answers: shuffle(block, random).map((c) => c.id),
        });
      }
      continue;
    }
    for (const card of mine) {
      const answerWith = side();
      if (kind === 'written') {
        questions.push({ kind, id: id(), cardId: card.id, answerWith });
      } else if (kind === 'choice') {
        const wrong = pickDistractors(card, cards, CHOICE_OPTIONS - 1, { side: answerWith, random });
        if (wrong.length < CHOICE_OPTIONS - 1) {
          questions.push({ kind: 'written', id: id(), cardId: card.id, answerWith });
        } else {
          questions.push({
            kind,
            id: id(),
            cardId: card.id,
            answerWith,
            options: shuffle([card, ...wrong], random).map((c) => c.id),
          });
        }
      } else {
        const other = otherAnswer(card, cards, answerWith, random);
        const truthful = !other || random() < 0.5;
        questions.push({ kind, id: id(), cardId: card.id, answerWith, shownId: truthful ? card.id : other.id });
      }
    }
  }
  // Ids in paper order, so q1 is the first question.
  const paper = mixKinds(questions, random).map((q, i) => ({ ...q, id: `q${i + 1}` }));
  return { options: { ...options, count }, questions: paper, answers: {}, startedAt: now, finishedAt: null, overridden: [] };
}

/**
 * The questions with the kinds mixed: each kind's questions spread evenly over
 * the paper, each at a random place inside its share. Two kinds of the same
 * size never run more than two of one kind in a row; a kind with more
 * questions comes up more often, but still all through the paper.
 */
export function mixKinds(questions: readonly Question[], random: () => number = Math.random): Question[] {
  const byKind = new Map<TestKind, Question[]>();
  for (const q of questions) byKind.set(q.kind, [...(byKind.get(q.kind) ?? []), q]);
  const keyed: { q: Question; key: number }[] = [];
  for (const list of byKind.values()) list.forEach((q, i) => keyed.push({ q, key: (i + random()) / list.length }));
  return keyed.sort((a, b) => a.key - b.key).map((x) => x.q);
}

/**
 * Matching blocks of at most MATCH_GROUP, as even as possible and never one
 * card alone. Two cards with the same answer never share a block (either
 * would be right), so such a card waits for a later block.
 */
function matchingBlocks(cards: readonly StudyCard[]): StudyCard[][] {
  const blocks = Math.ceil(cards.length / MATCH_GROUP);
  const size = Math.ceil(cards.length / Math.max(1, blocks));
  const out: StudyCard[][] = [];
  let left = [...cards];
  while (left.length > 0) {
    const block: StudyCard[] = [];
    const keys = { term: new Set<string>(), definition: new Set<string>() };
    const later: StudyCard[] = [];
    for (const c of left) {
      const t = normalizeAnswer(c.term);
      const d = normalizeAnswer(c.definition);
      if (block.length < size && !keys.term.has(t) && !keys.definition.has(d)) {
        block.push(c);
        keys.term.add(t);
        keys.definition.add(d);
      } else later.push(c);
    }
    out.push(block);
    left = later;
  }
  // A last block of one joins the one before when there is room, or takes one from it.
  const last = out[out.length - 1];
  if (out.length > 1 && last.length === 1) {
    const prev = out[out.length - 2];
    if (prev.length < MATCH_GROUP && fits(prev, last[0])) prev.push(...out.pop()!);
    else if (prev.length > 2 && fits(last, prev[prev.length - 1])) last.unshift(prev.pop()!);
  }
  return out;
}

const fits = (block: StudyCard[], card: StudyCard) =>
  block.every(
    (c) =>
      normalizeAnswer(c.term) !== normalizeAnswer(card.term) &&
      normalizeAnswer(c.definition) !== normalizeAnswer(card.definition),
  );

/** Another card whose answer reads differently, for a false statement. */
function otherAnswer(
  card: StudyCard,
  cards: readonly StudyCard[],
  side: AnswerWith,
  random: () => number,
): StudyCard | null {
  const own = normalizeAnswer(answerOf(card, side));
  const others = cards.filter((c) => c.id !== card.id && normalizeAnswer(answerOf(c, side)) !== own);
  return others.length ? others[Math.floor(random() * others.length)] : null;
}

/** Points a question is worth: one, or one per matching prompt. */
export const pointsOf = (q: Question) => (q.kind === 'matching' ? q.cardIds.length : 1);

/** Each question with its first number: numbers run through the paper, a matching block taking one per prompt. */
export function numbered(test: Test): { q: Question; first: number }[] {
  let number = 0;
  return test.questions.map((q) => {
    const first = number + 1;
    number += pointsOf(q);
    return { q, first };
  });
}

/** Whether a true-or-false statement is true: the shown answer is the card's own, or reads the same. */
export function isTruthful(q: Extract<Question, { kind: 'truefalse' }>, byId: ReadonlyMap<number, StudyCard>): boolean {
  const card = byId.get(q.cardId);
  const shown = byId.get(q.shownId);
  return (
    q.shownId === q.cardId ||
    (!!card && !!shown && normalizeAnswer(answerOf(shown, q.answerWith)) === normalizeAnswer(answerOf(card, q.answerWith)))
  );
}

/** The answer key for a question: one line per point, numbered as on the paper. */
export function keyLines(
  q: Question,
  first: number,
  byId: ReadonlyMap<number, StudyCard>,
): { number: number; text: string }[] {
  if (q.kind === 'matching') {
    return q.cardIds.map((id, row) => {
      const card = byId.get(id);
      const letter = LETTERS[q.answers.indexOf(id)] ?? '?';
      return { number: first + row, text: card ? `${letter} · ${answerOf(card, q.answerWith)}` : letter };
    });
  }
  const card = byId.get(q.cardId);
  const answerText = card ? answerOf(card, q.answerWith) : '';
  if (q.kind === 'truefalse') {
    return [{ number: first, text: isTruthful(q, byId) ? 'true' : `false · ${answerText}` }];
  }
  if (q.kind === 'choice') {
    const right = q.options.findIndex((id) => {
      const option = byId.get(id);
      return id === q.cardId || (!!option && normalizeAnswer(answerOf(option, q.answerWith)) === normalizeAnswer(answerText));
    });
    return [{ number: first, text: `${LETTERS[right] ?? '?'} · ${answerText}` }];
  }
  return [{ number: first, text: answerText }];
}

/** Whether a question (or each prompt of a matching block) has been answered. */
export function answeredPoints(test: Test, q: Question): number {
  const a = test.answers[q.id];
  if (a === undefined) return 0;
  if (q.kind === 'matching') return q.cardIds.filter((id) => typeof a === 'object' && a[id] !== undefined).length;
  if (q.kind === 'written') return typeof a === 'string' && a.trim() ? 1 : 0;
  return 1;
}

export function progress(test: Test): { answered: number; total: number } {
  let answered = 0;
  let total = 0;
  for (const q of test.questions) {
    answered += answeredPoints(test, q);
    total += pointsOf(q);
  }
  return { answered, total };
}

export function answer(test: Test, questionId: string, value: Answer): Test {
  if (test.finishedAt !== null) return test;
  return { ...test, answers: { ...test.answers, [questionId]: value } };
}

/**
 * Put answer `answerId` next to matching prompt `promptId`. An answer goes
 * next to one prompt only: wherever it was before, it moves.
 */
export function matchPair(test: Test, questionId: string, promptId: number, answerId: number | null): Test {
  const before = test.answers[questionId];
  const pairs: Record<number, number> = typeof before === 'object' ? { ...before } : {};
  for (const [p, a] of Object.entries(pairs)) if (a === answerId) delete pairs[Number(p)];
  if (answerId === null) delete pairs[promptId];
  else pairs[promptId] = answerId;
  return answer(test, questionId, pairs);
}

export function finish(test: Test, now: number = Date.now()): Test {
  return test.finishedAt === null ? { ...test, finishedAt: now } : test;
}

/** Count a written miss as right: a typo, or an answer the check did not know. */
export function overrideWritten(test: Test, questionId: string): Test {
  return test.overridden.includes(questionId) ? test : { ...test, overridden: [...test.overridden, questionId] };
}

export type Mark = { cardId: number; right: boolean; answered: boolean };

/** Each point of a question, marked. */
export function markQuestion(
  test: Test,
  q: Question,
  byId: ReadonlyMap<number, StudyCard>,
  check: AnswerCheck,
): Mark[] {
  const a = test.answers[q.id];
  if (q.kind === 'matching') {
    const pairs = typeof a === 'object' ? a : {};
    return q.cardIds.map((cardId) => {
      const put = pairs[cardId];
      const card = byId.get(cardId);
      const putCard = put === undefined ? undefined : byId.get(put);
      // Another card with the very same answer is right too.
      const right =
        put === cardId ||
        (!!card && !!putCard && normalizeAnswer(answerOf(putCard, q.answerWith)) === normalizeAnswer(answerOf(card, q.answerWith)));
      return { cardId, right, answered: put !== undefined };
    });
  }
  const card = byId.get(q.cardId);
  const answered = answeredPoints(test, q) > 0;
  if (!card || !answered) return [{ cardId: q.cardId, right: false, answered }];
  let right = false;
  if (q.kind === 'written') {
    right = test.overridden.includes(q.id) || isMatch(String(a), answerOf(card, q.answerWith), check);
  } else if (q.kind === 'choice') {
    const picked = byId.get(Number(a));
    right =
      a === card.id ||
      (!!picked && normalizeAnswer(answerOf(picked, q.answerWith)) === normalizeAnswer(answerOf(card, q.answerWith)));
  } else {
    right = a === isTruthful(q, byId);
  }
  return [{ cardId: q.cardId, right, answered }];
}

export type TestResult = {
  right: number;
  total: number;
  percent: number;
  byKind: Map<TestKind, { right: number; total: number }>;
  /** Cards with at least one point missed, in test order. */
  missedCardIds: number[];
};

export function score(test: Test, cards: readonly StudyCard[], check: AnswerCheck): TestResult {
  const byId = new Map(cards.map((c) => [c.id, c]));
  let right = 0;
  let total = 0;
  const byKind = new Map<TestKind, { right: number; total: number }>();
  const missed: number[] = [];
  for (const q of test.questions) {
    const marks = markQuestion(test, q, byId, check);
    const k = byKind.get(q.kind) ?? { right: 0, total: 0 };
    for (const m of marks) {
      total++;
      k.total++;
      if (m.right) {
        right++;
        k.right++;
      } else if (!missed.includes(m.cardId)) missed.push(m.cardId);
    }
    byKind.set(q.kind, k);
  }
  return { right, total, percent: total ? Math.round((right / total) * 100) : 0, byKind, missedCardIds: missed };
}

/**
 * The test against the set as it is now: questions about deleted cards are
 * dropped (and wrong options or answers that came from them), or null when
 * too little is left to be the same test.
 */
export function reconcile(test: Test, cards: readonly StudyCard[]): Test | null {
  const ids = new Set(cards.map((c) => c.id));
  const questions: Question[] = [];
  for (const q of test.questions) {
    if (q.kind === 'matching') {
      const cardIds = q.cardIds.filter((id) => ids.has(id));
      if (cardIds.length < 2) continue;
      questions.push({ ...q, cardIds, answers: q.answers.filter((id) => ids.has(id)) });
    } else if (!ids.has(q.cardId)) {
      continue;
    } else if (q.kind === 'choice' && q.options.some((id) => !ids.has(id))) {
      questions.push({ kind: 'written', id: q.id, cardId: q.cardId, answerWith: q.answerWith });
    } else if (q.kind === 'truefalse' && !ids.has(q.shownId)) {
      questions.push({ ...q, shownId: q.cardId });
    } else questions.push(q);
  }
  if (questions.length === 0) return null;
  if (questions.length === test.questions.length && questions.every((q, i) => q === test.questions[i])) return test;
  return { ...test, questions };
}
