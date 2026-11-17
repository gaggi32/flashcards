// Test: the set as one paper. Pick how many questions and which kinds, answer
// them in any order, hand it in, and see what was right, with every question
// marked. A test in progress stays while the app runs (leave for another set
// and come back to it), but it is not saved: a test is short, and one sat
// again tomorrow should be new.

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { ask } from '@/components/Dialogs';
import Link from '@/components/Link';
import { AnswerLine, TypedLine } from '@/components/flashcards/AnswerDiff';
import { IconCheck, IconClose } from '@/components/flashcards/FlashcardIcons';
import { ResetButton } from '@/components/flashcards/ResetButton';
import { SpecialKeys } from '@/components/flashcards/SpecialKeys';
import { StudyArea, StudyHeader } from '@/components/flashcards/StudyHeader';
import { SetLoadState, useSet } from '@/components/flashcards/useSet';
import { useSettings } from '@/lib/app/settings';
import { computeDiff } from '@/lib/flashcards/diff';
import { plural } from '@/lib/flashcards/format';
import { specialCharsOf } from '@/lib/flashcards/specialChars';
import {
  KIND_LABEL,
  TEST_KINDS,
  answer,
  answeredPoints,
  buildTest,
  finish,
  kindsFor,
  markQuestion,
  matchPair,
  overrideWritten,
  pointsOf,
  progress,
  reconcile,
  score,
  type Mark,
  type Question,
  type Test,
  type TestKind,
  type TestOptions,
  type TestSide,
} from '@/lib/flashcards/test';
import type { SetDTO } from '@/lib/flashcards/types';
import { answerOf, normalizeAnswer, promptOf, type AnswerCheck, type AnswerWith, type StudyCard } from '@/lib/flashcards/write';

/** Tests in progress (and the last options), per set, for as long as the app runs. */
const papers = new Map<number, Test>();
const lastOptions = new Map<number, TestOptions>();

const DEFAULT_COUNT = 20;
const LETTERS = 'ABCDEFGHIJ';
const SIDE: Record<AnswerWith, string> = { term: 'term', definition: 'definition' };
const other = (s: AnswerWith): AnswerWith => (s === 'term' ? 'definition' : 'term');

export function TestClient({ setId }: { setId: number }) {
  const { set, error } = useSet(setId);
  if (!set) {
    return (
      <main>
        <SetLoadState error={error} />
      </main>
    );
  }
  return (
    <main>
      <StudyHeader set={set} mode="test" />
      {set.cards.length === 0 ? (
        <div className="rt-empty">
          No cards to test. <Link href={`/flashcards/${set.id}/edit`}>Add some</Link> first.
        </div>
      ) : (
        <StudyArea>
          <TestMode set={set} />
        </StudyArea>
      )}
    </main>
  );
}

function TestMode({ set }: { set: SetDTO }) {
  const check = useSettings().settings?.answerCheck ?? 'exact';
  const [test, setTestState] = useState<Test | null>(() => {
    const kept = papers.get(set.id);
    return kept ? reconcile(kept, set.cards) : null;
  });
  // The set changed under the test (a card deleted in the editor or the overlay).
  useEffect(() => {
    setTestState((t) => (t ? reconcile(t, set.cards) : t));
  }, [set.cards]);

  function setTest(next: Test | null) {
    if (next) papers.set(set.id, next);
    else papers.delete(set.id);
    setTestState(next);
  }

  function start(options: TestOptions, cards: readonly StudyCard[] = set.cards) {
    lastOptions.set(set.id, options);
    setTest(buildTest(cards, options));
    window.scrollTo({ top: 0 });
  }

  if (!test) {
    return <Setup set={set} onStart={start} />;
  }
  return (
    <Paper
      key={test.startedAt}
      set={set}
      test={test}
      check={check}
      onChange={setTest}
      onNew={() => start(test.options)}
      onMissed={(ids) => start({ ...test.options, count: ids.length }, set.cards.filter((c) => ids.includes(c.id)))}
      onSettings={() => setTest(null)}
    />
  );
}

// --- setup ---

function Setup({ set, onStart }: { set: SetDTO; onStart: (o: TestOptions) => void }) {
  const uid = useId();
  const total = set.cards.length;
  const can = useMemo(() => kindsFor(set.cards), [set.cards]);
  const before = lastOptions.get(set.id);
  const [count, setCount] = useState(Math.min(before?.count ?? DEFAULT_COUNT, total));
  const [answerWith, setAnswerWith] = useState<TestSide>(before?.answerWith ?? 'term');
  const [kinds, setKinds] = useState<TestKind[]>(
    (before?.kinds ?? TEST_KINDS).filter((k) => can[k]).length > 0
      ? (before?.kinds ?? TEST_KINDS).filter((k) => can[k])
      : ['written'],
  );

  const sides: { value: TestSide; title: string; sub: string }[] = [
    { value: 'term', title: 'term', sub: 'See the definition, answer with the term.' },
    { value: 'definition', title: 'definition', sub: 'See the term, answer with the definition.' },
    { value: 'both', title: 'both', sub: 'Some one way, some the other.' },
  ];
  const kindSub: Record<TestKind, string> = {
    truefalse: 'Do the two belong together?',
    choice: can.choice ? 'Pick the answer out of four.' : `Needs ${5} cards with different answers.`,
    matching: 'Put up to five answers next to their prompts.',
    written: 'Type the answer, marked like Write.',
  };

  const n = Math.max(1, Math.min(Number.isFinite(count) ? count : 1, total));

  return (
    <form
      className="fc-panel fc-setup"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ count: n, answerWith, kinds });
      }}
    >
      <div className="rt-field">
        <label className="rt-field__label" htmlFor={`${uid}-count`}>
          questions
        </label>
        <div className="fc-testcount">
          <input
            id={`${uid}-count`}
            type="number"
            className="rt-input fc-testcount__input"
            min={1}
            max={total}
            value={Number.isFinite(count) ? count : ''}
            onChange={(e) => setCount(e.target.valueAsNumber)}
          />
          <span className="rt-small rt-ink-soft">of {plural(total, 'card')}</span>
          {total > 1 && n !== total && (
            <button type="button" className="rt-linkbtn" onClick={() => setCount(total)}>
              all
            </button>
          )}
        </div>
      </div>

      <fieldset className="fc-fieldset">
        <legend className="rt-field__label">answer with</legend>
        <div className="fc-options fc-options--three">
          {sides.map((o) => (
            <label key={o.value} className={`fc-option${answerWith === o.value ? ' is-active' : ''}`}>
              <input
                type="radio"
                name={`${uid}-side`}
                className="fc-option__input"
                checked={answerWith === o.value}
                onChange={() => setAnswerWith(o.value)}
              />
              <span className="fc-option__title">{o.title}</span>
              <span className="fc-option__sub">{o.sub}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="fc-fieldset">
        <legend className="rt-field__label">questions to ask</legend>
        <div className="fc-options">
          {TEST_KINDS.map((k) => {
            const on = kinds.includes(k);
            return (
              <label
                key={k}
                className={`fc-option${on ? ' is-active' : ''}${can[k] ? '' : ' is-disabled'}`}
              >
                <input
                  type="checkbox"
                  className="fc-option__input"
                  checked={on}
                  disabled={!can[k]}
                  onChange={() =>
                    setKinds((ks) => (on ? ks.filter((x) => x !== k) : TEST_KINDS.filter((x) => x === k || ks.includes(x))))
                  }
                />
                <span className="fc-option__title">{KIND_LABEL[k]}</span>
                <span className="fc-option__sub">{kindSub[k]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className="rt-small fc-setup__rules">
        Answer in any order, then hand it in to see your score and every answer marked. Nothing is
        marked until then. A test is kept while Flashcards is open, not after.
      </p>

      <div className="rt-btnrow">
        <button type="submit" className="rt-btn rt-btn--primary" disabled={kinds.length === 0} autoFocus>
          start test · {plural(n, 'question')}
        </button>
        {kinds.length === 0 && <span className="rt-small rt-ink-soft">Pick at least one kind of question.</span>}
      </div>
    </form>
  );
}

// --- the paper ---

function Paper({
  set,
  test,
  check,
  onChange,
  onNew,
  onMissed,
  onSettings,
}: {
  set: SetDTO;
  test: Test;
  check: AnswerCheck;
  onChange: (t: Test) => void;
  onNew: () => void;
  onMissed: (cardIds: number[]) => void;
  onSettings: () => void;
}) {
  const byId = useMemo(() => new Map(set.cards.map((c) => [c.id, c])), [set.cards]);
  const done = test.finishedAt !== null;
  const { answered, total } = progress(test);
  const result = done ? score(test, set.cards, check) : null;
  const top = useRef<HTMLDivElement>(null);

  async function handIn() {
    const left = total - answered;
    if (
      left > 0 &&
      !(await ask.confirm(
        `${left === 1 ? '1 question is' : `${left} questions are`} not answered yet. Hand in the test anyway? Unanswered questions count as wrong.`,
        { ok: 'hand in' },
      ))
    ) {
      return;
    }
    onChange(finish(test));
    requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' }));
  }

  // Question numbers run through the paper; a matching block takes one per prompt.
  let number = 0;
  const numbered = test.questions.map((q) => {
    const first = number + 1;
    number += pointsOf(q);
    return { q, first };
  });
  const sections = TEST_KINDS.map((kind) => ({ kind, items: numbered.filter((x) => x.q.kind === kind) })).filter(
    (s) => s.items.length > 0,
  );

  return (
    <div className="fc-test" ref={top}>
      {result && (
        <Results
          setId={set.id}
          test={test}
          right={result.right}
          total={result.total}
          percent={result.percent}
          byKind={result.byKind}
          missed={result.missedCardIds}
          onNew={onNew}
          onMissed={() => onMissed(result.missedCardIds)}
          onSettings={onSettings}
        />
      )}

      {sections.map((s) => (
        <section key={s.kind} className="fc-test__section" aria-label={KIND_LABEL[s.kind]}>
          <h2 className="fc-test__heading">
            {KIND_LABEL[s.kind]}
            <span className="fc-test__count">
              {plural(
                s.items.reduce((n, x) => n + pointsOf(x.q), 0),
                'question',
              )}
            </span>
          </h2>
          {s.items.map(({ q, first }) => (
            <QuestionCard
              key={q.id}
              q={q}
              first={first}
              total={total}
              test={test}
              byId={byId}
              check={check}
              allCards={set.cards}
              onChange={onChange}
            />
          ))}
        </section>
      ))}

      {!done && (
        <div className="fc-test__bar">
          <span className="fc-test__answered">
            {answered} / {total} answered
          </span>
          <div className="fc-meter" aria-hidden="true">
            <span className="fc-meter__fill" style={{ width: `${(answered / total) * 100}%` }} />
          </div>
          <ResetButton
            question="start over?"
            title="Back to the start screen: this test and its answers are thrown away"
            onReset={onSettings}
          />
          <button type="button" className="rt-btn rt-btn--primary" onClick={() => void handIn()}>
            hand in
          </button>
        </div>
      )}
    </div>
  );
}

// --- one question ---

function QuestionCard({
  q,
  first,
  total,
  test,
  byId,
  check,
  allCards,
  onChange,
}: {
  q: Question;
  first: number;
  total: number;
  test: Test;
  byId: ReadonlyMap<number, StudyCard>;
  check: AnswerCheck;
  allCards: readonly StudyCard[];
  onChange: (t: Test) => void;
}) {
  const done = test.finishedAt !== null;
  const marks = done ? markQuestion(test, q, byId, check) : null;
  const allRight = marks?.every((m) => m.right);
  const state = marks ? (allRight ? ' is-right' : ' is-wrong') : answeredPoints(test, q) > 0 ? ' is-answered' : '';
  const label = q.kind === 'matching' && q.cardIds.length > 1 ? `${first}–${first + q.cardIds.length - 1}` : `${first}`;

  return (
    <div className={`fc-tq${state}`} data-question={q.id}>
      <div className="fc-tq__head">
        <span className="fc-tq__num">
          {label} <span className="rt-ink-faint">of {total}</span>
        </span>
        {marks && (
          <span className={`fc-tq__mark${allRight ? ' is-right' : ' is-wrong'}`}>
            {allRight ? <IconCheck size={14} /> : <IconClose size={14} />}
            {q.kind === 'matching' ? `${marks.filter((m) => m.right).length} / ${marks.length}` : allRight ? 'right' : marks[0].answered ? 'wrong' : 'not answered'}
          </span>
        )}
      </div>
      {q.kind === 'truefalse' && <TrueFalse q={q} test={test} byId={byId} onChange={onChange} />}
      {q.kind === 'choice' && <Choice q={q} test={test} byId={byId} onChange={onChange} />}
      {q.kind === 'matching' && <Matching q={q} test={test} byId={byId} marks={marks} onChange={onChange} />}
      {q.kind === 'written' && (
        <Written q={q} test={test} byId={byId} check={check} marks={marks} allCards={allCards} onChange={onChange} />
      )}
    </div>
  );
}

function Prompt({ side, text }: { side: string; text: string }) {
  return (
    <div className="fc-tq__prompt">
      <span className="fc-tq__side">{side}</span>
      <div className="fc-tq__text">{text}</div>
    </div>
  );
}

function TrueFalse({
  q,
  test,
  byId,
  onChange,
}: {
  q: Extract<Question, { kind: 'truefalse' }>;
  test: Test;
  byId: ReadonlyMap<number, StudyCard>;
  onChange: (t: Test) => void;
}) {
  const uid = useId();
  const card = byId.get(q.cardId);
  const shown = byId.get(q.shownId);
  if (!card || !shown) return null;
  const given = test.answers[q.id];
  const done = test.finishedAt !== null;
  // True when the shown answer is the card's own (or reads the same).
  const truthful =
    q.shownId === q.cardId || normalizeAnswer(answerOf(shown, q.answerWith)) === normalizeAnswer(answerOf(card, q.answerWith));
  return (
    <>
      <div className="fc-tq__pair">
        <Prompt side={SIDE[other(q.answerWith)]} text={promptOf(card, q.answerWith)} />
        <Prompt side={SIDE[q.answerWith]} text={answerOf(shown, q.answerWith)} />
      </div>
      <div className="fc-tq__choices fc-tq__choices--two" role="radiogroup" aria-label="True or false">
        {[true, false].map((v) => {
          let cls = given === v ? ' is-picked' : '';
          if (done) cls = v === truthful ? ' is-correct' : given === v ? ' is-wrong' : ' is-dim';
          return (
            <label key={String(v)} className={`fc-choice${cls}`}>
              <input
                type="radio"
                name={`${uid}-tf`}
                className="fc-option__input"
                checked={given === v}
                disabled={done}
                onChange={() => onChange(answer(test, q.id, v))}
              />
              <span className="fc-choice__text">{v ? 'True' : 'False'}</span>
            </label>
          );
        })}
      </div>
      {done && !truthful && (
        <p className="rt-small rt-ink-soft fc-tq__note">
          The {SIDE[q.answerWith]} is “{answerOf(card, q.answerWith)}”.
        </p>
      )}
    </>
  );
}

function Choice({
  q,
  test,
  byId,
  onChange,
}: {
  q: Extract<Question, { kind: 'choice' }>;
  test: Test;
  byId: ReadonlyMap<number, StudyCard>;
  onChange: (t: Test) => void;
}) {
  const uid = useId();
  const card = byId.get(q.cardId);
  if (!card) return null;
  const given = test.answers[q.id];
  const done = test.finishedAt !== null;
  const rightText = answerOf(card, q.answerWith);
  return (
    <>
      <Prompt side={SIDE[other(q.answerWith)]} text={promptOf(card, q.answerWith)} />
      <div className="fc-tq__choices" role="radiogroup" aria-label={`Pick the ${SIDE[q.answerWith]}`}>
        {q.options.map((id, i) => {
          const option = byId.get(id);
          if (!option) return null;
          const text = answerOf(option, q.answerWith);
          let cls = given === id ? ' is-picked' : '';
          if (done) cls = normalizeAnswer(text) === normalizeAnswer(rightText) ? ' is-correct' : given === id ? ' is-wrong' : ' is-dim';
          return (
            <label key={id} className={`fc-choice${cls}`}>
              <input
                type="radio"
                name={`${uid}-choice`}
                className="fc-option__input"
                checked={given === id}
                disabled={done}
                onChange={() => onChange(answer(test, q.id, id))}
              />
              <span className="fc-choice__key" aria-hidden="true">
                {LETTERS[i]}
              </span>
              <span className="fc-choice__text">{text}</span>
            </label>
          );
        })}
      </div>
    </>
  );
}

function Matching({
  q,
  test,
  byId,
  marks,
  onChange,
}: {
  q: Extract<Question, { kind: 'matching' }>;
  test: Test;
  byId: ReadonlyMap<number, StudyCard>;
  marks: Mark[] | null;
  onChange: (t: Test) => void;
}) {
  const uid = useId();
  const done = test.finishedAt !== null;
  const a = test.answers[q.id];
  const pairs: Record<number, number> = typeof a === 'object' ? a : {};
  const letterOf = (id: number) => LETTERS[q.answers.indexOf(id)];
  const used = new Set(Object.values(pairs));
  return (
    <div className="fc-match">
      <ol className="fc-match__answers" aria-label={`The ${SIDE[q.answerWith]}s`}>
        {q.answers.map((id, i) => {
          const c = byId.get(id);
          return (
            <li key={id} className={`fc-match__answer${!done && used.has(id) ? ' is-used' : ''}`}>
              <span className="fc-choice__key" aria-hidden="true">
                {LETTERS[i]}
              </span>
              <span className="fc-choice__text">{c ? answerOf(c, q.answerWith) : ''}</span>
            </li>
          );
        })}
      </ol>
      <div className="fc-match__prompts">
        {q.cardIds.map((id, row) => {
          const c = byId.get(id);
          if (!c) return null;
          const put = pairs[id];
          const mark = marks?.[row];
          return (
            <div key={id} className={`fc-match__row${mark ? (mark.right ? ' is-right' : ' is-wrong') : ''}`}>
              <div className="fc-match__prompt">{promptOf(c, q.answerWith)}</div>
              <div className="fc-match__letters" role="radiogroup" aria-label={`The ${SIDE[q.answerWith]} for ${promptOf(c, q.answerWith)}`}>
                {q.answers.map((answerId, i) => {
                  let cls = put === answerId ? ' is-picked' : '';
                  if (done) cls = answerId === id ? ' is-correct' : put === answerId ? ' is-wrong' : ' is-dim';
                  return (
                    <label key={answerId} className={`fc-letter${cls}`} title={done ? undefined : `Put ${LETTERS[i]} here`}>
                      <input
                        type="radio"
                        name={`${uid}-${id}`}
                        className="fc-option__input"
                        checked={put === answerId}
                        disabled={done}
                        onChange={() => onChange(matchPair(test, q.id, id, answerId))}
                        onClick={() => {
                          // A second click on the picked letter takes it off again.
                          if (put === answerId) onChange(matchPair(test, q.id, id, null));
                        }}
                      />
                      {LETTERS[i]}
                    </label>
                  );
                })}
              </div>
              {mark && !mark.right && (
                <span className="rt-small rt-ink-soft fc-match__fix">
                  {put === undefined ? 'not answered · ' : ''}it is {letterOf(id)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Written({
  q,
  test,
  byId,
  check,
  marks,
  allCards,
  onChange,
}: {
  q: Extract<Question, { kind: 'written' }>;
  test: Test;
  byId: ReadonlyMap<number, StudyCard>;
  check: AnswerCheck;
  marks: Mark[] | null;
  allCards: readonly StudyCard[];
  onChange: (t: Test) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const chars = useMemo(() => specialCharsOf([...allCards], q.answerWith), [allCards, q.answerWith]);
  const card = byId.get(q.cardId);
  if (!card) return null;
  const done = test.finishedAt !== null;
  const given = typeof test.answers[q.id] === 'string' ? (test.answers[q.id] as string) : '';
  const expected = answerOf(card, q.answerWith);
  const set = (v: string) => onChange(answer(test, q.id, v));

  if (done && marks) {
    const right = marks[0].right;
    const overridden = test.overridden.includes(q.id);
    const diff = given.trim() && !right ? computeDiff(given, expected, check) : null;
    return (
      <>
        <Prompt side={SIDE[other(q.answerWith)]} text={promptOf(card, q.answerWith)} />
        <div className="fc-tq__written">
          <div className="fc-verdict__line">
            <span className="fc-verdict__key">you wrote</span>
            <span className="fc-verdict__given">
              {given.trim() ? diff ? <TypedLine parts={diff} /> : given : <span className="rt-ink-faint">nothing</span>}
            </span>
          </div>
          {(!right || overridden) && (
            <div className="fc-verdict__line">
              <span className="fc-verdict__key">answer</span>
              <span className="fc-verdict__answer">{diff ? <AnswerLine parts={diff} /> : expected}</span>
            </div>
          )}
          {!right && given.trim() && (
            <div className="rt-btnrow">
              <button type="button" className="rt-btn rt-btn--sm" onClick={() => onChange(overrideWritten(test, q.id))}>
                I was right
              </button>
            </div>
          )}
          {overridden && <span className="rt-small rt-ink-soft">counted as right</span>}
        </div>
      </>
    );
  }

  return (
    <>
      <Prompt side={SIDE[other(q.answerWith)]} text={promptOf(card, q.answerWith)} />
      <div className="rt-field fc-tq__written">
        <label htmlFor={inputId} className="rt-field__label">
          type the {SIDE[q.answerWith]}
        </label>
        {focused && <SpecialKeys chars={chars} value={given} onChange={set} inputRef={inputRef} />}
        <input
          id={inputId}
          ref={inputRef}
          className="rt-input"
          value={given}
          onChange={(e) => set(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // Enter goes on to the next question, as a paper would.
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            focusNext(e.currentTarget);
          }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
        />
      </div>
    </>
  );
}

/** The next question's first control after `from`, scrolled into view. */
function focusNext(from: HTMLElement) {
  const here = from.closest('[data-question]');
  const all = Array.from(document.querySelectorAll<HTMLElement>('[data-question]'));
  const next = all[all.indexOf(here as HTMLElement) + 1];
  const target = next?.querySelector<HTMLElement>('input:not([disabled])');
  if (target) {
    target.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else from.blur();
}

// --- the score ---

function Results({
  setId,
  test,
  right,
  total,
  percent,
  byKind,
  missed,
  onNew,
  onMissed,
  onSettings,
}: {
  setId: number;
  test: Test;
  right: number;
  total: number;
  percent: number;
  byKind: Map<TestKind, { right: number; total: number }>;
  missed: number[];
  onNew: () => void;
  onMissed: () => void;
  onSettings: () => void;
}) {
  const minutes = Math.max(1, Math.round(((test.finishedAt ?? test.startedAt) - test.startedAt) / 60_000));
  const verdict =
    percent === 100 ? 'every answer right' : percent >= 80 ? 'well done' : percent >= 50 ? 'getting there' : 'keep at it';
  return (
    <div className="fc-panel fc-testscore" role="status">
      <div className="fc-testscore__head">
        <div className={`fc-testscore__ring${percent === 100 ? ' is-full' : ''}`} style={{ ['--p' as string]: percent }}>
          <span>{percent}%</span>
        </div>
        <div>
          <h2 className="fc-panel__title">{verdict}</h2>
          <p className="rt-small rt-ink-soft">
            {right} of {plural(total, 'question')} right · {minutes} min
          </p>
        </div>
      </div>

      <dl className="fc-stats fc-stats--auto">
        {TEST_KINDS.filter((k) => byKind.has(k)).map((k) => {
          const s = byKind.get(k)!;
          return (
            <div key={k}>
              <dt>{KIND_LABEL[k]}</dt>
              <dd className={s.right < s.total ? 'fc-stats__miss' : undefined}>
                {s.right} / {s.total}
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="rt-small rt-ink-soft">Every question is marked below. A written answer marked wrong can still be counted as right.</p>

      <div className="rt-btnrow">
        {missed.length > 0 && (
          <button type="button" className="rt-btn rt-btn--primary" onClick={onMissed} autoFocus>
            test the {plural(missed.length, 'missed card')}
          </button>
        )}
        <button type="button" className={`rt-btn${missed.length === 0 ? ' rt-btn--primary' : ''}`} onClick={onNew}>
          new test
        </button>
        {missed.length > 0 && (
          <Link href={`/flashcards/${setId}/learn`} className="rt-btn">
            study in learn
          </Link>
        )}
        <button type="button" className="rt-linkbtn" onClick={onSettings}>
          change settings
        </button>
      </div>
    </div>
  );
}
