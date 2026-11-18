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
//   • The hint shows each word's first letter (as in Learn). A right answer
//     with the hint counts as right this round, but the card comes back in
//     the next one, as a miss does: with the answer half shown, it is not yet
//     known.
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
//   • A right answer with the hint earns the first credit, like a retype; the
//     next round, where it comes back, can earn the second.

import { shuffle } from './shuffle';

export type AnswerWith = 'term' | 'definition';

/**
 * How strict the check is with answers that list alternatives (split by
 * , ; or /, e.g. "Reaktion, Antwort" or "gut / lecker"). "exact": every one
 * has to be typed, in any order. "easier": any one of them is enough, and all
 * of them still are. Everything else is the same in both.
 */
export type AnswerCheck = 'exact' | 'easier';

export type StudyCard = { id: number; term: string; definition: string };

export type Step =
  /** Waiting for an answer. `hinted` once the hint is showing. */
  | { kind: 'ask'; hinted?: boolean }
  /** Answered correctly; a brief confirmation before the next card. `hinted`: with the hint. */
  | { kind: 'correct'; given: string; overridden: boolean; hinted?: boolean }
  /**
   * Missed. `given` is null for "don't know". Retype, or skip, to continue.
   * `hinted`: the hint was showing, so "I was correct" counts it as a hinted answer.
   */
  | { kind: 'reveal'; given: string | null; hinted?: boolean }
  /** The round is over. */
  | { kind: 'summary' };

export type RoundSummary = {
  round: number;
  total: number;
  missed: number;
  /** Answered right with the hint (they come back next round, like the misses). */
  hinted: number;
  /** Whole percent of the round answered correctly on the first try, without the hint. */
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
  /** Ids answered right with the hint this round, in that order. */
  hinted: number[];
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
 *
 * Between two words, a stretch of spaces and sentence marks with at least one
 * mark in it ("z. B.", "Mr.Smith", 'sagte "ja"') becomes `markGap`: isMatch
 * tries both a space and nothing, so the space next to a mark is as free as
 * the mark itself ("z.B." and "z. B." and "z B", "USA" and "U.S.A."). A
 * stretch of spaces alone is a word gap and always one space.
 */
export function answerKey(value: string, markGap: '' | ' ' = ' '): string {
  const s = normalizeAnswer(value);
  const isGap = (k: number) =>
    /\s/.test(s[k]) || (isMark(s[k]) && !(s[k] === '.' && isDigit(s[k - 1]) && isDigit(s[k + 1])));
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
    } else if (isGap(i)) {
      // A gap counts only between two words.
      let end = i;
      let marked = false;
      while (end < s.length && isGap(end)) {
        if (isMark(s[end])) marked = true;
        end++;
      }
      if (isWordChar(item[item.length - 1]) && isWordChar(s[end])) item += marked ? markGap : ' ';
      i = end - 1;
    } else {
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
 * The alternatives an answer lists: its parts split by , ; or /, but not
 * inside parentheses or a number ("Apfel (m, f)", "1,5").
 */
export function splitAlternatives(value: string): string[] {
  const parts: string[] = [];
  let part = '';
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')' && depth > 0) depth--;
    const inNumber = isDigit(value[i - 1]) && isDigit(value[i + 1]);
    if (depth === 0 && !inNumber && (c === ',' || c === ';' || c === '/')) {
      parts.push(part);
      part = '';
    } else {
      part += c;
    }
  }
  parts.push(part);
  return parts.map((p) => p.trim()).filter((p) => answerKey(p) !== '');
}

/** The keys of these texts, with a mark gap as a space and as nothing. */
function keysOf(texts: string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts) {
    for (const gap of [' ', ''] as const) {
      const key = answerKey(text, gap);
      if (key !== '') keys.add(key);
    }
  }
  return keys;
}

/**
 * Whether `given` is `expected`. The answer may be written as is, without the
 * parenthesis marks ("(to) run" as "to run"), or without what is in
 * parentheses ("Apfel (m)" as "Apfel") — that last one only when something
 * is left, so "(noun)" still has to be typed.
 *
 * What is typed in parentheses counts when the answer has parentheses of its
 * own: it may be left out, but if it is typed it has to be right ("Apfel (f)"
 * is not "Apfel (m)", and "déjeuner (àmidi)" is as wrong as "déjeuner
 * àmidi"). Only when the answer has none is a typed note ignored ("casa (f)"
 * for "casa").
 */
export function isMatch(given: string, expected: string, check: AnswerCheck = 'exact'): boolean {
  if (check === 'easier') {
    const alternatives = splitAlternatives(expected);
    if (alternatives.length > 1 && alternatives.some((one) => matches(given, one))) return true;
  }
  return matches(given, expected);
}

function matches(given: string, expected: string): boolean {
  const want = keysOf([expected, stripParenChars(expected), stripParens(expected)]);

  // An answer that is nothing but punctuation ("?", "...") has no key, and
  // would otherwise accept anything; compare those as typed instead.
  if (want.size === 0) {
    const plain = (v: string) => stripSpaces(foldAnswer(v));
    return plain(expected) !== '' && plain(given) === plain(expected);
  }

  const answerHasNote = stripParens(expected) !== expected;
  const typed = [given, stripParenChars(given)];
  if (!answerHasNote) typed.push(stripParens(given));
  for (const key of keysOf(typed)) {
    if (want.has(key)) return true;
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
    hinted: [],
    credits: Object.fromEntries(ids.map((id) => [id, 0])),
    rounds: [],
  };
}

export function currentCard(session: WriteSession): StudyCard | null {
  if (session.step.kind === 'summary') return null;
  const id = session.queue[session.index];
  return session.cards.find((card) => card.id === id) ?? null;
}

export function submitAnswer(session: WriteSession, given: string, check: AnswerCheck = 'exact'): WriteSession {
  const card = currentCard(session);
  // An empty submit is not an answer. The page turns an empty Enter into
  // dontKnow() itself, so the timing guard against a stray Enter lives there.
  if (!card || session.step.kind !== 'ask' || given.trim() === '') return session;

  const hinted = session.step.hinted === true;
  if (isMatch(given, answerOf(card, session.answerWith), check)) {
    return right(session, card, given, false, hinted);
  }
  return miss(session, card, given, hinted);
}

/** Show the hint for the card being asked (each word's first letter). */
export function showHint(session: WriteSession): WriteSession {
  if (session.step.kind !== 'ask' || session.step.hinted || !currentCard(session)) return session;
  return { ...session, step: { kind: 'ask', hinted: true } };
}

/** A right answer: mastered, or with the hint one credit and back next round. */
function right(session: WriteSession, card: StudyCard, given: string, overridden: boolean, hinted: boolean): WriteSession {
  const missed = session.missed.filter((id) => id !== card.id);
  if (hinted) {
    return {
      ...session,
      step: { kind: 'correct', given, overridden, hinted: true },
      missed,
      hinted: session.hinted.includes(card.id) ? session.hinted : [...session.hinted, card.id],
      credits: { ...session.credits, [card.id]: Math.max(session.credits[card.id] ?? 0, 1) },
    };
  }
  return {
    ...session,
    step: { kind: 'correct', given, overridden },
    missed,
    credits: { ...session.credits, [card.id]: MASTERY_CREDITS },
  };
}

export const otherSide = (side: AnswerWith): AnswerWith => (side === 'term' ? 'definition' : 'term');

/**
 * Answer with the other side from this card on. Only while a card is being
 * asked: with a verdict showing, the answer on screen belongs to the old side.
 * The hint goes (it was for the old side); nothing else changes: the round,
 * the misses and the mastery carry on.
 */
export function switchSides(session: WriteSession): WriteSession {
  if (session.step.kind !== 'ask' || !currentCard(session)) return session;
  return { ...session, answerWith: otherSide(session.answerWith), step: { kind: 'ask' } };
}

export function dontKnow(session: WriteSession): WriteSession {
  const card = currentCard(session);
  if (!card || session.step.kind !== 'ask') return session;
  return miss(session, card, null, false);
}

function miss(session: WriteSession, card: StudyCard, given: string | null, hinted: boolean): WriteSession {
  return {
    ...session,
    step: hinted ? { kind: 'reveal', given, hinted: true } : { kind: 'reveal', given },
    missed: [...session.missed, card.id],
  };
}

/**
 * "I was correct": a typed answer the check did not take (a typo, a synonym),
 * or an empty Enter / "don't know" that was a slip of the finger.
 */
export function overrideCorrect(session: WriteSession): WriteSession {
  const card = currentCard(session);
  const { step } = session;
  if (!card || step.kind !== 'reveal') return session;
  return right(session, card, step.given ?? '', true, step.hinted === true);
}

/**
 * The retype after a miss. Returns the same session object when the text does
 * not match yet, which is how the screen knows to say so.
 */
export function submitRetype(session: WriteSession, typed: string, check: AnswerCheck = 'exact'): WriteSession {
  const card = currentCard(session);
  if (!card || session.step.kind !== 'reveal') return session;
  if (!isMatch(typed, answerOf(card, session.answerWith), check)) return session;

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

  return { ...session, index, step: { kind: 'summary' }, rounds: [...session.rounds, roundSummary(session)] };
}

/** The round on record once it is over. */
export function roundSummary(session: WriteSession): RoundSummary {
  const total = session.queue.length;
  const missed = session.missed.length;
  const hinted = session.hinted.length;
  return { round: session.round, total, missed, hinted, accuracy: percent(total - missed - hinted, total) };
}

/** The cards the next round asks: the misses, then the ones answered with the hint. */
export function cardsAgain(session: WriteSession): number[] {
  return [...session.missed, ...session.hinted.filter((id) => !session.missed.includes(id))];
}

/** From a summary with misses (or hinted answers): a round of only those cards. */
export function startNextRound(
  session: WriteSession,
  random: () => number = Math.random,
): WriteSession {
  const again = cardsAgain(session);
  if (session.step.kind !== 'summary' || again.length === 0) return session;
  return {
    ...session,
    round: session.round + 1,
    queue: session.shuffled ? shuffle(again, random) : again,
    index: 0,
    step: { kind: 'ask' },
    missed: [],
    hinted: [],
  };
}

// --- reading a session ---

export function isFinished(session: WriteSession): boolean {
  return session.step.kind === 'summary' && cardsAgain(session).length === 0;
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
