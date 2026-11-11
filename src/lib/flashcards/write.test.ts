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
import { computeDiff, type DiffPart } from './diff';

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

  it('takes ss for ß (Swiss keyboards have no ß)', () => {
    expect(isMatch('Strasse', 'Straße')).toBe(true);
    expect(isMatch('Straße', 'Strasse')).toBe(true);
    expect(isMatch('Strase', 'Straße')).toBe(false);
  });

  it('takes any apostrophe a keyboard types', () => {
    expect(isMatch('aujourd´hui', "aujourd'hui")).toBe(true);
    expect(isMatch('aujourd`hui', "aujourd'hui")).toBe(true);
  });

  it('does not count hyphens or sentence marks', () => {
    expect(isMatch('email', 'e-mail')).toBe(true);
    expect(isMatch('well known', 'well-known')).toBe(true);
    expect(isMatch('Mr Smith', 'Mr. Smith')).toBe(true);
    expect(isMatch('Ca va bien', 'Ça va? Bien!')).toBe(false); // the ç still counts
    expect(isMatch('ça va bien', 'Ça va? Bien!')).toBe(true);
    expect(isMatch('he said hi', 'he said "hi"')).toBe(true);
  });

  it('keeps numbers exact', () => {
    expect(isMatch('35', '3.5')).toBe(false);
    expect(isMatch('15', '1,5')).toBe(false);
    expect(isMatch('5,1', '1,5')).toBe(false);
    expect(isMatch('1,5', '1,5')).toBe(true);
  });

  it('takes the items of a list in any order, with any separator', () => {
    expect(isMatch('festlegen, bestimmen', 'bestimmen, festlegen')).toBe(true);
    expect(isMatch('festlegen; bestimmen', 'bestimmen, festlegen')).toBe(true);
    expect(isMatch('festlegen / bestimmen', 'bestimmen, festlegen')).toBe(true);
    expect(isMatch('banana, apple', 'apple (fruit), banana')).toBe(true);
    // but every item, not one of them
    expect(isMatch('bestimmen', 'bestimmen, festlegen')).toBe(false);
    expect(isMatch('bestimmen, bestimmen', 'bestimmen, festlegen')).toBe(false);
  });

  it('is not fooled by an answer that is all punctuation', () => {
    expect(isMatch('?', '?')).toBe(true);
    expect(isMatch('!', '?')).toBe(false);
    expect(isMatch('...', '…')).toBe(true);
  });
});

/** The two lines the verdict shows: what was typed, and the answer. */
function lines(given: string, expected: string) {
  const parts = computeDiff(given, expected);
  const mark = (p: DiffPart, text: string, sign: string) => (p.soft ? `{${text}}` : `${sign}${text}${sign}`);
  return {
    given: parts
      .filter((p) => !p.added)
      .map((p) => (p.removed ? mark(p, p.value, '-') : (p.typed ?? p.value)))
      .join(''),
    expected: parts
      .filter((p) => !p.removed)
      .map((p) => (p.added ? mark(p, p.value, '+') : p.value))
      .join(''),
  };
}

describe('computeDiff', () => {
  it('keeps a correct start together (de → determine)', () => {
    expect(lines('de', 'determine')).toEqual({ given: 'de', expected: 'de+termine+' });
  });

  it('marks a missing end, a missing letter and an extra letter', () => {
    expect(lines('determin', 'determine').expected).toBe('determin+e+');
    expect(lines('detrmine', 'determine').expected).toBe('det+e+rmine');
    expect(lines('deterrmine', 'determine').given).toBe('deter-r-mine');
  });

  it('shows swapped letters as one out, one in', () => {
    expect(lines('recieve', 'receive')).toEqual({ given: 'rec-i-eve', expected: 'rece+i+ve' });
  });

  it('replaces an unrelated word whole instead of matching stray letters', () => {
    expect(lines('house', 'maison')).toEqual({ given: '-house-', expected: '+maison+' });
    expect(lines('cat', 'dog')).toEqual({ given: '-cat-', expected: '+dog+' });
  });

  it('keeps a shared start of a wrong word', () => {
    expect(lines('chat', 'chien')).toEqual({ given: 'ch-at-', expected: 'ch+ien+' });
  });

  it('marks a wrong accent', () => {
    expect(lines('cafe', 'café')).toEqual({ given: 'caf-e-', expected: 'caf+é+' });
  });

  it('works word by word in a phrase', () => {
    expect(lines('the big dog', 'the small dog')).toEqual({
      given: 'the -big- dog',
      expected: 'the +small+ dog',
    });
    expect(lines('determine', 'to determine').expected).toBe('+to +determine');
  });

  it('shows what was typed, in its own case', () => {
    expect(lines('DETERMIN', 'determine')).toEqual({ given: 'DETERMIN', expected: 'determin+e+' });
  });

  it('does not mark case differences', () => {
    const diff = computeDiff('apple', 'Apple');
    expect(diff.some((p) => p.added || p.removed)).toBe(false);
    expect(diff.map((p) => p.value).join('')).toBe('Apple');
  });

  it('softens what the check ignores: spaces, edge punctuation, parentheses', () => {
    expect(lines('high   school', 'high school').given).toBe('high {  }school');
    expect(lines('como estas', '¿Cómo estás?').expected).toBe('{¿}C+ó+mo est+á+s{?}');
    expect(lines('Apfal', 'Apfel (m)').expected).toBe('Apf+e+l{ (m)}');
  });

  it('copes with long answers', () => {
    const long = 'a'.repeat(900);
    expect(lines(long, `${long}b`).expected).toBe(`${long}+b+`);
  });
});

