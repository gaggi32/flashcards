import { describe, expect, it } from 'vitest';

import {
  switchSides,
  advance,
  currentCard,
  dontKnow,
  isFinished,
  isMatch,
  masteredCount,
  overrideCorrect,
  showHint,
  skipRetype,
  startNextRound,
  startSession,
  submitAnswer,
  submitRetype,
} from './write';
import { computeDiff, type DiffPart } from './diff';
import { packWrite, unpackWrite } from './saved';

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
    expect(session.rounds).toEqual([{ round: 1, total: 2, missed: 2, hinted: 0, accuracy: 0 }]);
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

  it('counts a missing or extra space between words', () => {
    expect(isMatch('pommedeterre', 'pomme de terre')).toBe(false);
    expect(isMatch('pomme de terre', 'pommedeterre')).toBe(false);
    expect(isMatch('icecream', 'ice cream')).toBe(false);
    expect(isMatch('ice cream', 'icecream')).toBe(false);
    expect(isMatch('to giveup', 'to give up')).toBe(false);
    expect(isMatch('alot', 'a lot')).toBe(false);
    expect(isMatch('toleave', 'to leave (a place)')).toBe(false);
    expect(isMatch('to leave', 'to leave (a place)')).toBe(true);
    expect(isMatch('1000', '1 000')).toBe(false);
  });

  it('does not count extra spaces or spaces next to punctuation', () => {
    expect(isMatch('pomme  de   terre', 'pomme de terre')).toBe(true);
    expect(isMatch('  ice cream ', 'ice cream')).toBe(true);
    expect(isMatch('ice\tcream', 'ice cream')).toBe(true);
    expect(isMatch('l’ ami', "l'ami")).toBe(true);
    expect(isMatch("l'ami", "l' ami")).toBe(true);
    expect(isMatch('hund , katze', 'Hund, Katze')).toBe(true);
    expect(isMatch('Mr Smith', 'Mr. Smith')).toBe(true);
    expect(isMatch('¿ Cómo estás ?', '¿Cómo estás?')).toBe(true);
    expect(isMatch('si ¿ y tu', 'si y tu')).toBe(true);
  });

  it('does not count a space next to a dot or quote mark, nor the mark', () => {
    expect(isMatch('etw.angehen', 'etw. angehen')).toBe(true);
    expect(isMatch('etw angehen', 'etw. angehen')).toBe(true);
    expect(isMatch('z.B.', 'z. B.')).toBe(true);
    expect(isMatch('z. B.', 'z.B.')).toBe(true);
    expect(isMatch('zB', 'z. B.')).toBe(true);
    expect(isMatch('Mr.Smith', 'Mr. Smith')).toBe(true);
    expect(isMatch('U. S. A.', 'U.S.A.')).toBe(true);
    expect(isMatch('USA', 'U.S.A.')).toBe(true);
    expect(isMatch('er sagte"ja"', 'er sagte "ja"')).toBe(true);
    // A gap without a mark is still a word gap.
    expect(isMatch('etwangehen', 'etw angehen')).toBe(false);
    expect(isMatch('3. 5', '3.5')).toBe(false);
  });

  it('counts what is typed in parentheses when the answer has some', () => {
    expect(isMatch('Apfel (f)', 'Apfel (m)')).toBe(false);
    expect(isMatch('déjeuner (àmidi)', 'déjeuner (à midi)')).toBe(false);
    expect(isMatch('déjeuner àmidi', 'déjeuner (à midi)')).toBe(false);
    expect(isMatch('déjeuner (à midi)', 'déjeuner (à midi)')).toBe(true);
    expect(isMatch('déjeuner à midi', 'déjeuner (à midi)')).toBe(true);
    expect(isMatch('déjeuner', 'déjeuner (à midi)')).toBe(true);
    expect(isMatch('(go) run', '(to) run')).toBe(false);
    expect(isMatch('die Mahlzeit(-en)', 'die Mahlzeit (-en)')).toBe(true);
  });

  it('ignores first letter upper/lower case', () => {
    expect(isMatch('Apple', 'apple')).toBe(true);
    expect(isMatch('apple', 'Apple')).toBe(true);
    expect(isMatch('der hund', 'Der Hund')).toBe(true);
    expect(isMatch('Der Hund', 'der hund')).toBe(true);
    expect(isMatch('derhund', 'Der Hund')).toBe(false); // the space counts
    expect(isMatch('DerHund', 'der hund')).toBe(false);
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

  it('counts hyphens', () => {
    expect(isMatch('email', 'e-mail')).toBe(false);
    expect(isMatch('well known', 'well-known')).toBe(false);
    expect(isMatch('e-mail', 'email')).toBe(false);
    expect(isMatch('e-mail', 'e-mail')).toBe(true);
    expect(isMatch('well - known', 'well-known')).toBe(true); // spaces still don't count
  });

  it('marks a missing hyphen in the correction', () => {
    expect(lines('email', 'e-mail').expected).toBe('e+-+mail');
  });

  it('marks a missing space between words in the correction', () => {
    expect(lines('icecream', 'ice cream').expected).toBe('ice+ +cream');
    expect(lines('ice cream', 'icecream').given).toBe('ice- -cream');
  });

  it('does not count sentence marks', () => {
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

  it('takes any one alternative in the easier check, and still all of them', () => {
    expect(isMatch('Reaktion', 'Reaktion, Antwort', 'easier')).toBe(true);
    expect(isMatch('Antwort', 'Reaktion, Antwort', 'easier')).toBe(true);
    expect(isMatch('Antwort, Reaktion', 'Reaktion, Antwort', 'easier')).toBe(true);
    expect(isMatch('le dîner', 'le dîner / souper', 'easier')).toBe(true);
    expect(isMatch('Möhre', 'die Karotte / Möhre (-n)', 'easier')).toBe(true);
    expect(isMatch('Möhre (-n)', 'die Karotte / Möhre (-n)', 'easier')).toBe(true);
    // Still a real check: a wrong word, a slip, or more than was asked.
    expect(isMatch('Reaktoin', 'Reaktion, Antwort', 'easier')).toBe(false);
    expect(isMatch('Frage', 'Reaktion, Antwort', 'easier')).toBe(false);
    expect(isMatch('Reaktion, Frage', 'Reaktion, Antwort', 'easier')).toBe(false);
    // Commas inside a number or inside parentheses don't make alternatives.
    expect(isMatch('1', '1,5', 'easier')).toBe(false);
    expect(isMatch('Apfel', 'Apfel (m, f)', 'easier')).toBe(true);
    expect(isMatch('m', 'Apfel (m, f)', 'easier')).toBe(false);
    // The exact check is unchanged.
    expect(isMatch('Reaktion', 'Reaktion, Antwort')).toBe(false);
    expect(isMatch('Reaktion', 'Reaktion, Antwort', 'exact')).toBe(false);
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

  it('softens what the check ignores: extra spaces, edge punctuation, parentheses', () => {
    expect(lines('high   school', 'high school').given).toBe('high {  }school');
    expect(lines('well - known', 'well-known').given).toBe('well{ }-{ }known');
    expect(lines('como estas', '¿Cómo estás?').expected).toBe('{¿}C+ó+mo est+á+s{?}');
    expect(lines('Apfal', 'Apfel (m)').expected).toBe('Apf+e+l{ (m)}');
  });

  it('marks the slip that made an answer wrong, also next to parentheses', () => {
    const hard = (given: string, expected: string) =>
      computeDiff(given, expected).filter((p) => (p.added || p.removed) && !p.soft);
    expect(hard('torun', '(to) run').length).toBeGreaterThan(0);
    expect(hard('sichmerken', 'sich (etwas) merken').length).toBeGreaterThan(0);
    // ...and leaves alone what the check lets pass.
    expect(lines('etw.angehn', 'etw. angehen').expected).toBe('etw.{ }angeh+e+n');
  });

  it('never calls an answer wrong without marking something', () => {
    const pairs: [string, string][] = [
      ['torun', '(to) run'], ['sich etwasmerken', 'sich (etwas) merken'], ['icecream', 'ice cream'],
      ['rotblau', 'rot, blau'], ['l ami', "l'ami"], ['well known', 'well-known'], ['Apfel (f)', 'Apfel (m)'],
      ['déjeuner (àmidi)', 'déjeuner (à midi)'], ['GutenMorgen!', 'Guten Morgen!'], ['3,5kg', '3,5 kg'],
      ['Hola¿qué tal', 'Hola, ¿qué tal?'], ['ersie', 'er / sie'], ['bestimmen', 'bestimmen, festlegen'],
    ];
    for (const [given, expected] of pairs) {
      expect(isMatch(given, expected), `${given} / ${expected}`).toBe(false);
      const marked = computeDiff(given, expected).some((p) => (p.added || p.removed) && !p.soft);
      expect(marked, `${given} / ${expected}`).toBe(true);
    }
  });

  it('in the easier check, leaves the other alternatives unmarked', () => {
    const parts = computeDiff('Reaktoin', 'Reaktion, Antwort', 'easier');
    const hard = parts.filter((p) => (p.added || p.removed) && !p.soft).map((p) => p.value);
    expect(hard.join('')).not.toContain('Antwort');
    expect(hard.length).toBeGreaterThan(0);
  });

  it('copes with long answers', () => {
    const long = 'a'.repeat(900);
    expect(lines(long, `${long}b`).expected).toBe(`${long}+b+`);
  });
});

describe('switching sides mid-round', () => {
  const cards = [
    { id: 1, term: 'Hund', definition: 'dog' },
    { id: 2, term: 'Katze', definition: 'cat' },
  ];

  it('asks the current card from the other side and keeps the round', () => {
    let s = startSession(cards, { answerWith: 'term', shuffled: false });
    s = submitAnswer(s, 'Hund');
    s = advance(s);
    const switched = switchSides(s);
    expect(switched.answerWith).toBe('definition');
    expect(switched.index).toBe(s.index);
    expect(switched.credits).toEqual(s.credits);
    expect(submitAnswer(switched, 'cat').step.kind).toBe('correct');
    expect(switchSides(switched).answerWith).toBe('term');
  });

  it('waits while a verdict is showing', () => {
    const s = submitAnswer(startSession(cards, { answerWith: 'term', shuffled: false }), 'Fisch');
    expect(s.step.kind).toBe('reveal');
    expect(switchSides(s)).toBe(s);
  });
});

describe('"I was correct"', () => {
  it('also counts after a "don\'t know" (an empty Enter by mistake)', () => {
    const missed = dontKnow(start());
    const overruled = overrideCorrect(missed);
    expect(overruled.step).toEqual({ kind: 'correct', given: '', overridden: true });
    expect(overruled.missed).toEqual([]);
    expect(overruled.credits[1]).toBe(2);
  });
});

describe('the hint', () => {
  it('shows only while a card is asked, once', () => {
    const hinted = showHint(start());
    expect(hinted.step).toEqual({ kind: 'ask', hinted: true });
    expect(showHint(hinted)).toBe(hinted);
    const missed = submitAnswer(start(), 'chien');
    expect(showHint(missed)).toBe(missed);
  });

  it('a right answer with it counts this round, earns one credit and comes back next round', () => {
    let s = submitAnswer(showHint(start()), 'chat');
    expect(s.step).toMatchObject({ kind: 'correct', hinted: true });
    expect(s.missed).toEqual([]);
    expect(s.hinted).toEqual([1]);
    expect(s.credits[1]).toBe(1);
    s = advance(s);
    s = advance(submitAnswer(s, 'chien'));
    expect(s.step.kind).toBe('summary');
    expect(s.rounds[0]).toEqual({ round: 1, total: 2, missed: 0, hinted: 1, accuracy: 50 });
    expect(isFinished(s)).toBe(false);
    expect(masteredCount(s)).toBe(1);

    s = startNextRound(s);
    expect(s.queue).toEqual([1]);
    expect(s.hinted).toEqual([]);
    s = advance(submitAnswer(s, 'chat'));
    expect(isFinished(s)).toBe(true);
    expect(masteredCount(s)).toBe(2);
  });

  it('a wrong answer with it is a plain miss, and "I was correct" keeps it hinted', () => {
    const missed = submitAnswer(showHint(start()), 'chta');
    expect(missed.step).toMatchObject({ kind: 'reveal', hinted: true });
    expect(missed.missed).toEqual([1]);
    const overruled = overrideCorrect(missed);
    expect(overruled.step).toMatchObject({ kind: 'correct', overridden: true, hinted: true });
    expect(overruled.missed).toEqual([]);
    expect(overruled.hinted).toEqual([1]);
    expect(overruled.credits[1]).toBe(1);
  });

  it('goes when the sides switch', () => {
    const switched = switchSides(showHint(start()));
    expect(switched.step).toEqual({ kind: 'ask' });
    expect(submitAnswer(switched, 'cat').hinted).toEqual([]);
  });

  it('survives a save, and a round saved before the hint loads with none', () => {
    const s = showHint(start());
    expect(unpackWrite(packWrite(s), CARDS)?.step).toEqual({ kind: 'ask', hinted: true });

    const { hinted: _hinted, ...old } = packWrite(advance(submitAnswer(start(), 'chat')));
    const back = unpackWrite({ ...old, rounds: [{ round: 1, total: 2, missed: 1, accuracy: 50 }] }, CARDS)!;
    expect(back.hinted).toEqual([]);
    expect(back.rounds[0].hinted).toBe(0);
  });
});
