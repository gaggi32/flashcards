// Flashcards mode: the deck as a pure state machine, in the style of write.ts.
//
// The rules:
//
//   • Browsing is free. Prev, next and swipes move through the pile without
//     saying anything about a card.
//   • After looking at a card, "knew it" or "didn't know" records how it went
//     and moves to the next card. Going back and marking a card again replaces
//     its mark.
//   • Marking the last card ends the round. Every card not marked "knew it" —
//     missed, or never marked — makes up the next round's pile, until a round
//     leaves none.
//
// Nothing here is saved: like write mode, a round is worth nothing once the tab
// closes. Learn mode is the one that remembers a card across days.

import { shuffle } from './shuffle';

export type Mark = 'known' | 'missed';

export type Deck = {
  /** This round's card ids, in set order. */
  pile: number[];
  /** The order the pile is shown in: the pile itself, or a shuffle of it. */
  order: number[];
  index: number;
  shuffled: boolean;
  round: number;
  /** This round's marks by card id. An unmarked card has no entry. */
  marks: Record<number, Mark>;
  /** Set once the last card of the round has been marked. */
  done: boolean;
};

export function startDeck(
  ids: number[],
  shuffled: boolean,
  random: () => number = Math.random,
): Deck {
  return {
    pile: ids,
    order: shuffled ? shuffle(ids, random) : ids,
    index: 0,
    shuffled,
    round: 1,
    marks: {},
    done: false,
  };
}

export function currentId(deck: Deck): number {
  return deck.order[deck.index];
}

export function move(deck: Deck, delta: -1 | 1): Deck {
  if (deck.done) return deck;
  const index = Math.min(deck.order.length - 1, Math.max(0, deck.index + delta));
  return index === deck.index ? deck : { ...deck, index };
}

export function mark(deck: Deck, value: Mark): Deck {
  if (deck.done) return deck;
  const marks = { ...deck.marks, [currentId(deck)]: value };
  if (deck.index === deck.order.length - 1) return { ...deck, marks, done: true };
  return { ...deck, marks, index: deck.index + 1 };
}

export function toggleShuffle(deck: Deck, random: () => number = Math.random): Deck {
  if (deck.done) return deck;
  const current = currentId(deck);
  if (deck.shuffled) {
    // Back to set order, still looking at the same card.
    return { ...deck, shuffled: false, order: deck.pile, index: deck.pile.indexOf(current) };
  }
  // A fresh shuffled pass that starts from the card on screen.
  const rest = shuffle(
    deck.order.filter((id) => id !== current),
    random,
  );
  return { ...deck, shuffled: true, order: [current, ...rest], index: 0 };
}

/** The cards the next round would ask: everything not marked "knew it". */
export function stillToLearn(deck: Deck): number[] {
  return deck.pile.filter((id) => deck.marks[id] !== 'known');
}

/** From a finished round with cards left: a round of only those. */
export function nextRound(deck: Deck, random: () => number = Math.random): Deck {
  const pile = stillToLearn(deck);
  if (!deck.done || pile.length === 0) return deck;
  return { ...startDeck(pile, deck.shuffled, random), round: deck.round + 1 };
}

export function tally(deck: Deck) {
  let known = 0;
  let missed = 0;
  for (const id of deck.pile) {
    if (deck.marks[id] === 'known') known++;
    else if (deck.marks[id] === 'missed') missed++;
  }
  return { known, missed, left: deck.pile.length - known };
}
