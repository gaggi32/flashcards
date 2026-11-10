// The characters a set needs beyond a plain keyboard, for the buttons above the
// answer box in Write and Learn.

import { answerOf, type AnswerWith, type StudyCard } from './write';

/**
 * Past this many distinct characters the set is in a script typed with an IME
 * (kanji, Thai, Arabic…), and a grid of buttons would only get in the way.
 */
export const MAX_SPECIAL_CHARS = 40;

const COLLATOR = new Intl.Collator('en');

/**
 * Every non-ASCII letter the answers in `cards` use, one entry per letter
 * ("É" and "é" are the same to the grader, so the same button), ordered by base
 * letter. Empty when the set has none, or too many to be worth buttons.
 *
 * The text goes through NFKC first, as it does when graded: an accent stored
 * as a separate combining mark still counts as its letter, and a ligature or
 * full-width letter that grades as plain ASCII gets no button. Punctuation
 * never gets one either — the grader folds curly quotes and dashes to plain
 * ones, so nothing in an answer needs it typed.
 */
export function specialCharsOf(cards: StudyCard[], answerWith: AnswerWith): string[] {
  const found = new Set<string>();
  for (const card of cards) {
    for (const char of answerOf(card, answerWith).normalize('NFKC')) {
      if (char.codePointAt(0)! < 0x80 || !/^[\p{L}\p{M}]$/u.test(char)) continue;
      const lower = char.toLowerCase();
      // "İ" lowercases to two characters; keep it as it is rather than
      // splitting off a stray combining dot.
      found.add([...lower].length === 1 ? lower : char);
    }
  }
  if (found.size > MAX_SPECIAL_CHARS) return [];
  return [...found].sort(COLLATOR.compare);
}
