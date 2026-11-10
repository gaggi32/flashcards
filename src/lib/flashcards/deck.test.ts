import { describe, expect, it } from 'vitest';

import {
  currentId,
  mark,
  move,
  nextRound,
  startDeck,
  stillToLearn,
  tally,
  toggleShuffle,
  type Deck,
} from './deck';

const IDS = [1, 2, 3, 4];
/** Always picks the first remaining slot: shuffle([a, b, c]) → [b, c, a]. */
const firstSlot = () => 0;

function markAll(deck: Deck, marks: ('known' | 'missed')[]): Deck {
  return marks.reduce((d, m) => mark(d, m), deck);
}

describe('startDeck', () => {
  it('keeps set order unless shuffled', () => {
    expect(startDeck(IDS, false).order).toEqual(IDS);
    const shuffled = startDeck(IDS, true, firstSlot);
    expect(shuffled.order).not.toEqual(IDS);
    expect([...shuffled.order].sort()).toEqual(IDS);
    expect(shuffled.pile).toEqual(IDS);
  });
});

describe('move', () => {
  it('stays inside the pile', () => {
    const deck = startDeck(IDS, false);
    expect(move(deck, -1)).toBe(deck);
    const last = [1, 1, 1].reduce((d) => move(d, 1), deck);
    expect(currentId(last)).toBe(4);
    expect(move(last, 1)).toBe(last);
  });

  it('does not mark anything', () => {
    expect(move(startDeck(IDS, false), 1).marks).toEqual({});
  });
});

describe('mark', () => {
  it('records the card and moves on', () => {
    const deck = mark(startDeck(IDS, false), 'missed');
    expect(deck.marks).toEqual({ 1: 'missed' });
    expect(currentId(deck)).toBe(2);
    expect(deck.done).toBe(false);
  });

  it('replaces an earlier mark on the same card', () => {
    let deck = mark(startDeck(IDS, false), 'missed');
    deck = mark(move(deck, -1), 'known');
    expect(deck.marks).toEqual({ 1: 'known' });
  });

  it('ends the round on the last card', () => {
    const deck = markAll(startDeck(IDS, false), ['known', 'missed', 'known', 'known']);
    expect(deck.done).toBe(true);
    expect(tally(deck)).toEqual({ known: 3, missed: 1, left: 1 });
    expect(mark(deck, 'missed')).toBe(deck);
    expect(move(deck, -1)).toBe(deck);
  });
});

describe('nextRound', () => {
  it('asks the missed and the unmarked cards again, in set order', () => {
    let deck = startDeck(IDS, false);
    deck = mark(deck, 'missed'); // 1
    deck = move(deck, 1); // skip 2 without marking
    deck = markAll(deck, ['known', 'known']); // 3, 4
    expect(stillToLearn(deck)).toEqual([1, 2]);

    const next = nextRound(deck);
    expect(next).toMatchObject({ pile: [1, 2], order: [1, 2], index: 0, round: 2, marks: {} });
    expect(next.done).toBe(false);
  });

  it('only runs from a finished round with cards left', () => {
    const unfinished = mark(startDeck(IDS, false), 'missed');
    expect(nextRound(unfinished)).toBe(unfinished);
    const allKnown = markAll(startDeck(IDS, false), ['known', 'known', 'known', 'known']);
    expect(nextRound(allKnown)).toBe(allKnown);
  });
});

describe('toggleShuffle', () => {
  it('keeps the card on screen when shuffling and unshuffling', () => {
    let deck = move(move(startDeck(IDS, false), 1), 1);
    deck = toggleShuffle(deck, firstSlot);
    expect(currentId(deck)).toBe(3);
    expect(deck.index).toBe(0);
    deck = toggleShuffle(move(deck, 1));
    expect(deck.order).toEqual(IDS);
    expect(currentId(deck)).not.toBe(3);
  });
});
