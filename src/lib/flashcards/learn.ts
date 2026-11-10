// Learn mode: a session over one set as a pure state machine, in the shape of
// write.ts — every function takes a session and returns the next one, or the
// same object when the move does not apply.
//
// The screen fetches every card in the set with its progress, puts them in
// session order (sessionOrder: the cards not learned yet first, then the
// learned ones, each part shuffled) and walks them. Each answer is graded 0–5
// and saved (POST /api/cards/:id/review) before the next card appears. There
// is no day cycle: every answer counts whenever it is given, and a finished
// session can be started again straight away.
//
// A missed card comes back RETRY_GAP questions later — at the end, if fewer
// are left — until it is answered right.
//
// What kind of question a card gets:
//
//   • repetitionNumber 0 — new, or missed last time — or back after a miss
//     in this session: multiple choice, the answer among three distractors
//     from the same set (see distractors.ts). About one in four of these is
//     typed instead (WRITTEN_MIX), so multiple choice does not come in blocks.
//   • repetitionNumber 1 or more: written, the answer typed as in write mode.
//   • A set too small to supply distractors is written throughout.
//
// Nobody is asked to rate themselves; the grade comes from what they did:
//
//   correct, within the time budget, no hint ....... 5
//   correct, but over budget or with the hint ...... 4
//   correct, but over the slow budget .............. 3
//   wrong, then "I basically knew it" .............. 2
//   wrong .......................................... 1
//   "no idea" ...................................... 0
//
// "I was correct" on a typed answer (a typo, a synonym) counts as correct,
// though never above a 4 — what was typed was not quite the card's answer.
//
// The time budget grows with how much there is to read and to type, so a
// long definition is not graded as a slow answer. The screen measures the
// time and leaves out any the app spent in the background.

import { DISTRACTOR_COUNT, pickDistractors } from './distractors';
import { shuffle } from './shuffle';
import { PASSING_QUALITY, type Quality } from './sm2';
import type { LearnCardDTO } from './types';
import { answerOf, isMatch, promptOf, type AnswerWith, type StudyCard } from './write';

export type Question =
  /** `options` is the answer card and its distractors, shuffled. */
  | { kind: 'choice'; options: StudyCard[] }
  | { kind: 'written' };

export type LearnStep =
  /** Waiting for an answer. `hinted` once the written hint is showing. */
  | { kind: 'ask'; hinted: boolean }
  | { kind: 'correct'; given: string; quality: Quality; overridden: boolean }
  /**
   * Answered wrong (`given` is what was typed or picked) or gave up (`given`
   * null). A wrong answer's `quality` stays null until it is marked "I
   * basically knew it" or not; giving up is a 0 straight away.
   */
  | {
      kind: 'miss';
      given: string | null;
      quality: Quality | null;
      elapsedMs: number;
      hinted: boolean;
    }
  /** An in-between checkpoint (like Quizlet) showing batch progress */
  | { kind: 'checkpoint'; batchNumber: number }
  | { kind: 'summary' };

export type Graded = { cardId: number; quality: Quality };

/** One card to ask. */
export type Turn = {
  card: LearnCardDTO;
  /** Asked again after a miss earlier in this session. */
  retry: boolean;
};

export type LearnSession = {
  /** The initial cards in the session */
  cards: LearnCardDTO[];
  /** Every question in asking order. A miss adds the card again further on. */
  turns: Turn[];
  /** The whole set, where distractors come from. */
  pool: StudyCard[];
  answerWith: AnswerWith;
  index: number;
  /** The question for turns[index]; null on checkpoint or summary. */
  question: Question | null;
  step: LearnStep;
  /** Answers graded and moved past, oldest first — a retried card more than once. */
  graded: Graded[];
  /** Correct answers per card id in this session (0, 1, or 2 to master). */
  credits: Record<number, number>;
  /** Questions answered since the last checkpoint */
  cardsSinceCheckpoint: number;
  /** Number of checkpoints passed */
  checkpointBatch: number;
};

/** A missed card comes back after this many other questions. */
export const RETRY_GAP = 3;
/** The share of would-be multiple-choice questions asked as written instead. */
export const WRITTEN_MIX = 0.25;
/** Questions per checkpoint batch (in-betweens like Quizlet) */
export const CHECKPOINT_INTERVAL = 5;
/** Answers needed to master a card in Learn mode (like Quizlet) */
export const MASTERY_GOAL = 2;

// --- grading ---

export type TimeBudget = { fastMs: number; slowMs: number };

/** Allowance before any reading or typing: finding the answer in your head. */
export const THINK_MS = 4000;
/** About 250 words a minute. */
export const READ_MS_PER_CHAR = 45;
/** About 40 words a minute, which is quick on a phone keyboard. */
export const TYPE_MS_PER_CHAR = 300;
/** "Slow" is this many times the fast budget. */
export const SLOW_FACTOR = 2.5;

export const QUALITY_LABEL: Record<Quality, string> = {
  5: 'perfect recall',
  4: 'took a moment',
  3: 'hard',
  2: 'almost',
  1: 'missed',
  0: 'no idea',
};

export function timeBudget(
  card: StudyCard,
  question: Question,
  answerWith: AnswerWith,
): TimeBudget {
  let reading = promptOf(card, answerWith).length;
  let typing = 0;
  if (question.kind === 'choice') {
    for (const option of question.options) reading += answerOf(option, answerWith).length;
  } else {
    typing = answerOf(card, answerWith).length;
  }
  const fastMs = THINK_MS + reading * READ_MS_PER_CHAR + typing * TYPE_MS_PER_CHAR;
  return { fastMs, slowMs: fastMs * SLOW_FACTOR };
}

/** The grade for a correct answer, from how long it took and whether the hint was used. */
export function correctQuality(elapsedMs: number, budget: TimeBudget, hinted: boolean): 3 | 4 | 5 {
  if (elapsedMs > budget.slowMs) return 3;
  if (hinted || elapsedMs > budget.fastMs) return 4;
  return 5;
}

/**
 * The written hint: each word's first letter, the rest blanked, punctuation
 * and spacing kept — "cell wall" → "c___ w___".
 */
export function hintFor(answer: string): string {
  return answer.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const [first, ...rest] = Array.from(word);
    return first + '_'.repeat(rest.length);
  });
}

// --- session ---

/**
 * The order a session asks a set in: the cards not learned yet (new and still
 * learning) first, then the learned ones, each part shuffled — so typed and
 * new multiple-choice cards come mixed rather than one group after the other.
 */
export function sessionOrder(
  cards: LearnCardDTO[],
  random: () => number = Math.random,
): LearnCardDTO[] {
  const toLearn = cards.filter((card) => card.status !== 'learned');
  const learned = cards.filter((card) => card.status === 'learned');
  return [...shuffle(toLearn, random), ...shuffle(learned, random)];
}

/** A session asking `cards` in the order given. */
export function startLearn(
  cards: LearnCardDTO[],
  pool: StudyCard[],
  answerWith: AnswerWith,
  random: () => number = Math.random,
): LearnSession {
  const session: LearnSession = {
    cards,
    turns: cards.map((card) => ({ card, retry: false })),
    pool,
    answerWith,
    index: 0,
    question: null,
    step: { kind: 'summary' },
    graded: [],
    credits: Object.fromEntries(cards.map((c) => [c.id, 0])),
    cardsSinceCheckpoint: 0,
    checkpointBatch: 1,
  };
  return cards.length > 0 ? ask(session, 0, random) : session;
}

/** The question for the turn at `session.index`. */
export function questionFor(
  session: Pick<LearnSession, 'turns' | 'index' | 'pool' | 'answerWith'> & {
    credits?: Record<number, number>;
  },
  random: () => number = Math.random,
): Question {
  const { card, retry } = session.turns[session.index];
  const credit = session.credits?.[card.id] ?? 0;
  // If the card already has 1 credit, it MUST be typed (written) to master (like Quizlet)!
  if (credit >= 1) return { kind: 'written' };
  if (!retry && (card.progress?.repetitionNumber ?? 0) > 0) return { kind: 'written' };
  if (random() < WRITTEN_MIX) return { kind: 'written' };

  const answer = toStudyCard(card);
  // Answers still to be asked are distractors of last resort (see distractors.ts).
  const avoidIds = new Set(session.turns.slice(session.index + 1).map((turn) => turn.card.id));
  avoidIds.delete(card.id);

  const distractors = pickDistractors(answer, session.pool, DISTRACTOR_COUNT, {
    side: session.answerWith,
    avoidIds,
    random,
  });
  if (distractors.length < DISTRACTOR_COUNT) return { kind: 'written' };
  return { kind: 'choice', options: shuffle([answer, ...distractors], random) };
}

function ask(session: LearnSession, index: number, random: () => number): LearnSession {
  return {
    ...session,
    index,
    question: questionFor({ ...session, index }, random),
    step: { kind: 'ask', hinted: false },
  };
}

function toStudyCard(card: StudyCard): StudyCard {
  return { id: card.id, term: card.term, definition: card.definition };
}

export function currentTurn(session: LearnSession): Turn | null {
  if (session.step.kind === 'summary' || session.step.kind === 'checkpoint') return null;
  return session.turns[session.index] ?? null;
}

export function currentCard(session: LearnSession): LearnCardDTO | null {
  return currentTurn(session)?.card ?? null;
}

export function answerChoice(
  session: LearnSession,
  optionId: number,
  elapsedMs: number,
): LearnSession {
  const card = currentCard(session);
  const { question } = session;
  if (!card || session.step.kind !== 'ask' || question?.kind !== 'choice') return session;
  const option = question.options.find((o) => o.id === optionId);
  if (!option) return session;

  const given = answerOf(option, session.answerWith);
  if (option.id === card.id) {
    const quality = correctQuality(elapsedMs, timeBudget(card, question, session.answerWith), false);
    return { ...session, step: { kind: 'correct', given, quality, overridden: false } };
  }
  return {
    ...session,
    step: { kind: 'miss', given, quality: null, elapsedMs, hinted: false },
  };
}

export function answerWritten(session: LearnSession, text: string, elapsedMs: number): LearnSession {
  const card = currentCard(session);
  const { question, step } = session;
  // An empty submit is not an answer. The page turns an empty Enter into
  // giveUp() itself, so the timing guard against a stray Enter lives there.
  if (!card || step.kind !== 'ask' || question?.kind !== 'written' || text.trim() === '') {
    return session;
  }

  if (isMatch(text, answerOf(card, session.answerWith))) {
    const budget = timeBudget(card, question, session.answerWith);
    const quality = correctQuality(elapsedMs, budget, step.hinted);
    return { ...session, step: { kind: 'correct', given: text, quality, overridden: false } };
  }
  return {
    ...session,
    step: { kind: 'miss', given: text, quality: null, elapsedMs, hinted: step.hinted },
  };
}

export function showHint(session: LearnSession): LearnSession {
  const { step } = session;
  if (step.kind !== 'ask' || step.hinted || session.question?.kind !== 'written') return session;
  return { ...session, step: { kind: 'ask', hinted: true } };
}

/** "No idea": graded 0 on the spot, and the answer is shown. */
export function giveUp(session: LearnSession): LearnSession {
  if (!currentCard(session) || session.step.kind !== 'ask') return session;
  return {
    ...session,
    step: { kind: 'miss', given: null, quality: 0, elapsedMs: 0, hinted: session.step.hinted },
  };
}

/** After a wrong answer: "I basically knew it". */
export function markKnewIt(session: LearnSession): LearnSession {
  return gradeMiss(session, 2);
}

/** After a wrong answer: move on without a claim. */
export function markWrong(session: LearnSession): LearnSession {
  return gradeMiss(session, 1);
}

function gradeMiss(session: LearnSession, quality: 1 | 2): LearnSession {
  const { step } = session;
  if (step.kind !== 'miss' || step.given === null || step.quality !== null) return session;
  return { ...session, step: { ...step, quality } };
}

/** "I was correct" on a wrong answer: correct after all, but at most a 4. */
export function overrideCorrect(session: LearnSession): LearnSession {
  const card = currentCard(session);
  const { question, step } = session;
  if (
    !card ||
    step.kind !== 'miss' ||
    step.given === null ||
    step.quality !== null
  ) {
    return session;
  }

  const budget = timeBudget(card, question!, session.answerWith);
  const quality = Math.min(4, correctQuality(step.elapsedMs, budget, step.hinted)) as Quality;
  return { ...session, step: { kind: 'correct', given: step.given, quality, overridden: true } };
}

/** The grade decided for the card on screen and not yet moved past, or null. */
export function pendingQuality(session: LearnSession): Quality | null {
  const { step } = session;
  return step.kind === 'correct' || step.kind === 'miss' ? step.quality : null;
}

/**
 * On to the next card — only once the current one has its grade.
 * A miss puts the card back RETRY_GAP questions on (with retry: true).
 * A correct answer awards 1 credit; if it still needs a second correct answer
 * to master (credits < MASTERY_GOAL), it is queued to be typed later in the session.
 * Learning is only completed after every word is typed right twice (like Quizlet).
 * Checkpoints ("in-betweens") appear every CHECKPOINT_INTERVAL questions.
 */
export function advance(session: LearnSession, random: () => number = Math.random): LearnSession {
  const turn = currentTurn(session);
  const quality = pendingQuality(session);
  if (!turn || quality === null) return session;

  const graded = [...session.graded, { cardId: turn.card.id, quality }];
  let { turns } = session;

  const isCorrect = quality >= PASSING_QUALITY;
  const oldCredit = session.credits?.[turn.card.id] ?? 0;
  const newCredit = isCorrect ? Math.min(MASTERY_GOAL, oldCredit + 1) : 0;
  const credits = { ...(session.credits ?? {}), [turn.card.id]: newCredit };

  if (!isCorrect) {
    const at = Math.min(session.index + 1 + RETRY_GAP, turns.length);
    turns = [...turns.slice(0, at), { card: turn.card, retry: true }, ...turns.slice(at)];
  } else if (newCredit < MASTERY_GOAL) {
    turns = [...turns, { card: turn.card, retry: false }];
  }

  const cardsSinceCheckpoint = (session.cardsSinceCheckpoint ?? 0) + 1;
  const allCards = session.cards?.length
    ? session.cards
    : session.turns.filter((t) => !t.retry).map((t) => t.card);
  const allMastered =
    allCards.length > 0 &&
    allCards.every((c) => (credits[c.id] ?? 0) >= MASTERY_GOAL);

  const index = session.index + 1;

  // 1. If every card is mastered (typed right twice), session is completely finished!
  if (allMastered) {
    return {
      ...session,
      turns,
      index,
      question: null,
      step: { kind: 'summary' },
      graded,
      credits,
      cardsSinceCheckpoint: 0,
    };
  }

  // 2. In-between checkpoint: trigger after CHECKPOINT_INTERVAL questions or when reaching round end
  const atEndOfTurns = index >= turns.length;
  if (cardsSinceCheckpoint >= CHECKPOINT_INTERVAL || atEndOfTurns) {
    return {
      ...session,
      turns,
      index,
      question: null,
      step: { kind: 'checkpoint', batchNumber: session.checkpointBatch ?? 1 },
      graded,
      credits,
      cardsSinceCheckpoint: 0,
      checkpointBatch: (session.checkpointBatch ?? 1) + 1,
    };
  }

  return ask(
    { ...session, turns, graded, credits, cardsSinceCheckpoint },
    index,
    random,
  );
}

/** Resumes past an in-between checkpoint into the next question. */
export function resumeCheckpoint(
  session: LearnSession,
  random: () => number = Math.random,
): LearnSession {
  if (session.step.kind !== 'checkpoint') return session;
  if (session.index < session.turns.length) {
    return ask(session, session.index, random);
  }
  const allCards = session.cards?.length
    ? session.cards
    : session.turns.filter((t) => !t.retry).map((t) => t.card);
  const unmastered = allCards.filter((c) => (session.credits?.[c.id] ?? 0) < MASTERY_GOAL);
  if (unmastered.length === 0) {
    return { ...session, question: null, step: { kind: 'summary' } };
  }
  const newTurns = [...session.turns, ...unmastered.map((card) => ({ card, retry: false }))];
  return ask({ ...session, turns: newTurns }, session.index, random);
}

/**
 * "Stop", between cards. Every answer so far is already saved, so this only
 * ends the walk; `index` stays put for resume.
 */
export function endSession(session: LearnSession): LearnSession {
  if (session.step.kind !== 'ask') return session;
  return { ...session, question: null, step: { kind: 'summary' } };
}

export function resume(session: LearnSession, random: () => number = Math.random): LearnSession {
  if (session.step.kind !== 'summary') return session;
  if (session.index < session.turns.length) {
    return ask(session, session.index, random);
  }
  const allCards = session.cards?.length
    ? session.cards
    : session.turns.filter((t) => !t.retry).map((t) => t.card);
  const unmastered = allCards.filter((c) => (session.credits?.[c.id] ?? 0) < MASTERY_GOAL);
  if (unmastered.length === 0) return session;
  const newTurns = [...session.turns, ...unmastered.map((card) => ({ card, retry: false }))];
  return ask({ ...session, turns: newTurns }, session.index, random);
}

// --- reading a session ---

export function summarize(session: LearnSession) {
  const allCards = session.cards?.length
    ? session.cards
    : session.turns.filter((turn) => !turn.retry).map((t) => t.card);
  const totalCards = allCards.length;
  const right = session.graded.filter((g) => g.quality >= PASSING_QUALITY).length;
  const missed = session.graded.length - right;

  const mastered = allCards.filter((c) => (session.credits?.[c.id] ?? 0) >= MASTERY_GOAL).length;
  const learning = allCards.filter((c) => (session.credits?.[c.id] ?? 0) === 1).length;
  const unstudied = Math.max(0, totalCards - mastered - learning);
  const settled = (pendingQuality(session) ?? 0) >= PASSING_QUALITY ? 1 : 0;
  const remaining = Math.max(0, session.turns.length - session.index - settled);

  return {
    cards: totalCards,
    right,
    missed,
    mastered,
    learning,
    unstudied,
    remaining,
    round: session.checkpointBatch ?? 1,
  };
}
