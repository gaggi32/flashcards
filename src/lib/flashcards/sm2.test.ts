import { describe, expect, it } from 'vitest';

import {
  applyReview,
  applySM2,
  MIN_EASE,
  NEW_SCHEDULE,
  type Quality,
  type ReviewedSchedule,
  type Schedule,
} from './sm2';

const TODAY = '2026-09-15';
const NOW = new Date('2026-09-15T08:30:00.000Z');

/** Reviews one card on time, once per grade, starting from `start`. */
function reviewSequence(grades: Quality[], start: Schedule = NEW_SCHEDULE) {
  let schedule: Schedule = start;
  let day = TODAY;
  const steps: ReviewedSchedule[] = [];
  for (const quality of grades) {
    const next = applySM2(schedule, quality, day, NOW);
    steps.push(next);
    schedule = next;
    day = next.nextReviewDate;
  }
  return steps;
}

describe('applySM2 — first review of a new card', () => {
  it.each([
    // quality, repetitionNumber, intervalDays, easeFactor, nextReviewDate
    [5, 1, 1, 2.6, '2026-09-16'],
    [4, 1, 1, 2.5, '2026-09-16'],
    [3, 1, 1, 2.36, '2026-09-16'],
    [2, 0, 1, 2.5, '2026-09-16'],
    [1, 0, 1, 2.5, '2026-09-16'],
    [0, 0, 1, 2.5, '2026-09-16'],
  ] as const)(
    'quality %i → n=%i, I=%i, EF=%f, due %s',
    (quality, repetitionNumber, intervalDays, easeFactor, nextReviewDate) => {
      expect(applySM2(NEW_SCHEDULE, quality, TODAY, NOW)).toEqual({
        repetitionNumber,
        intervalDays,
        easeFactor,
        nextReviewDate,
        lastReviewedAt: NOW,
      });
    },
  );

  it('does not mutate the schedule it was given', () => {
    const before = { ...NEW_SCHEDULE };
    applySM2(NEW_SCHEDULE, 5, TODAY, NOW);
    expect(NEW_SCHEDULE).toEqual(before);
  });
});

describe('applySM2 — intervals grow 1, 6, then × EF', () => {
  it('uses the ease factor from before the review for the third interval', () => {
    const [first, second, third, fourth] = reviewSequence([5, 5, 5, 5]);

    expect(first).toMatchObject({ repetitionNumber: 1, intervalDays: 1, easeFactor: 2.6 });
    expect(second).toMatchObject({ repetitionNumber: 2, intervalDays: 6, easeFactor: 2.7 });
    // round(6 × 2.7) = 16, and only then does EF move on to 2.8.
    expect(third).toMatchObject({ repetitionNumber: 3, intervalDays: 16, easeFactor: 2.8 });
    // round(16 × 2.8) = round(44.8) = 45.
    expect(fourth).toMatchObject({ repetitionNumber: 4, intervalDays: 45, easeFactor: 2.9 });
  });

  it('dates each review from the day it happened', () => {
    const steps = reviewSequence([5, 5, 5]);
    expect(steps.map((s) => s.nextReviewDate)).toEqual([
      '2026-09-16', // +1
      '2026-09-22', // +6
      '2026-10-08', // +16, across the month boundary
    ]);
  });

  it('crosses a year boundary', () => {
    const next = applySM2(
      { repetitionNumber: 5, easeFactor: 2.5, intervalDays: 10 },
      4,
      '2026-12-20',
      NOW,
    );
    expect(next.intervalDays).toBe(25);
    expect(next.nextReviewDate).toBe('2027-01-14');
  });
});

describe('applySM2 — a card failed after several successes', () => {
  // Two hard reviews along the way drag EF down from 2.5 before the lapse.
  const [, , , beforeLapse, lapse, relearn1, relearn2, relearn3] = reviewSequence([
    4, 3, 5, 3, 1, 4, 4, 4,
  ]);

  it('builds up a streak with a lowered ease factor', () => {
    // 2.5 → 2.5 (4) → 2.36 (3) → 2.46 (5) → 2.32 (3)
    expect(beforeLapse.repetitionNumber).toBe(4);
    expect(beforeLapse.easeFactor).toBe(2.32);
    expect(beforeLapse.intervalDays).toBeGreaterThan(6);
  });

  it('resets the streak and interval on the lapse, keeping the ease factor', () => {
    expect(lapse.repetitionNumber).toBe(0);
    expect(lapse.intervalDays).toBe(1);
    expect(lapse.easeFactor).toBe(beforeLapse.easeFactor);
  });

  it('relearns from the start of the interval ladder at the lowered ease', () => {
    expect(relearn1).toMatchObject({ repetitionNumber: 1, intervalDays: 1, easeFactor: 2.32 });
    expect(relearn2).toMatchObject({ repetitionNumber: 2, intervalDays: 6, easeFactor: 2.32 });
    // round(6 × 2.32) = round(13.92) = 14 — shorter than the 15 an unhurt
    // 2.5 would have given.
    expect(relearn3).toMatchObject({ repetitionNumber: 3, intervalDays: 14, easeFactor: 2.32 });
  });

  it.each([0, 1, 2] as const)('treats quality %i the same way', (quality) => {
    const next = applySM2(beforeLapse, quality, TODAY, NOW);
    expect(next).toMatchObject({
      repetitionNumber: 0,
      intervalDays: 1,
      easeFactor: beforeLapse.easeFactor,
      nextReviewDate: '2026-09-16',
    });
  });
});

describe('applySM2 — ease factor floor', () => {
  it('never takes the ease factor below 1.3', () => {
    const steps = reviewSequence([3, 3, 3, 3, 3, 3, 3, 3]);
    // 2.5 → 2.36 → 2.22 → 2.08 → 1.94 → 1.8 → 1.66 → 1.52 → 1.38
    expect(steps.map((s) => s.easeFactor)).toEqual([
      2.36, 2.22, 2.08, 1.94, 1.8, 1.66, 1.52, 1.38,
    ]);
    const clamped = applySM2(steps[steps.length - 1], 3, TODAY, NOW);
    expect(clamped.easeFactor).toBe(MIN_EASE); // 1.38 − 0.14 = 1.24 → 1.3
  });

  it('holds at the floor rather than creeping below it', () => {
    const atFloor = { repetitionNumber: 6, easeFactor: MIN_EASE, intervalDays: 10 };
    const next = applySM2(atFloor, 3, TODAY, NOW);
    expect(next.easeFactor).toBe(MIN_EASE);
    // The interval still uses the floored EF: round(10 × 1.3) = 13.
    expect(next.intervalDays).toBe(13);
  });

  it('can climb back up from the floor with good answers', () => {
    const atFloor = { repetitionNumber: 6, easeFactor: MIN_EASE, intervalDays: 10 };
    expect(applySM2(atFloor, 5, TODAY, NOW).easeFactor).toBe(1.4);
  });
});

describe('applySM2 — input checks', () => {
  it.each([-1, 6, 2.5, Number.NaN])('rejects quality %s', (quality) => {
    expect(() => applySM2(NEW_SCHEDULE, quality as Quality, TODAY, NOW)).toThrow(RangeError);
  });
});

describe('applyReview — no day cycle', () => {
  const stored = { repetitionNumber: 1, easeFactor: 2.6, intervalDays: 1 };

  it('takes the full SM-2 step for a new card', () => {
    expect(applyReview(null, 5, TODAY, NOW)).toEqual(applySM2(NEW_SCHEDULE, 5, TODAY, NOW));
  });

  it('counts a right answer however soon after the last one', () => {
    const first = applyReview(null, 5, TODAY, NOW)!;
    const second = applyReview(first, 5, TODAY, NOW)!;
    expect(first.repetitionNumber).toBe(1);
    expect(second.repetitionNumber).toBe(2);
  });

  it('counts a lapse and restarts the streak', () => {
    expect(applyReview(stored, 1, TODAY, NOW)).toMatchObject({ repetitionNumber: 0 });
  });

  it('applies when the streak the client saw is the stored one', () => {
    expect(applyReview(null, 5, TODAY, NOW, null)).toMatchObject({ repetitionNumber: 1 });
    expect(applyReview(stored, 4, TODAY, NOW, 1)).toEqual(applySM2(stored, 4, TODAY, NOW));
  });

  it('skips a retried review that was already counted', () => {
    // Seen as never reviewed, but the first send already created the row.
    const first = applyReview(null, 5, TODAY, NOW, null)!;
    expect(applyReview(first, 5, TODAY, NOW, null)).toBeNull();
    // Seen at streak 1, already moved on to 2.
    const moved = applyReview(stored, 5, TODAY, NOW, 1)!;
    expect(applyReview(moved, 5, TODAY, NOW, 1)).toBeNull();
  });
});
