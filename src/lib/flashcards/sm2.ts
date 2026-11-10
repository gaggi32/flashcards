// SM-2, the SuperMemo 2 scheduling algorithm, as one pure function.
//
// Learn mode grades every answer 0–5 and hands the grade to applySM2 together
// with the card's current schedule; what comes back is the next schedule,
// which the review route stores as-is. No clock is read in here: "today" and
// "now" are arguments, so the same inputs always give the same schedule.
//
//   5  perfect recall             2  wrong, but it felt familiar
//   4  correct after hesitation   1  wrong
//   3  correct, but difficult     0  complete blackout
//
// The rules:
//
//   • quality < 3 — a lapse. The streak restarts (n = 0) and the card is due
//     again tomorrow (I = 1). The ease factor is left alone.
//   • quality >= 3 — n goes up by one, and the interval grows:
//       n = 1  →  I = 1 day
//       n = 2  →  I = 6 days
//       n > 2  →  I = round(previous I × EF), EF as it was before this review
//     then EF += 0.1 − (5 − q) × (0.08 + (5 − q) × 0.02), never below 1.3.
//     That is +0.10 for a 5, ±0 for a 4 and −0.14 for a 3.
//
// A new card answered 5, 5, 5, then 1 (reviewed on time each day):
//
//   review   n   I    EF    next review
//   5        1   1    2.6   day 1
//   5        2   6    2.7   day 7
//   5        3   16   2.8   day 23     (round(6 × 2.7) = 16)
//   1        0   1    2.8   day 24     (lapse: streak and interval reset, EF kept)

import { addDays } from '@/lib/nutrition/day';

export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

/** The three numbers SM-2 carries from one review to the next. */
export type Schedule = {
  /** n: consecutive reviews answered with quality >= 3. */
  repetitionNumber: number;
  /** EF: how fast the interval grows once the card is known. */
  easeFactor: number;
  /** I(n): days from this review to the next. */
  intervalDays: number;
};

export type ReviewedSchedule = Schedule & {
  /** YYYY-MM-DD: `today` plus the interval. */
  nextReviewDate: string;
  lastReviewedAt: Date;
};

export const INITIAL_EASE = 2.5;
export const MIN_EASE = 1.3;
/** The lowest grade that counts as remembering the card. */
export const PASSING_QUALITY = 3;

/** A card that has never been reviewed — the CardProgress column defaults. */
export const NEW_SCHEDULE: Schedule = {
  repetitionNumber: 0,
  easeFactor: INITIAL_EASE,
  intervalDays: 0,
};

export function isQuality(value: unknown): value is Quality {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 5;
}

/**
 * The schedule after one review.
 *
 * @param progress the card's schedule before this review (NEW_SCHEDULE if none)
 * @param quality  the 0–5 grade for this answer
 * @param today    the reviewer's calendar day, YYYY-MM-DD
 * @param now      the moment of the review, stored as lastReviewedAt
 */
export function applySM2(
  progress: Schedule,
  quality: Quality,
  today: string,
  now: Date,
): ReviewedSchedule {
  if (!isQuality(quality)) {
    throw new RangeError(`SM-2 quality must be an integer from 0 to 5, got ${quality}`);
  }

  if (quality < PASSING_QUALITY) {
    return {
      repetitionNumber: 0,
      easeFactor: progress.easeFactor,
      intervalDays: 1,
      nextReviewDate: addDays(today, 1),
      lastReviewedAt: now,
    };
  }

  const repetitionNumber = progress.repetitionNumber + 1;

  let intervalDays: number;
  if (repetitionNumber === 1) intervalDays = 1;
  else if (repetitionNumber === 2) intervalDays = 6;
  // At least a day, so a row that somehow holds interval 0 past n = 2 still
  // moves forward instead of being due again today, forever.
  else intervalDays = Math.max(1, Math.round(progress.intervalDays * progress.easeFactor));

  const miss = 5 - quality;
  const easeFactor = Math.max(
    MIN_EASE,
    roundEase(progress.easeFactor + (0.1 - miss * (0.08 + miss * 0.02))),
  );

  return {
    repetitionNumber,
    easeFactor,
    intervalDays,
    nextReviewDate: addDays(today, intervalDays),
    lastReviewedAt: now,
  };
}

/**
 * One review as learn mode sends it. Learn mode has no day cycle: every answer
 * counts, whenever it is given, so a card can go from new to learned in one
 * sitting. The review date SM-2 works out is still stored, but nothing reads it.
 *
 * `seen` makes a review safe to send twice (a response lost on a bad
 * connection, then retried). It is the streak (repetitionNumber) the client
 * saw before this answer, null for a card it saw as never reviewed. If the
 * stored row no longer matches, the answer was already counted and null comes
 * back: the schedule stays as it is. Left out, the review always applies.
 *
 * @param progress the card's stored schedule, or null if it was never reviewed
 */
export function applyReview(
  progress: Schedule | null,
  quality: Quality,
  today: string,
  now: Date,
  seen?: number | null,
): ReviewedSchedule | null {
  if (seen !== undefined && (progress?.repetitionNumber ?? null) !== seen) return null;
  return applySM2(progress ?? NEW_SCHEDULE, quality, today, now);
}

/**
 * Every step SM-2 can take from 2.5 (+0.10, ±0, −0.14) and the 1.3 floor are
 * whole multiples of 0.02, so rounding to two places loses nothing — it only
 * strips the float noise (2.7 + 0.1 = 2.8000000000000003) before it is stored.
 */
function roundEase(value: number): number {
  return Math.round(value * 100) / 100;
}
