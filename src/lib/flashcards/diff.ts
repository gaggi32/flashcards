// The correction under a missed answer: what was typed against the answer,
// letter by letter.
//
// An alignment that only counts matching letters (a plain LCS) finds stray
// matches everywhere: "de" against "determine" can pair the e with the last
// letter, and "house" against "maison" lights up a lone s. This one scores
// each matching letter and charges for every stretch of change, so it keeps
// matches together in as few runs as it can, and an island of one letter
// inside a change is not worth breaking the change for. On a tie it takes the
// earliest match, so a correct start stays a correct start.

export type DiffPart = {
  /** The answer's text, or for a `removed` part, the typed text. */
  value: string;
  /** For a part in both: the same stretch as typed (its case may differ). */
  typed?: string;
  /** In the answer only: missing from what was typed. */
  added?: boolean;
  /** Typed only: not in the answer. */
  removed?: boolean;
  /**
   * A difference the check does not count — spaces, sentence marks,
   * punctuation at either end, anything in parentheses — so it is not
   * marked as an error.
   */
  soft?: boolean;
};

const MATCH = 10;
/** A shared space keeps words lined up with words ("der Hund" / "die Katze"). */
const MATCH_SPACE = 30;
/** Per stretch of change: more than one matching letter, less than two. */
const OPEN = 9;
/** Above this many cells (about 630 × 630 letters) the alignment gets cheap. */
const MAX_CELLS = 400_000;

type Op = 'M' | 'D' | 'I';

function fold(c: string): string {
  return c
    .replace(/[‘’‚‛′´`ʼ]/, "'")
    .replace(/[“”„‟″«»]/, '"')
    .replace(/[‐‑‒–—―−]/, '-')
    .replace(/\s/, ' ')
    .toLowerCase();
}

const gain = (c: string) => (c === ' ' ? MATCH_SPACE : MATCH);

/** Best-scoring alignment of a (typed) to b (answer), as a list of ops. */
function align(a: string[], b: string[]): Op[] {
  const m = a.length;
  const n = b.length;
  const fa = a.map(fold);
  const fb = b.map(fold);

  if ((m + 1) * (n + 1) > MAX_CELLS) return cheapAlign(fa, fb);

  // S[p][i][j]: best score for a[i:] against b[j:] when the op before was p
  // (0 = match or start, 1 = removed, 2 = added). Computed from the end, so
  // the walk below goes forward and can take the earliest of equal choices.
  const W = n + 1;
  const plane = (m + 1) * W;
  const S = new Int32Array(3 * plane);
  const at = (p: number, i: number, j: number) => p * plane + i * W + j;

  for (let i = m; i >= 0; i--) {
    for (let j = n; j >= 0; j--) {
      if (i === m && j === n) continue; // 0 already
      const match = i < m && j < n && fa[i] === fb[j] ? gain(fb[j]) + S[at(0, i + 1, j + 1)] : -Infinity;
      for (let p = 0; p < 3; p++) {
        let best = match;
        if (i < m) best = Math.max(best, (p === 1 ? 0 : -OPEN) + S[at(1, i + 1, j)]);
        if (j < n) best = Math.max(best, (p === 2 ? 0 : -OPEN) + S[at(2, i, j + 1)]);
        S[at(p, i, j)] = best;
      }
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  let p = 0;
  while (i < m || j < n) {
    const here = S[at(p, i, j)];
    if (i < m && j < n && fa[i] === fb[j] && gain(fb[j]) + S[at(0, i + 1, j + 1)] === here) {
      ops.push('M');
      i++;
      j++;
      p = 0;
    } else if (i < m && (p === 1 ? 0 : -OPEN) + S[at(1, i + 1, j)] === here) {
      ops.push('D');
      i++;
      p = 1;
    } else {
      ops.push('I');
      j++;
      p = 2;
    }
  }
  return ops;
}

/** For very long answers: the shared start and end, and the middle as changed. */
function cheapAlign(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  return [
    ...Array<Op>(start).fill('M'),
    ...Array<Op>(a.length - start - end).fill('D'),
    ...Array<Op>(b.length - start - end).fill('I'),
    ...Array<Op>(end).fill('M'),
  ];
}

const isWord = (c: string) => /[\p{L}\p{N}]/u.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/**
 * Which letters of a string the check would not count if they were missing
 * or extra: the same leeway isMatch gives (see answerKey in write.ts).
 */
function softMask(s: string[]): boolean[] {
  const first = s.findIndex(isWord);
  let last = -1;
  for (let k = s.length - 1; k >= 0; k--) {
    if (isWord(s[k])) {
      last = k;
      break;
    }
  }

  // Parentheses and what is in them, when there is something outside them.
  const inParens = Array<boolean>(s.length).fill(false);
  let depth = 0;
  let outside = false;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '(') depth++;
    inParens[k] = depth > 0 || s[k] === ')';
    if (s[k] === ')' && depth > 0) depth--;
    if (!inParens[k] && isWord(s[k])) outside = true;
  }

  return s.map((c, k) => {
    const f = fold(c);
    if (outside && inParens[k]) return true;
    if (f === ' ' || /[!?¿¡"]/.test(f)) return true;
    if (f === '.' || f === ',') {
      if (isDigit(s[k - 1]) && isDigit(s[k + 1])) return false;
      if (f === '.') return true;
    }
    // Punctuation before the first or after the last letter.
    return (k < first || k > last || first === -1) && /[.,;:'()]/.test(f);
  });
}

export function computeDiff(given: string, expected: string): DiffPart[] {
  const a = Array.from(given.normalize('NFC'));
  const b = Array.from(expected.normalize('NFC'));
  const ops = align(a, b);
  const softA = softMask(a);
  const softB = softMask(b);

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  for (let k = 0; k < ops.length; ) {
    const op = ops[k];
    let len = 0;
    while (k + len < ops.length && ops[k + len] === op) len++;
    k += len;

    if (op === 'M') {
      parts.push({ value: b.slice(j, j + len).join(''), typed: a.slice(i, i + len).join('') });
      i += len;
      j += len;
    } else if (op === 'D') {
      const soft = softA.slice(i, i + len).every(Boolean);
      parts.push({ value: a.slice(i, i + len).join(''), removed: true, ...(soft ? { soft } : {}) });
      i += len;
    } else {
      const soft = softB.slice(j, j + len).every(Boolean);
      parts.push({ value: b.slice(j, j + len).join(''), added: true, ...(soft ? { soft } : {}) });
      j += len;
    }
  }
  return parts;
}
