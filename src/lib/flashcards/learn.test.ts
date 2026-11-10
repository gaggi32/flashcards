import { describe, expect, it } from 'vitest';

import {
  advance,
  answerChoice,
  answerWritten,
  correctQuality,
  currentCard,
  endSession,
  giveUp,
  hintFor,
  markKnewIt,
  markWrong,
  overrideCorrect,
  pendingQuality,
  questionFor,
  resume,
  resumeCheckpoint,
  RETRY_GAP,
  sessionOrder,
  showHint,
  startLearn,
  summarize,
  timeBudget,
  WRITTEN_MIX,
  type LearnSession,
  type Turn,
} from './learn';
import type { LearnCardDTO, LearnStatus } from './types';

const POOL = [
  { id: 1, term: 'mitochondrion', definition: 'Makes energy for the cell' },
  { id: 2, term: 'ribosome', definition: 'Builds proteins from RNA' },
  { id: 3, term: 'nucleus', definition: 'Holds the genetic material' },
  { id: 4, term: 'lysosome', definition: 'Breaks down cell waste' },
  { id: 5, term: 'vacuole', definition: 'Stores water and nutrients' },
  { id: 6, term: 'chloroplast', definition: 'Captures light for photosynthesis' },
];

function queued(id: number, repetitionNumber: number | null, status?: LearnStatus): LearnCardDTO {
  const card = POOL.find((c) => c.id === id)!;
  return {
    ...card,
    position: id,
    status:
      status ??
      (repetitionNumber === null ? 'new' : repetitionNumber >= 2 ? 'learned' : 'learning'),
    progress:
      repetitionNumber === null
        ? null
        : {
            cardId: id,
            repetitionNumber,
            easeFactor: 2.5,
            intervalDays: 1,
            nextReviewDate: '2026-09-15',
            lastReviewedAt: null,
          },
  };
}

/** Never below WRITTEN_MIX, so a card that can be multiple choice is. */
const NO_MIX = () => 0.5;

const FAST = 1;
const MOMENT = (s: LearnSession) => budgetOf(s).fastMs + 1;
const SLOW = (s: LearnSession) => budgetOf(s).slowMs + 1;

function budgetOf(session: LearnSession) {
  return timeBudget(currentCard(session)!, session.question!, session.answerWith);
}

function ask(turn: Turn, pool = POOL, random = NO_MIX) {
  return questionFor({ turns: [turn], index: 0, pool, answerWith: 'term' }, random);
}

describe('question type', () => {
  it('asks never-studied and just-missed cards as multiple choice', () => {
    for (const card of [queued(1, null), queued(1, 0)]) {
      const question = ask({ card, retry: false });
      expect(question.kind).toBe('choice');
      if (question.kind !== 'choice') continue;
      expect(question.options).toHaveLength(4);
      expect(question.options.map((o) => o.id)).toContain(1);
    }
  });

  it('asks some of those as written instead, for a mix', () => {
    const card = queued(1, null);
    expect(ask({ card, retry: false }, POOL, () => WRITTEN_MIX - 0.01)).toEqual({
      kind: 'written',
    });
    expect(ask({ card, retry: false }, POOL, () => WRITTEN_MIX).kind).toBe('choice');
  });

  it('asks cards answered right at least once as written', () => {
    for (const n of [1, 2, 7]) {
      expect(ask({ card: queued(1, n), retry: false })).toEqual({ kind: 'written' });
    }
  });

  it('asks a card back after a miss like a new one, whatever its streak was', () => {
    expect(ask({ card: queued(1, 4), retry: true }).kind).toBe('choice');
  });

  it('asks everything as written in a set under five cards', () => {
    const question = ask({ card: queued(1, null), retry: false }, POOL.slice(0, 4));
    expect(question).toEqual({ kind: 'written' });
  });
});

describe('session order', () => {
  it('puts every card not learned yet before the learned ones', () => {
    const cards = [
      queued(1, 2),
      queued(2, null),
      queued(3, 0),
      queued(4, 3),
      queued(5, 1),
    ];
    for (let run = 0; run < 20; run++) {
      const ids = sessionOrder(cards).map((c) => c.id);
      expect(ids.slice(0, 3).sort()).toEqual([2, 3, 5]);
      expect(ids.slice(3).sort()).toEqual([1, 4]);
    }
  });
});

describe('grading from behaviour', () => {
  it('maps correct answers to 5, 4 or 3 by time and hint', () => {
    const budget = { fastMs: 10_000, slowMs: 25_000 };
    expect(correctQuality(9_000, budget, false)).toBe(5);
    expect(correctQuality(12_000, budget, false)).toBe(4);
    expect(correctQuality(9_000, budget, true)).toBe(4);
    expect(correctQuality(30_000, budget, false)).toBe(3);
    expect(correctQuality(30_000, budget, true)).toBe(3);
  });

  it('gives longer answers a longer budget', () => {
    const short = { id: 1, term: 'ATP', definition: 'Energy' };
    const long = { id: 2, term: 'adenosine triphosphate', definition: 'Energy' };
    const written = { kind: 'written' } as const;
    expect(timeBudget(long, written, 'term').fastMs).toBeGreaterThan(
      timeBudget(short, written, 'term').fastMs,
    );
  });

  describe('a multiple-choice card', () => {
    const start = () => startLearn([queued(1, null)], POOL, 'term', () => 0.3);
    const wrongOption = (s: LearnSession) =>
      s.question!.kind === 'choice' ? s.question!.options.find((o) => o.id !== 1)!.id : -1;

    it('fast and right → 5', () => {
      const s = start();
      expect(pendingQuality(answerChoice(s, 1, FAST))).toBe(5);
    });

    it('right after a moment → 4, slow → 3', () => {
      const s = start();
      expect(pendingQuality(answerChoice(s, 1, MOMENT(s)))).toBe(4);
      expect(pendingQuality(answerChoice(s, 1, SLOW(s)))).toBe(3);
    });

    it('wrong waits for "I basically knew it" (2) or not (1)', () => {
      const s = answerChoice(start(), wrongOption(start()), FAST);
      expect(s.step.kind).toBe('miss');
      expect(pendingQuality(s)).toBeNull();
      expect(advance(s)).toBe(s); // cannot move on ungraded
      expect(pendingQuality(markKnewIt(s))).toBe(2);
      expect(pendingQuality(markWrong(s))).toBe(1);
    });

    it('no idea → 0', () => {
      expect(pendingQuality(giveUp(start()))).toBe(0);
    });

    it('a wrong pick can be overruled with "I was correct", at most a 4', () => {
      const s = answerChoice(start(), wrongOption(start()), FAST);
      const overruled = overrideCorrect(s);
      expect(overruled.step).toMatchObject({ kind: 'correct', overridden: true, quality: 4 });
    });

    it('"no idea" cannot be overruled', () => {
      const s = giveUp(start());
      expect(overrideCorrect(s)).toBe(s);
    });
  });

  describe('a written card', () => {
    const start = () => startLearn([queued(2, 1)], POOL, 'term');

    it('fast and right → 5, ignoring case and edge punctuation', () => {
      expect(pendingQuality(answerWritten(start(), '  Ribosome. ', FAST))).toBe(5);
    });

    it('with the hint → 4', () => {
      const hinted = showHint(start());
      expect(hinted.step).toEqual({ kind: 'ask', hinted: true });
      expect(pendingQuality(answerWritten(hinted, 'ribosome', FAST))).toBe(4);
    });

    it('slow → 3', () => {
      const s = start();
      expect(pendingQuality(answerWritten(s, 'ribosome', SLOW(s)))).toBe(3);
    });

    it('"I was correct" after a typo counts, capped at 4', () => {
      const missed = answerWritten(start(), 'ribosme', FAST);
      expect(missed.step.kind).toBe('miss');
      const overruled = overrideCorrect(missed);
      expect(overruled.step).toMatchObject({ kind: 'correct', overridden: true, quality: 4 });
    });

    it('ignores an empty submit', () => {
      const s = start();
      expect(answerWritten(s, '   ', FAST)).toBe(s);
    });
  });
});

describe('walking the session', () => {
  const ids = (s: LearnSession) => s.turns.map((t) => t.card.id);

  it('brings a miss back RETRY_GAP questions later', () => {
    // All written, so every question is typed.
    let s = startLearn(POOL.map((c) => queued(c.id, 1)), POOL, 'term', NO_MIX);
    expect(summarize(s).remaining).toBe(6);

    s = markWrong(answerWritten(s, 'nope', FAST));
    expect(summarize(s).remaining).toBe(6); // a miss does not finish the card

    s = advance(s, NO_MIX);
    expect(RETRY_GAP).toBe(3);
    expect(ids(s)).toEqual([1, 2, 3, 4, 1, 5, 6]);
    expect(s.turns[4].retry).toBe(true);
    expect(summarize(s)).toMatchObject({ cards: 6, right: 0, missed: 1, remaining: 6 });

    s = answerWritten(s, 'ribosome', FAST);
    expect(summarize(s).remaining).toBe(5); // right, not yet moved past
  });

  it('keeps asking until every card has been answered right twice to master', () => {
    const cards = [queued(1, null), queued(2, 1), queued(3, 3)];
    let s = startLearn(cards, POOL, 'term', NO_MIX);
    expect(currentCard(s)?.id).toBe(1);

    // Card 1 answered right once (choice) -> credit 1, queued for mastery
    s = advance(answerChoice(s, 1, FAST), NO_MIX);
    expect(currentCard(s)?.id).toBe(2);
    expect(s.question?.kind).toBe('written');

    // Cards 2 and 3 missed -> queued back
    s = advance(markWrong(answerWritten(s, 'nope', FAST)), NO_MIX);
    s = advance(giveUp(s), NO_MIX);
    expect(ids(s)).toEqual([1, 2, 3, 1, 2, 3]);

    // Card 1 comes up to be mastered as written (credit >= 1 requires typing!)
    expect(currentCard(s)?.id).toBe(1);
    expect(s.question?.kind).toBe('written');
    s = advance(answerWritten(s, 'mitochondrion', FAST), NO_MIX); // credit 2 -> mastered!

    // Cards 2 and 3 come back after miss (credit 0)
    expect(currentCard(s)?.id).toBe(2);
    expect(s.question?.kind).toBe('choice');
    s = advance(answerChoice(s, 2, FAST), NO_MIX); // 5th question answered -> triggers checkpoint!
    expect(s.step.kind).toBe('checkpoint');

    // Resume from checkpoint
    s = resumeCheckpoint(s, NO_MIX);

    // Card 3 answered right (credit 1) -> queued for mastery
    expect(currentCard(s)?.id).toBe(3);
    s = advance(answerChoice(s, 3, FAST), NO_MIX);

    // Cards 2 and 3 must now be typed to master!
    expect(currentCard(s)?.id).toBe(2);
    expect(s.question?.kind).toBe('written');
    s = advance(answerWritten(s, 'ribosome', FAST), NO_MIX); // credit 2 -> mastered!

    expect(currentCard(s)?.id).toBe(3);
    expect(s.question?.kind).toBe('written');
    s = advance(answerWritten(s, 'nucleus', FAST), NO_MIX); // credit 2 -> mastered!

    // All 3 cards mastered (answered right twice) -> session completed!
    expect(s.step.kind).toBe('summary');
    expect(summarize(s).mastered).toBe(3);
    expect(summarize(s).remaining).toBe(0);
    expect(resume(s)).toBe(s);
  });

  it('stops early between cards and picks up where it left off', () => {
    const cards = [queued(1, null), queued(2, 1), queued(3, 3)];
    let s = startLearn(cards, POOL, 'term', NO_MIX);
    s = advance(answerChoice(s, 1, FAST), NO_MIX);

    const graded = answerWritten(s, 'ribosome', FAST);
    expect(endSession(graded)).toBe(graded); // not mid-answer

    const stopped = endSession(s);
    expect(stopped.step.kind).toBe('summary');
    expect(summarize(stopped)).toMatchObject({ cards: 3, right: 1 });

    const resumed = resume(stopped);
    expect(currentCard(resumed)?.id).toBe(2);
  });

  it('starts on the summary for a set with no cards', () => {
    expect(startLearn([], POOL, 'term').step.kind).toBe('summary');
  });

  it('triggers checkpoints after every 5 questions', () => {
    const cards = [
      queued(1, 1),
      queued(2, 1),
      queued(3, 1),
      queued(4, 1),
      queued(5, 1),
      queued(6, 1),
    ];
    let s = startLearn(cards, POOL, 'term', NO_MIX);
    // Answer first 5 cards
    for (let i = 1; i <= 4; i++) {
      s = advance(answerWritten(s, POOL[i - 1].term, FAST), NO_MIX);
      expect(s.step.kind).toBe('ask');
    }
    // 5th answer triggers checkpoint
    s = advance(answerWritten(s, POOL[4].term, FAST), NO_MIX);
    expect(s.step.kind).toBe('checkpoint');
    expect(s.step).toEqual({ kind: 'checkpoint', batchNumber: 1 });

    // Resuming checkpoint allows asking the 6th card
    s = resumeCheckpoint(s, NO_MIX);
    expect(s.step.kind).toBe('ask');
    expect(currentCard(s)?.id).toBe(6);
  });
});

describe('helpers', () => {
  it('blanks all but the first letter of each word for the hint', () => {
    expect(hintFor('cell wall')).toBe('c___ w___');
    expect(hintFor("Newton's 2nd law!")).toBe("N_____'s 2__ l__!");
    expect(hintFor('Österreich')).toBe('Ö_________');
  });
});
