import { describe, expect, it } from 'vitest';

import {
  currentCard,
  dontKnow,
  isMatch,
  skipRetype,
  startNextRound,
  startSession,
  submitAnswer,
  submitRetype,
} from './write';
import { computeDiff } from './diff';

const CARDS = [
  { id: 1, term: 'chat', definition: 'cat' },
  { id: 2, term: 'chien', definition: 'dog' },
];

function start() {
  return startSession(CARDS, { answerWith: 'term', shuffled: false });
}

describe('skipRetype', () => {
  it('moves past a miss without the retype credit', () => {
    const missed = submitAnswer(start(), 'chien');
    const skipped = skipRetype(missed);
    expect(currentCard(skipped)?.id).toBe(2);
    expect(skipped.step.kind).toBe('ask');
    expect(skipped.missed).toEqual([1]);
    expect(skipped.credits[1]).toBe(0);

    // Retyping instead earns the first credit.
    expect(submitRetype(missed, 'chat').credits[1]).toBe(1);
  });

  it('skips a "don\'t know" too, and the skipped card comes back next round', () => {
    let session = skipRetype(dontKnow(start()));
    session = skipRetype(submitAnswer(session, 'wrong'));
    expect(session.step.kind).toBe('summary');
    expect(session.rounds).toEqual([{ round: 1, total: 2, missed: 2, accuracy: 0 }]);
    expect(startNextRound(session).queue).toEqual([1, 2]);
  });

  it('does nothing unless the card was missed', () => {
    const asking = start();
    expect(skipRetype(asking)).toBe(asking);
    const correct = submitAnswer(asking, 'chat');
    expect(skipRetype(correct)).toBe(correct);
  });
});

describe('isMatch', () => {
  it('takes curly quotes and typographic dashes for their plain twins', () => {
    expect(isMatch("aujourd'hui", 'aujourd’hui')).toBe(true);
    expect(isMatch('aujourd’hui', "aujourd'hui")).toBe(true);
    expect(isMatch('well-known', 'well–known')).toBe(true);
    expect(isMatch('well-known', 'well—known')).toBe(true);
  });

  it('does not need the ¿ or ¡ typed', () => {
    expect(isMatch('cómo estás', '¿Cómo estás?')).toBe(true);
    expect(isMatch('hola', '¡Hola!')).toBe(true);
  });

  it('still tells accents apart', () => {
    expect(isMatch('cafe', 'café')).toBe(false);
  });

  it('ignores words in parentheses when there is other content in the answer', () => {
    expect(isMatch('Apfel', 'Apfel (m)')).toBe(true);
    expect(isMatch('Apfel (m)', 'Apfel (m)')).toBe(true);
    expect(isMatch('to leave', 'to leave (a place)')).toBe(true);
    expect(isMatch('run', '(to) run')).toBe(true);
    expect(isMatch('to run', '(to) run')).toBe(true);
    expect(isMatch('(to) run', '(to) run')).toBe(true);
    expect(isMatch('Hund', 'Hund (-e)')).toBe(true);
    expect(isMatch('apple, banana', 'apple (fruit), banana')).toBe(true);
  });

  it('counts answer as wrong if the () is the only thing provided or if only the () part is answered', () => {
    // Only typing the parenthetical part when there is other content
    expect(isMatch('(m)', 'Apfel (m)')).toBe(false);
    expect(isMatch('m', 'Apfel (m)')).toBe(false);
    expect(isMatch('(-e)', 'Hund (-e)')).toBe(false);
    expect(isMatch('-e', 'Hund (-e)')).toBe(false);
    expect(isMatch('()', 'Apfel (m)')).toBe(false);
    expect(isMatch('()', 'dog')).toBe(false);

    // When () is the only thing in the expected answer
    expect(isMatch('', '(noun)')).toBe(false);
    expect(isMatch('()', '(noun)')).toBe(false);
    expect(isMatch('verb', '(noun)')).toBe(false);
    expect(isMatch('noun', '(noun)')).toBe(true);
    expect(isMatch('(noun)', '(noun)')).toBe(true);
  });

  it('allows explanatory parentheses in the user answer if the core matches', () => {
    expect(isMatch('to speak (verb)', 'to speak')).toBe(true);
    expect(isMatch('casa (f)', 'casa')).toBe(true);
    expect(isMatch('(f)', 'casa')).toBe(false);
  });

  it('does not count spaces in between words as wrong', () => {
    expect(isMatch('pommedeterre', 'pomme de terre')).toBe(true);
    expect(isMatch('pomme de terre', 'pommedeterre')).toBe(true);
    expect(isMatch('pomme  de   terre', 'pomme de terre')).toBe(true);
    expect(isMatch('icecream', 'ice cream')).toBe(true);
    expect(isMatch('ice cream', 'icecream')).toBe(true);
    expect(isMatch('to giveup', 'to give up')).toBe(true);
    expect(isMatch('togiveup', 'to give up')).toBe(true);
    expect(isMatch('infrontof', 'in front of')).toBe(true);
    expect(isMatch('alot', 'a lot')).toBe(true);
    expect(isMatch('l’ ami', "l'ami")).toBe(true);
    expect(isMatch('toleave', 'to leave (a place)')).toBe(true);
  });

  it('ignores first letter upper/lower case', () => {
    expect(isMatch('Apple', 'apple')).toBe(true);
    expect(isMatch('apple', 'Apple')).toBe(true);
    expect(isMatch('der hund', 'Der Hund')).toBe(true);
    expect(isMatch('Der Hund', 'der hund')).toBe(true);
    expect(isMatch('derhund', 'Der Hund')).toBe(true);
    expect(isMatch('DerHund', 'der hund')).toBe(true);
  });
});

describe('computeDiff', () => {
  it('does not mark case differences as added or removed', () => {
    const diff = computeDiff('apple', 'Apple');
    expect(diff.some((p) => p.added || p.removed)).toBe(false);
    expect(diff.map((p) => p.value).join('')).toBe('Apple');
  });

  it('does not mark extra space runs as added or removed', () => {
    const diff = computeDiff('high   school', 'high school');
    expect(diff.some((p) => p.added || p.removed)).toBe(false);
  });
});

