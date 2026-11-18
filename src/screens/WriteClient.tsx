
import Link from '@/components/Link';
import { useCallback, useEffect, useId, useRef, useState, useMemo } from 'react';

import { clearSession, errorMessage, loadSide, loadWrite, rememberSide, saveWrite } from '@/lib/flashcards/client';
import { SwitchSides } from '@/components/flashcards/SwitchSides';
import { plural, promptSizeClass } from '@/lib/flashcards/format';
import { AnswerLine, TypedLine } from '@/components/flashcards/AnswerDiff';
import { computeDiff } from '@/lib/flashcards/diff';
import { useSettings } from '@/lib/app/settings';
import type { SetDTO } from '@/lib/flashcards/types';
import { hintFor } from '@/lib/flashcards/learn';
import {
  advance,
  answerOf,
  cardsAgain,
  currentCard,
  dontKnow,
  isFinished,
  isMatch,
  masteredCount,
  overrideCorrect,
  promptOf,
  roundProgress,
  showHint,
  skipRetype,
  startNextRound,
  startSession,
  submitAnswer,
  submitRetype,
  switchSides,
  type AnswerWith,
  type WriteSession,
} from '@/lib/flashcards/write';
import { specialCharsOf } from '@/lib/flashcards/specialChars';
import { IconCheck, IconClose, IconEnter } from '@/components/flashcards/FlashcardIcons';
import { SetLoadState, useSet } from '@/components/flashcards/useSet';
import { SpecialKeys, keepFocus } from '@/components/flashcards/SpecialKeys';
import { StudyArea, StudyHeader, enterIsForFocus } from '@/components/flashcards/StudyHeader';
import { ResetButton } from '@/components/flashcards/ResetButton';

/** How long "correct" stays up before the next card, unless Enter comes first. */
const CORRECT_PAUSE_MS = 900;
/**
 * An empty Enter on a question means "don't know" — except this soon after
 * the card appears, when it is more likely the Enter that was meant to skip
 * the last card's "correct" pause and landed a moment too late.
 */
const STRAY_ENTER_MS = 400;

const SIDE_NAME: Record<AnswerWith, { prompt: string; answer: string }> = {
  term: { prompt: 'definition', answer: 'term' },
  definition: { prompt: 'term', answer: 'definition' },
};

export function WriteClient({ setId }: { setId: number }) {
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
      <StudyHeader set={set} mode="write" />
      {set.cards.length === 0 ? (
        <div className="rt-empty">
          No cards to study. <Link href={`/flashcards/${set.id}/edit`}>Add some</Link> first.
        </div>
      ) : (
        <StudyArea>
          <WriteMode set={set} />
        </StudyArea>
      )}
    </main>
  );
}

function WriteMode({ set }: { set: SetDTO }) {
  const [answerWith, setAnswerWith] = useState<AnswerWith>('term');
  const [shuffled, setShuffled] = useState(true);
  const [session, setSession] = useState<WriteSession | null>(null);
  const [savedSession, setSavedSession] = useState<WriteSession | null>(null);
  /** The saved round has been read (or found missing); until then nothing starts. */
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The round saved for this set, by this window or the other one. Cards
  // deleted since drop out of it; edited ones show their new text.
  useEffect(() => {
    let live = true;
    setLoaded(false);
    setLoadError(null);
    Promise.all([loadWrite(set.id, set.cards), loadSide(set.id, 'write')])
      .then(([saved, side]) => {
        if (!live) return;
        // A new round starts on the side this set was last studied with.
        if (side) setAnswerWith(side);
        if (saved) {
          setSavedSession(saved);
          setAnswerWith(saved.answerWith);
          setShuffled(saved.shuffled);
          // Carry straight on: the overlay and the main window share this
          // session, so switching between them should not stop at a prompt.
          setSession(saved);
        }
        setLoaded(true);
      })
      .catch((err: unknown) => live && setLoadError(errorMessage(err, 'Could not load the round.')));
    return () => {
      live = false;
    };
  }, [set, attempt]);

  // Kept on every change, without waiting for it.
  useEffect(() => {
    if (!session) return;
    saveWrite(set.id, session);
  }, [session, set.id]);

  function begin() {
    clearSession(set.id, 'write');
    setSavedSession(null);
    rememberSide(set.id, 'write', answerWith);
    setSession(startSession(set.cards, { answerWith, shuffled }));
  }

  const onSwitchSides = useCallback(() => {
    if (!session) return;
    const next = switchSides(session);
    if (next === session) return;
    setSession(next);
    setAnswerWith(next.answerWith);
    rememberSide(set.id, 'write', next.answerWith);
  }, [session, set.id]);

  function resumeSaved() {
    if (savedSession) {
      setSession(savedSession);
    }
  }

  if (loadError) {
    return (
      <div className="rt-section">
        <div className="rt-note rt-note--err">{loadError}</div>
        <div className="rt-btnrow" style={{ marginTop: 16 }}>
          <button type="button" className="rt-btn" onClick={() => setAttempt((n) => n + 1)}>
            try again
          </button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="fc-loading" aria-busy="true" aria-label="Loading the round">
        <div className="fc-skel" style={{ height: 220 }} />
      </div>
    );
  }

  if (!session) {
    return (
      <Setup
        count={set.cards.length}
        answerWith={answerWith}
        shuffled={shuffled}
        onAnswerWith={setAnswerWith}
        onShuffled={setShuffled}
        savedSession={savedSession}
        onResumeSaved={resumeSaved}
        onStart={begin}
      />
    );
  }

  if (session.step.kind === 'summary') {
    return (
      <Summary
        session={session}
        setId={set.id}
        onNextRound={() => setSession(startNextRound(session))}
        onRestart={begin}
        onSettings={() => {
          clearSession(set.id, 'write');
          setSavedSession(null);
          setSession(null);
        }}
      />
    );
  }

  return (
    <Play
      session={session}
      setSession={setSession}
      onSwitchSides={onSwitchSides}
      onReset={() => {
        // Back to the setup screen, so a fresh round asks again which side to
        // answer with (it starts on the one last used).
        clearSession(set.id, 'write');
        setSavedSession(null);
        setSession(null);
      }}
    />
  );
}

// --- setup ---

function Setup(props: {
  count: number;
  answerWith: AnswerWith;
  shuffled: boolean;
  onAnswerWith: (value: AnswerWith) => void;
  onShuffled: (value: boolean) => void;
  savedSession: WriteSession | null;
  onResumeSaved: () => void;
  onStart: () => void;
}) {
  const uid = useId();
  const saved = props.savedSession;
  const options: { value: AnswerWith; title: string; sub: string }[] = [
    { value: 'term', title: 'term', sub: 'See the definition, type the term.' },
    {
      value: 'definition',
      title: 'definition',
      sub: 'See the term, type the definition.',
    },
  ];

  return (
    <form
      className="fc-panel fc-setup"
      onSubmit={(e) => {
        e.preventDefault();
        props.onStart();
      }}
    >
      {saved && (
        <div className="fc-resume-banner">
          <span className="fc-resume-banner__text">
            You have an unfinished write session
            {` · Round ${saved.round}, ${roundProgress(saved).remaining} cards left`}
          </span>
          <button
            type="button"
            className="rt-btn rt-btn--primary rt-btn--sm"
            onClick={props.onResumeSaved}
            autoFocus
          >
            resume
          </button>
        </div>
      )}

      <fieldset className="fc-fieldset">
        <legend className="rt-field__label">answer with</legend>
        <div className="fc-options">
          {options.map((option) => (
            <label
              key={option.value}
              className={`fc-option${props.answerWith === option.value ? ' is-active' : ''}`}
            >
              <input
                type="radio"
                name={`${uid}-answer`}
                className="fc-option__input"
                checked={props.answerWith === option.value}
                onChange={() => props.onAnswerWith(option.value)}
              />
              <span className="fc-option__title">{option.title}</span>
              <span className="fc-option__sub">{option.sub}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="fc-check">
        <input
          type="checkbox"
          checked={props.shuffled}
          onChange={(e) => props.onShuffled(e.target.checked)}
        />
        Shuffle cards each round
      </label>

      <p className="rt-small fc-setup__rules">
        Miss a card and the answer is shown — type it out to move on, or skip. Missed cards come
        back in another round, until every card has been answered right. The hint shows each
        word&apos;s first letter; a card answered with it comes back too.
      </p>

      <div className="rt-btnrow">
        <button type="submit" className="rt-btn rt-btn--primary" autoFocus={!saved}>
          start · {plural(props.count, 'card')}
        </button>
      </div>
    </form>
  );
}

// --- a card being asked ---

function Play({
  session,
  setSession,
  onSwitchSides,
  onReset,
}: {
  session: WriteSession;
  setSession: React.Dispatch<React.SetStateAction<WriteSession | null>>;
  /** Answer with the other side from this card on. */
  onSwitchSides: () => void;
  /** Write over from round 1, same settings. */
  onReset: () => void;
}) {
  const [text, setText] = useState('');
  const [retypeWrong, setRetypeWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const check = useSettings().settings?.answerCheck ?? 'exact';

  const card = currentCard(session);
  const { step } = session;
  const progress = roundProgress(session);
  const mastered = masteredCount(session);
  const total = session.cards.length;
  const sides = SIDE_NAME[session.answerWith];

  // Each new card, and each change of step on a card, starts with an empty box
  // and the caret in it. The box stays mounted and focused through "correct" —
  // Enter there skips the pause — so a phone's keyboard does not close and then
  // fail to reopen for the next card.
  const shownAt = useRef(0);
  useEffect(() => {
    setText('');
    setRetypeWrong(false);
    shownAt.current = performance.now();
    inputRef.current?.focus();
  }, [session.round, session.index, step.kind]);

  useEffect(() => {
    if (step.kind !== 'correct') return;
    const timer = setTimeout(() => setSession((s) => (s ? advance(s) : s)), CORRECT_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [step, setSession]);

  // Derive expected here (before hooks & early return) so useMemo can depend on it.
  const expected = card ? answerOf(card, session.answerWith) : '';
  // The whole set's characters, so the same buttons are there on every question,
  // not just the ones the current card needs.
  const specialChars = useMemo(
    () => specialCharsOf(session.cards, session.answerWith),
    [session.cards, session.answerWith],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (enterIsForFocus()) return;
      if (step.kind === 'correct') {
        e.preventDefault();
        setSession((s) => (s ? advance(s) : s));
      } else if (step.kind === 'reveal') {
        if (document.activeElement !== inputRef.current) {
          e.preventDefault();
          if (!text.trim()) {
            setSession(skipRetype(session));
          } else if (isMatch(text, expected, check)) {
            setSession(submitRetype(session, text, check));
          } else {
            setRetypeWrong(true);
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step.kind, text, expected, session, setSession, check]);

  if (!card) return null;
  const diff = step.kind === 'reveal' && step.given !== null ? computeDiff(step.given, expected, check) : null;
  // The box is only kept for the keyboard's sake while the verdict shows.
  const locked = step.kind === 'correct';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind === 'correct') {
      setSession((s) => (s ? advance(s) : s));
    } else if (step.kind === 'ask') {
      setSession(submitAnswer(session, text, check));
    } else if (step.kind === 'reveal') {
      if (!text.trim()) {
        setSession(skipRetype(session));
      } else if (isMatch(text, expected, check)) {
        setSession(submitRetype(session, text, check));
      } else {
        setRetypeWrong(true);
      }
    }
  }

  return (
    <div className="fc-write">
      <div className="fc-writebar">
        <span className="fc-writebar__round">round {session.round}</span>
        <span className="fc-writebar__stat fc-writebar__stat--ok" title="Correct this round">
          <IconCheck size={14} />
          {progress.correct}
        </span>
        <span className="fc-writebar__stat fc-writebar__stat--miss" title="Missed this round">
          <IconClose size={14} />
          {progress.missed}
        </span>
        <span className="fc-writebar__stat">{progress.remaining} left</span>
        <SwitchSides answerWith={session.answerWith} enabled={step.kind === 'ask'} onSwitch={onSwitchSides} />
        <ResetButton
          question="reset write?"
          title="Start Write over: back to the start screen to pick the side, every card asked again, scores cleared"
          onReset={onReset}
        />
      </div>

      <div className="fc-progress">
        <span className="fc-progress__count">
          {mastered} / {total} mastered
        </span>
        <div className="fc-meter" aria-hidden="true">
          <span className="fc-meter__fill" style={{ width: `${(mastered / total) * 100}%` }} />
        </div>
      </div>

      <div className="fc-prompt">
        <span className="fc-flip__side">{sides.prompt}</span>
        <div className={`fc-prompt__text${promptSizeClass(promptOf(card, session.answerWith))}`}>
          {promptOf(card, session.answerWith)}
        </div>
      </div>

      {step.kind === 'correct' && (
        <div className="fc-verdict fc-verdict--ok" role="status">
          <div className="fc-verdict__title">
            {step.overridden ? 'counted as correct' : 'correct'}
            {step.hinted ? ', with the hint' : ''}
          </div>
          <div className="fc-verdict__answer">{expected}</div>
          {step.hinted && <div className="rt-small rt-ink-soft">It comes back next round, to answer without it.</div>}
          <div className="rt-btnrow">
            <button
              type="button"
              className="rt-btn rt-btn--sm"
              onMouseDown={keepFocus}
              onClick={() => setSession(advance(session))}
            >
              Continue
              <IconEnter />
            </button>
          </div>
        </div>
      )}

      {step.kind === 'reveal' && (
        <div className="fc-verdict fc-verdict--miss" role="alert">
          <div className="fc-verdict__title">
            {step.given === null ? "don't know" : 'incorrect'}
          </div>
          {step.given !== null && diff && (
            <div className="fc-verdict__line">
              <span className="fc-verdict__key">you said</span>
              <span className="fc-verdict__given">
                <TypedLine parts={diff} />
              </span>
            </div>
          )}
          <div className="fc-verdict__line">
            <span className="fc-verdict__key">correct</span>
            <span className="fc-verdict__answer">
              {diff ? (
                <AnswerLine parts={diff} />
              ) : expected}
            </span>
          </div>
          <div className="rt-btnrow">
            <button
              type="button"
              className="rt-btn rt-btn--sm"
              onClick={() => setSession(overrideCorrect(session))}
            >
              I was correct
            </button>
          </div>
        </div>
      )}

      {/* Rendered on "correct" too, so the input keeps focus (and the phone keyboard stays up). */}
      <form className="fc-answer" onSubmit={submit}>
        {/* Not a wrapping <label>: it would adopt the first special-key button as its control. */}
        <div className="rt-field">
          <label htmlFor={inputId} className="rt-field__label">
            {step.kind === 'reveal'
              ? `type the correct ${sides.answer} to continue`
              : `type the ${sides.answer}`}
          </label>
          <SpecialKeys
            chars={specialChars}
            value={text}
            onChange={(value) => {
              if (locked) return;
              setText(value);
              setRetypeWrong(false);
            }}
            inputRef={inputRef}
          />
          <input
            id={inputId}
            ref={inputRef}
            className={`rt-input fc-answer__input${retypeWrong ? ' is-wrong' : ''}`}
            value={locked ? '' : text}
            onChange={(e) => {
              if (locked) return;
              setText(e.target.value);
              setRetypeWrong(false);
            }}
            // The "answer" button is disabled while the box is empty, which
            // also stops Enter submitting the form, so an empty Enter is
            // handled here: it is the keyboard's "don't know".
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || step.kind !== 'ask' || text.trim()) return;
              if (e.repeat || e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (performance.now() - shownAt.current < STRAY_ENTER_MS) return;
              setSession(dontKnow(session));
            }}
            // Copying the answer off the screen is not retyping it.
            onPaste={step.kind === 'reveal' ? (e) => e.preventDefault() : undefined}
            onDrop={step.kind === 'reveal' ? (e) => e.preventDefault() : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
          />
        </div>
        {step.kind === 'ask' && step.hinted && (
          <div className="fc-verdict__line fc-learn__hint" aria-live="polite">
            <span className="fc-verdict__key">hint</span>
            <span className="fc-learn__hinttext">{hintFor(expected)}</span>
          </div>
        )}
        {retypeWrong && (
          <div className="fc-answer__hint" role="alert">
            Not quite — type it exactly as shown.
          </div>
        )}
        {!locked && (
          <div className="rt-btnrow">
            <button
              type="submit"
              className="rt-btn rt-btn--primary"
              disabled={step.kind !== 'reveal' && !text.trim()}
              onMouseDown={keepFocus}
            >
              {step.kind === 'reveal' ? (
                <>
                  {text.trim() ? 'check' : 'continue'}
                  <IconEnter />
                </>
              ) : (
                'answer'
              )}
            </button>
            {step.kind === 'ask' && !step.hinted && (
              <button
                type="button"
                className="rt-btn"
                title="Show each word's first letter. A card answered with the hint comes back next round."
                onMouseDown={keepFocus}
                onClick={() => {
                  setSession(showHint(session));
                  inputRef.current?.focus();
                }}
              >
                hint
              </button>
            )}
            {step.kind === 'ask' ? (
              <button
                type="button"
                className="rt-btn"
                onMouseDown={keepFocus}
                onClick={() => setSession(dontKnow(session))}
              >
                don&apos;t know
              </button>
            ) : (
              <button
                type="button"
                className="rt-btn"
                title="Move on without typing it out. The card still comes back next round."
                onMouseDown={keepFocus}
                onClick={() => setSession(skipRetype(session))}
              >
                skip
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

// --- end of a round ---

function Summary({
  session,
  setId,
  onNextRound,
  onRestart,
  onSettings,
}: {
  session: WriteSession;
  setId: number;
  onNextRound: () => void;
  onRestart: () => void;
  onSettings: () => void;
}) {
  const round = session.rounds[session.rounds.length - 1];
  const finished = isFinished(session);
  const mastered = masteredCount(session);
  const total = session.cards.length;
  const again = cardsAgain(session).length;
  const anyHinted = session.rounds.some((r) => r.hinted > 0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && !enterIsForFocus()) {
        e.preventDefault();
        if (finished) onRestart();
        else onNextRound();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finished, onRestart, onNextRound]);

  return (
    <div className="fc-panel fc-summary" role="status">
      <h2 className="fc-panel__title">
        {finished ? 'all cards mastered' : `round ${round.round} done`}
      </h2>

      <dl className="fc-stats">
        <div>
          <dt>cards</dt>
          <dd>{round.total}</dd>
        </div>
        <div>
          <dt>missed</dt>
          <dd className={round.missed > 0 ? 'fc-stats__miss' : undefined}>{round.missed}</dd>
        </div>
        {round.hinted > 0 && (
          <div>
            <dt>with hint</dt>
            <dd>{round.hinted}</dd>
          </div>
        )}
        <div>
          <dt>accuracy</dt>
          <dd>{round.accuracy}%</dd>
        </div>
      </dl>

      <div className="fc-progress">
        <span className="fc-progress__count">
          {mastered} / {total} mastered
        </span>
        <div className="fc-meter" aria-hidden="true">
          <span className="fc-meter__fill" style={{ width: `${(mastered / total) * 100}%` }} />
        </div>
      </div>

      {finished && session.rounds.length > 1 && (
        <table className="rt-table fc-rounds">
          <thead>
            <tr>
              <th scope="col">round</th>
              <th scope="col">cards</th>
              <th scope="col">missed</th>
              {anyHinted && <th scope="col">with hint</th>}
              <th scope="col">accuracy</th>
            </tr>
          </thead>
          <tbody>
            {session.rounds.map((r) => (
              <tr key={r.round}>
                <td>{r.round}</td>
                <td>{r.total}</td>
                <td>{r.missed}</td>
                {anyHinted && <td>{r.hinted}</td>}
                <td>{r.accuracy}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="rt-btnrow">
        {!finished && (
          <button type="button" className="rt-btn rt-btn--primary" onClick={onNextRound} autoFocus>
            round {round.round + 1}:{' '}
            {round.hinted > 0 ? plural(again, 'card') : plural(session.missed.length, 'missed card')}
          </button>
        )}
        <button
          type="button"
          className={`rt-btn${finished ? ' rt-btn--primary' : ''}`}
          onClick={onRestart}
          autoFocus={finished}
        >
          restart
        </button>
        <Link href={`/flashcards/${setId}/cards`} className="rt-btn">
          switch to flashcards
        </Link>
        <button type="button" className="rt-linkbtn" onClick={onSettings}>
          change settings
        </button>
      </div>
    </div>
  );
}
