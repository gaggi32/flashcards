import { describe, expect, it } from 'vitest';

import {
  isSimilarLength,
  MIN_CARDS_FOR_CHOICE,
  pickDistractors,
  wordOverlap,
} from './distractors';
import type { StudyCard } from './write';

/** Small deterministic PRNG, so every "random" pick below can be replayed. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

let nextId = 1;
function card(definition: string, term = `term ${nextId}`): StudyCard {
  return { id: nextId++, term, definition };
}

const ids = (cards: StudyCard[]) => cards.map((c) => c.id).sort((a, b) => a - b);

describe('pickDistractors — a normal set', () => {
  const correct = card('The powerhouse of the cell, producing ATP'); // 41 chars

  // Similar length (within 40%) and little word overlap: the preferred pool.
  const good = [
    card('Organelle that carries out photosynthesis'),
    card('Jelly-like fluid that fills the cell'),
    card('Holds the chromosomes and genetic material'),
    card('Controls what enters and leaves the cell'),
    card('Breaks down waste inside the cell'),
  ];
  const tooShort = card('Protein factory');
  const tooLong = card('Packages proteins and ships them out through the membrane to the rest of the body');
  const paraphrase = card('The powerhouse of the cell'); // every word is in the answer
  const set = [correct, ...good, tooShort, tooLong, paraphrase];

  it.each(SEEDS)('picks three distinct, well-matched options (seed %i)', (seed) => {
    const picked = pickDistractors(correct, set, 3, { random: seeded(seed) });

    expect(picked).toHaveLength(3);
    expect(new Set(ids(picked)).size).toBe(3);
    for (const option of picked) {
      expect(good.map((c) => c.id)).toContain(option.id);
    }
  });

  it('never offers the correct card or a paraphrase of it', () => {
    for (const seed of SEEDS) {
      const picked = ids(pickDistractors(correct, set, 3, { random: seeded(seed) }));
      expect(picked).not.toContain(correct.id);
      expect(picked).not.toContain(paraphrase.id);
    }
  });

  it('varies which options it picks', () => {
    const combos = new Set(
      SEEDS.map((seed) => ids(pickDistractors(correct, set, 3, { random: seeded(seed) })).join()),
    );
    expect(combos.size).toBeGreaterThan(1);
  });

  it('defaults to three options', () => {
    expect(pickDistractors(correct, set)).toHaveLength(3);
  });

  it('can compare terms instead of definitions', () => {
    const termSet = [
      card('d', 'mitochondrion'), // the answer: 13 chars
      card('d', 'chloroplast'),
      card('d', 'ribosome'),
      card('d', 'lysosome'),
      card('d', 'endoplasmic reticulum'), // 21 chars, too long
      card('d', 'nucleus'), // 7 chars, too short
    ];
    for (const seed of SEEDS) {
      const picked = pickDistractors(termSet[0], termSet, 3, {
        side: 'term',
        random: seeded(seed),
      });
      expect(picked.map((c) => c.term).sort()).toEqual(['chloroplast', 'lysosome', 'ribosome']);
    }
  });
});

describe('pickDistractors — every definition is about the same length', () => {
  // All 13–19 characters: the length filter lets everything through, so the
  // word-overlap filter is what decides.
  const correct = card('Capital of France');
  const capitals = [
    card('Capital of Spain'),
    card('Capital of Italy'),
    card('Capital of Germany'),
    card('Capital of Portugal'),
  ];
  const unrelated = [
    card('Largest ocean'),
    card('Longest river'),
    card('Tallest mountain'),
    card('Smallest country'),
  ];

  it('confirms the premise: all similar length, capitals overlap', () => {
    for (const c of [...capitals, ...unrelated]) {
      expect(isSimilarLength(c.definition, correct.definition)).toBe(true);
    }
    for (const c of capitals) {
      expect(wordOverlap(c.definition, correct.definition)).toBeGreaterThan(0.5);
    }
  });

  it.each(SEEDS)('leaves out the near-copies when it can (seed %i)', (seed) => {
    const picked = pickDistractors(correct, [correct, ...capitals, ...unrelated], 3, {
      random: seeded(seed),
    });
    expect(picked).toHaveLength(3);
    for (const option of picked) {
      expect(unrelated.map((c) => c.id)).toContain(option.id);
    }
  });

  it('falls back to the near-copies rather than showing fewer options', () => {
    for (const seed of SEEDS) {
      const picked = pickDistractors(correct, [correct, ...capitals, unrelated[0]], 3, {
        random: seeded(seed),
      });
      expect(picked).toHaveLength(3);
      // The one unrelated definition is always among them, and first.
      expect(picked[0].id).toBe(unrelated[0].id);
      expect(capitals.map((c) => c.id)).toEqual(expect.arrayContaining(ids(picked.slice(1))));
    }
  });
});

describe('pickDistractors — relaxing the filters in order', () => {
  const correct = card('alpha beta gamma delta'); // 22 chars
  const both = card('one two three four five'); // similar length, no overlap
  const overlapOnly = card('zeta'); // too short, no overlap
  const lengthOnly = card('alpha beta gamma epsilon'); // similar length, 3/4 overlap
  const neither = card('alpha beta'); // too short, full overlap
  const set = [neither, lengthOnly, correct, overlapOnly, both];

  it.each(SEEDS)('drops length first, then overlap, then anything (seed %i)', (seed) => {
    const random = seeded(seed);
    expect(pickDistractors(correct, set, 1, { random }).map((c) => c.id)).toEqual([both.id]);
    expect(pickDistractors(correct, set, 2, { random }).map((c) => c.id)).toEqual([
      both.id,
      overlapOnly.id,
    ]);
    expect(pickDistractors(correct, set, 3, { random }).map((c) => c.id)).toEqual([
      both.id,
      overlapOnly.id,
      lengthOnly.id,
    ]);
    expect(pickDistractors(correct, set, 4, { random }).map((c) => c.id)).toEqual([
      both.id,
      overlapOnly.id,
      lengthOnly.id,
      neither.id,
    ]);
  });
});

describe('pickDistractors — small sets', () => {
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => card(`definition number ${i + 1} here`));

  it(`offers nothing for a set under ${MIN_CARDS_FOR_CHOICE} cards`, () => {
    for (const size of [1, 2, 3, 4]) {
      const set = make(size);
      for (const c of set) expect(pickDistractors(c, set)).toEqual([]);
    }
  });

  it(`offers a full question from exactly ${MIN_CARDS_FOR_CHOICE} cards`, () => {
    const set = make(MIN_CARDS_FOR_CHOICE);
    for (const c of set) {
      const picked = pickDistractors(c, set);
      expect(picked).toHaveLength(3);
      expect(ids(picked)).not.toContain(c.id);
    }
  });

  it('comes up short when duplicate answers leave too few distinct ones', () => {
    const correct = card('Paris');
    const set = [correct, card('paris'), card('Paris.'), card('Madrid'), card('Rome')];
    for (const seed of SEEDS) {
      const picked = pickDistractors(correct, set, 3, { random: seeded(seed) });
      // "paris" and "Paris." would be a second right answer; only two remain.
      expect(picked.map((c) => c.definition).sort()).toEqual(['Madrid', 'Rome']);
    }
  });

  it('shows each distinct wrong answer only once', () => {
    const correct = card('Paris');
    const set = [correct, card('Madrid'), card('madrid'), card('Rome'), card('Berlin')];
    for (const seed of SEEDS) {
      const picked = pickDistractors(correct, set, 3, { random: seeded(seed) });
      const answers = picked.map((c) => c.definition.toLowerCase());
      expect(new Set(answers).size).toBe(3);
    }
  });
});

describe("pickDistractors — other questions' answers", () => {
  const correct = card('Capital of France'); // 17 chars
  const sameTier = [
    card('Largest ocean'),
    card('Longest river'),
    card('Tallest mountain'),
    card('Smallest country'),
    card('Deepest lake'),
  ];
  const lowerTier = card('The single most densely populated independent city-state'); // too long
  const set = [correct, ...sameTier, lowerTier];

  it('uses them last within a tier', () => {
    const avoidIds = new Set([sameTier[0].id, sameTier[1].id]);
    for (const seed of SEEDS) {
      const picked = pickDistractors(correct, set, 3, { avoidIds, random: seeded(seed) });
      expect(ids(picked)).toEqual(ids(sameTier.slice(2)));
    }
  });

  it('still prefers them over a worse-matching option', () => {
    const avoidIds = new Set(sameTier.slice(0, 4).map((c) => c.id));
    for (const seed of SEEDS) {
      const picked = pickDistractors(correct, set, 3, { avoidIds, random: seeded(seed) });
      expect(picked[0].id).toBe(sameTier[4].id);
      expect(ids(picked)).not.toContain(lowerTier.id);
    }
  });
});

describe('wordOverlap', () => {
  it('measures against the shorter text', () => {
    expect(wordOverlap('the cell', 'the powerhouse of the cell')).toBe(1);
    expect(wordOverlap('the powerhouse of the cell', 'the cell')).toBe(1);
    expect(wordOverlap('red green', 'blue yellow')).toBe(0);
    expect(wordOverlap('cell wall', 'cell membrane')).toBe(0.5);
  });

  it('ignores case, punctuation and repeated words', () => {
    expect(wordOverlap('The CELL, the cell!', 'cell the')).toBe(1);
  });

  it('splits words in any script', () => {
    expect(wordOverlap('Die Hauptstadt von Österreich', 'die hauptstadt von Frankreich')).toBe(0.75);
  });

  it('is zero when either side has no words', () => {
    expect(wordOverlap('...', 'anything')).toBe(0);
  });
});
