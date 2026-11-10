import { describe, expect, it } from 'vitest';

import { MAX_SPECIAL_CHARS, specialCharsOf } from './specialChars';

function cards(...pairs: [string, string][]) {
  return pairs.map(([term, definition], i) => ({ id: i + 1, term, definition }));
}

describe('specialCharsOf', () => {
  it('lists each non-ASCII letter once, ordered by base letter', () => {
    const set = cards(['ñandu', 'rhea'], ['über', 'over'], ['ça', 'that'], ['été', 'summer']);
    expect(specialCharsOf(set, 'term')).toEqual(['ç', 'é', 'ñ', 'ü']);

    // Two accents on one base letter stay together.
    expect(specialCharsOf(cards(['ñ', 'x'], ['é', 'x'], ['è', 'x'], ['ç', 'x']), 'term')).toEqual([
      'ç',
      'é',
      'è',
      'ñ',
    ]);
  });

  it('takes only the side being typed', () => {
    const set = cards(['chat', 'gato — ñu'], ['chien', 'perro']);
    expect(specialCharsOf(set, 'term')).toEqual([]);
    expect(specialCharsOf(set, 'definition')).toEqual(['ñ']);
  });

  it('folds upper and lower case into one button', () => {
    expect(specialCharsOf(cards(['École', 'school'], ['été', 'summer']), 'term')).toEqual(['é']);
  });

  it('counts an accent stored as a combining mark as its letter', () => {
    const decomposed = 'café';
    expect(specialCharsOf(cards([decomposed, 'coffee']), 'term')).toEqual(['é']);
  });

  it('gives punctuation and symbols no button', () => {
    const set = cards(['aujourd’hui', 'today'], ['¿Cómo estás?', 'how are you'], ['« oui » – 5 €', 'yes']);
    expect(specialCharsOf(set, 'term')).toEqual(['á', 'ó']);
  });

  it('gives nothing to what already grades as ASCII', () => {
    expect(specialCharsOf(cards(['ﬁnd', 'x'], ['Ａbc', 'y']), 'term')).toEqual([]);
  });

  it('does not split "İ" into a stray combining dot', () => {
    expect(specialCharsOf(cards(['İstanbul', 'x']), 'term')).toEqual(['İ']);
  });

  it('is empty for a plain ASCII set', () => {
    expect(specialCharsOf(cards(['cat', 'chat']), 'term')).toEqual([]);
  });

  it('hides the keyboard when the set is in a script typed with an IME', () => {
    const kanji = Array.from({ length: MAX_SPECIAL_CHARS + 1 }, (_, i) =>
      String.fromCodePoint(0x4e00 + i),
    ).join('');
    expect(specialCharsOf(cards([kanji, 'x']), 'term')).toEqual([]);
    expect(specialCharsOf(cards([kanji.slice(0, MAX_SPECIAL_CHARS), 'x']), 'term')).toHaveLength(
      MAX_SPECIAL_CHARS,
    );
  });
});
