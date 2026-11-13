// Write mode: the session as a pure state machine.
//
// Every function takes a session and returns the next one (or the same object
// when the move does not apply), so the screen is a thin shell around this
// file and the rules below can be tested without a browser.
//
// The rules, after Quizlet's Write mode:
//
//   • Round 1 asks every card once.
//   • A wrong answer, or "don't know", is a miss: the answer is shown, and
//     typing it out correctly moves the round on. Skipping the retype moves on
//     too — the card is just as missed either way.
//   • "I was correct" turns a wrong answer back into a correct one (typos).
//   • When a round ends with misses, the next round asks only those cards,
//     and so on until a round ends clean.
//
// Mastery counts correct answers per card, two to master:
//
//   • Typing the answer out after a miss earns the first; skipping it earns
//     nothing. It never earns the second — copying an answer off the screen, however often, is not
//     knowing it — so a missed card is only mastered by then answering it
//     correctly in a later missed-cards round.
//   • A card answered correctly the first time it is asked in round 1 is
//     mastered on the spot. It was never missed, so the missed-cards round,
//     which is where a second correct answer would come from, never asks it
//     again; holding it at one would leave the best-known cards as the only
//     ones that can never be mastered.

import { shuffle } from './shuffle';

export type AnswerWith = 'term' | 'definition';

export type StudyCard = { id: number; term: string; definition: string };

export type Step =
  /** Waiting for an answer. */
  | { kind: 'ask' }
  /** Answered correctly; a brief confirmation before the next card. */
  | { kind: 'correct'; given: string; overridden: boolean }
  /** Missed. `given` is null for "don't know". Retype, or skip, to continue. */
  | { kind: 'reveal'; given: string | null }
  /** The round is over. */
  | { kind: 'summary' };

export type RoundSummary = {
  round: number;
  total: number;
  missed: number;
  /** Whole percent of the round answered correctly on the first try. */
  accuracy: number;
};

export type WriteSession = {
  /** The whole set, in set order. */
  cards: StudyCard[];
  answerWith: AnswerWith;
  shuffled: boolean;
  round: number;
  /** Card ids asked this round, in asking order. */
  queue: number[];
  index: number;
  step: Step;
  /** Ids missed so far this round, in the order they were missed. */
  missed: number[];
  /** Correct answers per card id, 0 to MASTERY_CREDITS. */
  credits: Record<number, number>;
  /** Finished rounds, oldest first. */
  rounds: RoundSummary[];
};

export const MASTERY_CREDITS = 2;

// --- answers ---

/**
 * One spelling for what keyboards type differently: case, Unicode forms,
 * every apostrophe and quote mark (Swiss keyboards type ´ and `), typographic
 * dashes, ß as ss (Swiss keyboards have no ß), runs of whitespace.
 * Accents are not folded — in a vocabulary set, "a" and "à" are different
 * words, and the "I was correct" button covers a genuine slip.
 */
export function foldAnswer(value: string): string {
  // The marks first: NFKC would turn ´ into a space and a combining accent.
  return value
    .replace(/[‘’‚‛′´`ʼ]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

const EDGE_PUNCTUATION = /^[\s.,;:!?¿¡'"]+|[\s.,;:!?¿¡'"]+$/g;

/**
 * What counts as the same answer: everything foldAnswer evens out, plus
 * punctuation at either end. Kept for callers that want readable text; the
 * check itself compares answerKey()s.
 */
export function normalizeAnswer(value: string): string {
  return foldAnswer(value)
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(EDGE_PUNCTUATION, '');
}

/**
 * Strips all parenthetical expressions: e.g. "Apfel (m)" -> "Apfel ".
 * Handles nested parentheses.
 */
export function stripParens(value: string): string {
  let prev = value;
  while (true) {
    const next = prev.replace(/\([^()]*\)/g, ' ');
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

/**
 * Strips parenthesis characters: "(to) run" -> " to  run".
 */
export function stripParenChars(value: string): string {
  return value.replace(/[()]/g, ' ');
}

/**
 * Strips all spaces from a string for space-agnostic comparison.
 */
export function stripSpaces(value: string): string {
  return value.replace(/\s+/g, '');
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
/** Dropped from the key: sentence marks. (A space is decided on its own.) */
const isMark = (c: string) => /[.!?¿¡"]/.test(c);

/**
 * The form two answers are compared in. On top of normalizeAnswer: sentence
 * marks (. ! ? ¿ ¡ ") don't count anywhere ("Mr. Smith" is "Mr Smith"), but a
 * hyphen does ("email" is not "e-mail"), and so does the space between two
 * words ("icecream" is not "ice cream"). A space next to anything else — a
 * hyphen, an apostrophe, a comma — does not ("well - known", "l' ami"), nor
 * does a run of them. A list — items split by , ; or / — matches in any
 * order. Inside a number nothing is dropped or split: "3.5" is not "35", and
 * "1,5" is not "5,1".
 */
export function answerKey(value: string): string {
  const s = normalizeAnswer(value);
  const items: string[] = [];
  let item = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const inNumber = isDigit(s[i - 1]) && isDigit(s[i + 1]);
    if ((c === ',' || c === ';' || c === '/') && !inNumber) {
      items.push(item);
      item = '';
    } else if (c === '.' && inNumber) {
      item += c;
    } else if (/\s/.test(c)) {
      // Kept only between two words; the marks dropped around it don't count.
      let next = i + 1;
      while (next < s.length && (/\s/.test(s[next]) || isMark(s[next]))) next++;
      if (isWordChar(item[item.length - 1]) && isWordChar(s[next])) item += ' ';
    } else if (!isMark(c)) {
      item += c;
    }
  }
  items.push(item);
  return items
    .filter((x) => x !== '')
    .sort()
    .join(',');
}

/**
 * The ways an answer may be written: as is, without the parenthesis marks
 * ("(to) run" as "to run"), and without what is in parentheses ("Apfel (m)"
 * as "Apfel") — that last one only when something is left, so "(noun)" still
 * has to be typed.
 */
function answerForms(value: string): Set<string> {
  const forms = new Set<string>();
  for (const form of [value, stripParenChars(value), stripParens(value)]) {
    const key = answerKey(form);
    if (key !== '') forms.add(key);
  }
  return forms;
}

export function isMatch(given: string, expected: string): boolean {
  const want = answerForms(expected);

  // An answer that is nothing but punctuation ("?", "...") has no key, and
  // would otherwise accept anything; compare those as typed instead.
  if (want.size === 0) {
    const plain = (v: string) => stripSpaces(foldAnswer(v));
    return plain(expected) !== '' && plain(given) === plain(expected);
  }

  // Any way of writing the answer, typed any way it may be written: a typed
  // "(f)" after the word is the same leeway the card itself gets.
  for (const form of answerForms(given)) {
    if (want.has(form)) return true;
  }
  return false;
}

export function promptOf(card: StudyCard, answerWith: AnswerWith): string {
  return answerWith === 'term' ? card.definition : card.term;
}

export function answerOf(card: StudyCard, answerWith: AnswerWith): string {
  return answerWith === 'term' ? card.term : card.definition;
}

// --- session ---

export function startSession(
  cards: StudyCard[],
  options: { answerWith: AnswerWith; shuffled: boolean },
  random: () => number = Math.random,
): WriteSession {
  const ids = cards.map((card) => card.id);
  return {
    cards,
    answerWith: options.answerWith,
    shuffled: options.shuffled,
    round: 1,
    queue: options.shuffled ? shuffle(ids, random) : ids,
    index: 0,
    step: { kind: 'ask' },
    missed: [],
    credits: Object.fromEntries(ids.map((id) => [id, 0])),
    rounds: [],
  };
}

export function currentCard(session: WriteSession): StudyCard | null {
  if (session.step.kind === 'summary') return null;
  const id = session.queue[session.index];
  return session.cards.find((card) => card.id === id) ?? null;
}

export function submitAnswer(session: WriteSession, given: string): WriteSession {
  const card = currentCard(session);
  // An empty submit is not an answer. The page turns an empty Enter into
  // dontKnow() itself, so the timing guard against a stray Enter lives there.
  if (!card || session.step.kind !== 'ask' || given.trim() === '') return session;

  if (isMatch(given, answerOf(card, session.answerWith))) {
    return {
      ...session,
      step: { kind: 'correct', given, overridden: false },
      credits: { ...session.credits, [card.id]: MASTERY_CREDITS },
    };
  }
  return miss(session, card, given);
}

export function dontKnow(session: WriteSession): WriteSession {
  const card = currentCard(session);
  if (!card || session.step.kind !== 'ask') return session;
  return miss(session, card, null);
}

function miss(session: WriteSession, card: StudyCard, given: string | null): WriteSession {
  return {
    ...session,
    step: { kind: 'reveal', given },
    missed: [...session.missed, card.id],
  };
}

/** "I was correct": only for a typed answer — there is nothing to overrule in "don't know". */
export function overrideCorrect(session: WriteSession): WriteSession {
  const card = currentCard(session);
  const { step } = session;
  if (!card || step.kind !== 'reveal' || step.given === null) return session;

  return {
    ...session,
    step: { kind: 'correct', given: step.given, overridden: true },
    missed: session.missed.filter((id) => id !== card.id),
    credits: { ...session.credits, [card.id]: MASTERY_CREDITS },
  };
}

/**
 * The retype after a miss. Returns the same session object when the text does
 * not match yet, which is how the screen knows to say so.
 */
export function submitRetype(session: WriteSession, typed: string): WriteSession {
  const card = currentCard(session);
  if (!card || session.step.kind !== 'reveal') return session;
  if (!isMatch(typed, answerOf(card, session.answerWith))) return session;

  const credits = Math.max(session.credits[card.id] ?? 0, 1);
  return nextCard({ ...session, credits: { ...session.credits, [card.id]: credits } });
}

/**
 * Past a miss without retyping the answer. The card stays missed, so the next
 * round asks it again; all it forgoes is the credit a retype would have earned.
 */
export function skipRetype(session: WriteSession): WriteSession {
  if (!currentCard(session) || session.step.kind !== 'reveal') return session;
  return nextCard(session);
}

/** Past the "correct" confirmation. A miss moves on through submitRetype or skipRetype. */
export function advance(session: WriteSession): WriteSession {
  if (session.step.kind !== 'correct') return session;
  return nextCard(session);
}

function nextCard(session: WriteSession): WriteSession {
  const index = session.index + 1;
  if (index < session.queue.length) {
    return { ...session, index, step: { kind: 'ask' } };
  }

  const total = session.queue.length;
  const missed = session.missed.length;
  return {
    ...session,
    index,
    step: { kind: 'summary' },
    rounds: [
      ...session.rounds,
      { round: session.round, total, missed, accuracy: percent(total - missed, total) },
    ],
  };
}

/** From a summary with misses: a round of only the missed cards. */
export function startNextRound(
  session: WriteSession,
  random: () => number = Math.random,
): WriteSession {
  if (session.step.kind !== 'summary' || session.missed.length === 0) return session;
  return {
    ...session,
    round: session.round + 1,
    queue: session.shuffled ? shuffle(session.missed, random) : session.missed,
    index: 0,
    step: { kind: 'ask' },
    missed: [],
  };
}

// --- reading a session ---

export function isFinished(session: WriteSession): boolean {
  return session.step.kind === 'summary' && session.missed.length === 0;
}

export function masteredCount(session: WriteSession): number {
  return Object.values(session.credits).filter((n) => n >= MASTERY_CREDITS).length;
}

export function roundProgress(session: WriteSession) {
  const total = session.queue.length;
  // The card on screen counts as answered once its verdict is showing.
  const answered = Math.min(
    total,
    session.index + (session.step.kind === 'correct' || session.step.kind === 'reveal' ? 1 : 0),
  );
  const missed = session.missed.length;
  return { total, answered, missed, correct: answered - missed, remaining: total - answered };
}

export function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}
