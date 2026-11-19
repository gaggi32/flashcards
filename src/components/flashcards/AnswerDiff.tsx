// The two lines under a missed typed answer: what was typed, with what is
// wrong struck through, and the answer, with what was missing underlined.
// Differences the check ignores (spaces, edge punctuation, parentheses) are
// shown faint instead, since they are not why the answer was wrong.
//
// Each marked piece carries its place among the marked ones (--i), so the
// strike-throughs and underlines are drawn in one after another (motion.css).

import type { CSSProperties } from 'react';

import type { DiffPart } from '@/lib/flashcards/diff';

const order = (i: number) => ({ '--i': i }) as CSSProperties;

export function TypedLine({ parts }: { parts: DiffPart[] }) {
  let n = 0;
  return (
    <>
      {parts
        .filter((p) => !p.added)
        .map((p, i) =>
          p.removed ? (
            <span key={i} className={p.soft ? 'fc-diff-soft' : 'fc-diff-rem'} style={p.soft ? undefined : order(n++)}>
              {p.value}
            </span>
          ) : (
            <span key={i}>{p.typed ?? p.value}</span>
          ),
        )}
    </>
  );
}

export function AnswerLine({ parts }: { parts: DiffPart[] }) {
  let n = 0;
  return (
    <>
      {parts
        .filter((p) => !p.removed)
        .map((p, i) =>
          p.added ? (
            <span key={i} className={p.soft ? 'fc-diff-soft' : 'fc-diff-add'} style={p.soft ? undefined : order(n++)}>
              {p.value}
            </span>
          ) : (
            <span key={i}>{p.value}</span>
          ),
        )}
    </>
  );
}
