// A test on paper: the same questions as on screen, laid out to print, with
// an optional answer key on a page of its own. The sheet is rendered into
// <body> but only shows in print (`@media print` in flashcards.css hides
// everything else), so it is what WebView2 turns into the PDF, or what the
// macOS print panel prints.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { isMacPlatform } from '@/lib/app/hotkey';
import { savePdf } from '@/lib/app/native';
import { IS_WEB } from '@/lib/app/platform';
import { errorMessage } from '@/lib/flashcards/client';
import { plural } from '@/lib/flashcards/format';
import { KIND_LABEL, LETTERS, keyLines, numbered, progress, type Question, type Test } from '@/lib/flashcards/test';
import { answerOf, promptOf, type AnswerWith, type StudyCard } from '@/lib/flashcards/write';

const other = (s: AnswerWith): AnswerWith => (s === 'term' ? 'definition' : 'term');

/**
 * What the PDF button says: Windows saves the file, macOS and the web version
 * open the print dialog (which has "Save as PDF").
 */
export const PDF_LABEL = IS_WEB || isMacPlatform() ? 'print or PDF' : 'save as PDF';

type Sheet = { test: Test; withKey: boolean };

/**
 * `save(test, withKey)` puts that test on the sheet and makes the PDF; `sheet`
 * is the element to render. `note` says where it went, or what went wrong.
 */
export function useTestPdf(title: string, cards: readonly StudyCard[]) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const pending = useRef<(() => void) | null>(null);

  // The PDF is made once the sheet is on the page.
  useEffect(() => {
    const run = pending.current;
    pending.current = null;
    if (run) requestAnimationFrame(() => requestAnimationFrame(run));
  }, [sheet]);

  function save(test: Test, withKey: boolean) {
    if (busy) return;
    setBusy(true);
    setNote(null);
    pending.current = () => {
      savePdf(`${title} - test`)
        .then((path) => {
          if (path) setNote({ ok: true, text: `Saved ${path.split(/[\\/]/).pop()}` });
        })
        .catch((err: unknown) => setNote({ ok: false, text: errorMessage(err, 'Could not make the PDF.') }))
        .finally(() => setBusy(false));
    };
    // The sheet stays after the PDF: the macOS print panel may still be laying it out.
    setSheet({ test, withKey });
  }

  const element = sheet
    ? createPortal(<PrintSheet title={title} cards={cards} test={sheet.test} withKey={sheet.withKey} />, document.body)
    : null;
  return { save, busy, note, sheet: element };
}

function PrintSheet({
  title,
  cards,
  test,
  withKey,
}: {
  title: string;
  cards: readonly StudyCard[];
  test: Test;
  withKey: boolean;
}) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const questions = numbered(test);
  const { total } = progress(test);
  return (
    <div className="fc-print" aria-hidden="true">
      <header className="fc-print__head">
        <h1 className="fc-print__title">{title}</h1>
        <div className="fc-print__meta">
          Test · {plural(total, 'question')}
        </div>
        <div className="fc-print__fields">
          <span>Name</span>
          <span>Date</span>
          <span>Score&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/ {total}</span>
        </div>
      </header>

      {questions.map(({ q, first }) => (
        <PrintQuestion key={q.id} q={q} first={first} byId={byId} />
      ))}

      {withKey && (
        <section className="fc-print__key">
          <h2 className="fc-print__keytitle">Answer key · {title}</h2>
          <ol className="fc-print__keylist">
            {questions.flatMap(({ q, first }) =>
              keyLines(q, first, byId).map((line) => (
                <li key={`${q.id}-${line.number}`}>
                  <span className="fc-print__num">{line.number}</span>
                  {line.text}
                </li>
              )),
            )}
          </ol>
        </section>
      )}
    </div>
  );
}

function PrintQuestion({ q, first, byId }: { q: Question; first: number; byId: ReadonlyMap<number, StudyCard> }) {
  const label = q.kind === 'matching' && q.cardIds.length > 1 ? `${first}–${first + q.cardIds.length - 1}` : `${first}`;
  const promptSide = other(q.answerWith);
  let body: React.ReactNode = null;
  let task = '';

  if (q.kind === 'matching') {
    task = `Write the letter of each ${q.answerWith} on the line.`;
    body = (
      <div className="fc-pq__match">
        <ol className="fc-pq__rows">
          {q.cardIds.map((id, row) => {
            const card = byId.get(id);
            return (
              <li key={id}>
                <span className="fc-print__num">{first + row}</span>
                <span className="fc-pq__blank" />
                {card ? promptOf(card, q.answerWith) : ''}
              </li>
            );
          })}
        </ol>
        <ol className="fc-pq__options">
          {q.answers.map((id, i) => {
            const card = byId.get(id);
            return (
              <li key={id}>
                <span className="fc-pq__letter">{LETTERS[i]}</span>
                {card ? answerOf(card, q.answerWith) : ''}
              </li>
            );
          })}
        </ol>
      </div>
    );
  } else {
    const card = byId.get(q.cardId);
    if (!card) return null;
    const prompt = (
      <div className="fc-pq__prompt">
        <span className="fc-pq__side">{promptSide}</span>
        {promptOf(card, q.answerWith)}
      </div>
    );
    if (q.kind === 'truefalse') {
      const shown = byId.get(q.shownId) ?? card;
      task = 'Do they belong together? Tick one.';
      body = (
        <>
          {prompt}
          <div className="fc-pq__prompt">
            <span className="fc-pq__side">{q.answerWith}</span>
            {answerOf(shown, q.answerWith)}
          </div>
          <div className="fc-pq__ticks">
            <span>
              <span className="fc-pq__box" /> true
            </span>
            <span>
              <span className="fc-pq__box" /> false
            </span>
          </div>
        </>
      );
    } else if (q.kind === 'choice') {
      task = `Tick the ${q.answerWith}.`;
      body = (
        <>
          {prompt}
          <ol className="fc-pq__choices">
            {q.options.map((id, i) => {
              const option = byId.get(id);
              return (
                <li key={id}>
                  <span className="fc-pq__box" />
                  <span className="fc-pq__letter">{LETTERS[i]}</span>
                  {option ? answerOf(option, q.answerWith) : ''}
                </li>
              );
            })}
          </ol>
        </>
      );
    } else {
      task = `Write the ${q.answerWith}.`;
      body = (
        <>
          {prompt}
          <div className="fc-pq__line" />
        </>
      );
    }
  }

  return (
    <section className={`fc-pq fc-pq--${q.kind}`}>
      <div className="fc-pq__head">
        <span className="fc-pq__num">{label}</span>
        <span className="fc-pq__kind">{KIND_LABEL[q.kind]}</span>
        <span className="fc-pq__task">{task}</span>
      </div>
      {body}
    </section>
  );
}
