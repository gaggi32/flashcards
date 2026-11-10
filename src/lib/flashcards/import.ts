// Pasted text → term/definition pairs, entirely in the browser. The result
// goes into the editor as ordinary rows, so it can be checked and fixed before
// anything is saved.

export type TermSeparator = 'tab' | 'comma' | 'dash' | 'custom';
export type CardSeparator = 'newline' | 'semicolon' | 'custom';

export type ImportOptions = {
  between: TermSeparator;
  betweenCustom: string;
  cards: CardSeparator;
  cardsCustom: string;
};

export type ParsedImport = {
  cards: { term: string; definition: string }[];
  /** Non-blank chunks that had no separator, or an empty side. */
  skipped: string[];
};

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  between: 'dash',
  betweenCustom: '',
  cards: 'newline',
  cardsCustom: '',
};

/**
 * A dash only separates when it has a space on at least one side, so the
 * hyphen in "e-mail - electronic mail" stays part of the term. En and em
 * dashes count too — word processors turn " - " into " – " on their own.
 */
const DASH = /\s+[-–—]\s*|\s*[-–—]\s+/;

/** [before, after] around the first separator, or null if there is none. */
function splitOnce(chunk: string, options: ImportOptions): [string, string] | null {
  if (options.between === 'dash') {
    const match = DASH.exec(chunk);
    if (!match) return null;
    return [chunk.slice(0, match.index), chunk.slice(match.index + match[0].length)];
  }

  const sep =
    options.between === 'tab' ? '\t' : options.between === 'comma' ? ',' : options.betweenCustom;
  if (!sep) return null;
  const at = chunk.indexOf(sep);
  if (at === -1) return null;
  return [chunk.slice(0, at), chunk.slice(at + sep.length)];
}

function splitCards(text: string, options: ImportOptions): string[] {
  if (options.cards === 'semicolon') return text.split(';');
  if (options.cards === 'custom' && options.cardsCustom) {
    // Escape sequences typed by hand: "\n" in the box means a newline.
    return text.split(options.cardsCustom.replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
  }
  return text.split(/\r?\n/);
}

/**
 * Splits on the *first* separator only: "Paris, capital of France, on the
 * Seine" is one term and a definition that happens to contain a comma.
 */
export function parseImport(text: string, options: ImportOptions): ParsedImport {
  const cards: ParsedImport['cards'] = [];
  const skipped: string[] = [];

  for (const raw of splitCards(text, options)) {
    const chunk = raw.trim();
    if (!chunk) continue;

    const parts = splitOnce(chunk, options);
    const term = parts?.[0].trim() ?? '';
    const definition = parts?.[1].trim() ?? '';
    if (term && definition) cards.push({ term, definition });
    else skipped.push(chunk);
  }

  return { cards, skipped };
}
