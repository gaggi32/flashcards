// Wrong options for a multiple-choice question, picked from the card's own set.
//
// A good distractor is one you could actually mistake for the answer, and not
// one that *is* the answer in other words. So candidates are sorted into
// tiers, and the best tier that can fill the question wins:
//
//   1. about the same length as the answer AND sharing few of its words
//   2. sharing few of its words              (the length filter relaxed first)
//   3. about the same length                 (then the word-overlap filter)
//   4. anything left                         (plain random)
//
// "About the same length" is within 40% of the answer's character count — a
// one-word option among three sentences gives itself away. "Few words" is at
// most half the words of the shorter of the two texts, so an option that
// contains the answer, or is contained in it, is out whichever is longer.
//
// Within a tier the order is random, except that answers to the session's
// other questions go last: seeing tomorrow's answer offered as today's wrong
// option teaches exactly the wrong pairing.
//
// Sets under MIN_CARDS_FOR_CHOICE cards get no options at all. With four cards
// every question would show the same four answers, which is a matching game
// you can win by elimination, not a test of recall — those sets are typed.

import { shuffle } from './shuffle';
import { normalizeAnswer, type StudyCard } from './write';

export type AnswerSide = 'term' | 'definition';

export const MIN_CARDS_FOR_CHOICE = 5;
export const DISTRACTOR_COUNT = 3;
/** Largest length difference for a "similar length" option, as a share of the answer's length. */
export const LENGTH_TOLERANCE = 0.4;
/** Largest share of words an option may have in common with the answer. */
export const MAX_WORD_OVERLAP = 0.5;

export type DistractorOptions = {
  /** Which side of each card the options show. Definitions unless told otherwise. */
  side?: AnswerSide;
  /** Cards whose answers to use only as a last resort within a tier. */
  avoidIds?: ReadonlySet<number>;
  /** Injectable for tests. */
  random?: () => number;
};

/**
 * Up to `count` other cards whose `side` can stand in as wrong answers for
 * `correctCard`. Fewer than `count` means the set cannot supply that many
 * distinct answers — including none for a set under MIN_CARDS_FOR_CHOICE —
 * and the caller should ask the card as a typed question instead.
 */
export function pickDistractors<C extends StudyCard>(
  correctCard: C,
  allCardsInSet: readonly C[],
  count: number = DISTRACTOR_COUNT,
  options: DistractorOptions = {},
): C[] {
  if (allCardsInSet.length < MIN_CARDS_FOR_CHOICE || count <= 0) return [];

  const side = options.side ?? 'definition';
  const avoid = options.avoidIds ?? new Set<number>();
  const answer = correctCard[side];

  // One candidate per distinct answer, and never one that reads the same as
  // the right one: two cards with the same definition would put a second
  // correct option on screen. Shuffled first, so which duplicate survives and
  // the order within each tier are both random.
  const seen = new Set([normalizeAnswer(answer)]);
  const candidates: { card: C; similarLength: boolean; lowOverlap: boolean }[] = [];
  for (const card of shuffle(allCardsInSet, options.random)) {
    if (card.id === correctCard.id) continue;
    const key = normalizeAnswer(card[side]);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      card,
      similarLength: isSimilarLength(card[side], answer),
      lowOverlap: wordOverlap(card[side], answer) <= MAX_WORD_OVERLAP,
    });
  }
  // Stable, so the shuffle survives within each group.
  candidates.sort((a, b) => Number(avoid.has(a.card.id)) - Number(avoid.has(b.card.id)));

  const tiers: ((c: (typeof candidates)[number]) => boolean)[] = [
    (c) => c.similarLength && c.lowOverlap,
    (c) => c.lowOverlap,
    (c) => c.similarLength,
    () => true,
  ];

  const picked: C[] = [];
  const taken = new Set<number>();
  for (const inTier of tiers) {
    for (const candidate of candidates) {
      if (picked.length === count) return picked;
      if (taken.has(candidate.card.id) || !inTier(candidate)) continue;
      picked.push(candidate.card);
      taken.add(candidate.card.id);
    }
  }
  return picked;
}

/** Whether `text` is within LENGTH_TOLERANCE of `answer`'s length, in characters. */
export function isSimilarLength(text: string, answer: string): boolean {
  const target = charLength(answer);
  return Math.abs(charLength(text) - target) <= target * LENGTH_TOLERANCE;
}

/**
 * Distinct words two texts share, as a share of the shorter one's distinct
 * words: 0 is nothing in common, 1 is one text's words all inside the other.
 */
export function wordOverlap(a: string, b: string): number {
  const wordsA = words(a);
  const wordsB = words(b);
  const smaller = Math.min(wordsA.size, wordsB.size);
  if (smaller === 0) return 0;

  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  return shared / smaller;
}

function words(text: string): Set<string> {
  // Letters and digits in any script, so a German or Greek set splits into
  // words as well as an English one does.
  return new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Characters as a reader counts them: "é" is one, not two code units. */
function charLength(text: string): number {
  return Array.from(text.normalize('NFC').trim()).length;
}
