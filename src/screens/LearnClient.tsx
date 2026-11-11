
import Link from '@/components/Link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { errorMessage, fetchLearnQueue, fetchLearnStats, reviewCard } from '@/lib/flashcards/client';
import { computeDiff } from '@/lib/flashcards/diff';
import { MIN_CARDS_FOR_CHOICE } from '@/lib/flashcards/distractors';
import { plural } from '@/lib/flashcards/format';
import {
  advance,
  answerChoice,
  answerWritten,
  currentCard,
  currentTurn,
  endSession,
  giveUp,
  hintFor,
  markKnewIt,
  markWrong,
  overrideCorrect,
  pendingQuality,
  QUALITY_LABEL,
  resume,
  resumeCheckpoint,
  sessionOrder,
  showHint,
  startLearn,
  summarize,
  type LearnSession,
} from '@/lib/flashcards/learn';
import type { Quality } from '@/lib/flashcards/sm2';
import { specialCharsOf } from '@/lib/flashcards/specialChars';
import type { LearnCardDTO, LearnStatsDTO, ProgressDTO, SetDTO } from '@/lib/flashcards/types';
import { promptSizeClass } from '@/lib/flashcards/format';
import { answerOf, isMatch, promptOf, type AnswerWith } from '@/lib/flashcards/write';
import { todayKey } from '@/lib/nutrition/day';
import { IconCheck, IconClose, IconEnter } from '@/components/flashcards/FlashcardIcons';
import { SetLoadState, useSet } from '@/components/flashcards/useSet';
import { SpecialKeys, keepFocus } from '@/components/flashcards/SpecialKeys';
import { StudyHeader } from '@/components/flashcards/StudyHeader';

/** How long "correct" stays up before the next card, unless Enter comes first. */
const CORRECT_PAUSE_MS = 900;
/**
 * An empty Enter on a typed question means "no idea" — except this soon after
 * the card appears, when it is more likely the Enter that was meant to skip
 * the last card's "correct" pause and landed a moment too late.
 */
const STRAY_ENTER_MS = 400;

const SIDE_NAME: Record<AnswerWith, { prompt: string; answer: string }> = {
  term: { prompt: 'definition', answer: 'term' },
  definition: { prompt: 'term', answer: 'definition' },
};

export function LearnClient({ setId }: { setId: number }) {
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
      <StudyHeader set={set} mode="learn" />
      {set.cards.length === 0 ? (
        <div className="rt-empty">
          No cards to study. <Link href={`/flashcards/${set.id}/edit`}>Add some</Link> first.
        </div>
      ) : (
        <LearnMode set={set} />
      )}
    </main>
  );
}

type Today = { queue: LearnCardDTO[]; stats: LearnStatsDTO };

/**
 * Each card's streak (repetitionNumber) as last seen from the server, null
 * for a card never reviewed. Sent with every review so a retried request is
 * not counted twice; see applyReview in sm2.ts.
 */
type Streaks = Map<number, number | null>;

// --- session persistence ---

/** localStorage key for a set's in-progress session. */
function sessionStorageKey(setId: number) {
  return `fc-session-${setId}`;
}

/**
 * Sessions used to be kept per day (`fc-session-<set>-<YYYY-MM-DD>`). A day's
 * unfinished session is still a session: the newest one becomes the set's,
 * and the dated keys are cleared.
 */
function migrateDatedSessions(setId: number) {
  try {
    const prefix = `${sessionStorageKey(setId)}-`;
    const dated = Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(key.slice(prefix.length)))
      .sort();
    if (dated.length === 0) return;
    const newest = localStorage.getItem(dated[dated.length - 1]);
    if (newest && localStorage.getItem(sessionStorageKey(setId)) === null) {
      localStorage.setItem(sessionStorageKey(setId), newest);
    }
    for (const key of dated) localStorage.removeItem(key);
  } catch {
    // localStorage can be unavailable (private mode, quota, etc.) — silently ignore.
  }
}

function saveSessionToStorage(setId: number, session: LearnSession) {
  try {
    // Never persist a summary step — that means the session is finished.
    if (session.step.kind === 'summary') {
      localStorage.removeItem(sessionStorageKey(setId));
    } else {
      localStorage.setItem(sessionStorageKey(setId), JSON.stringify(session));
    }
  } catch {
    // localStorage can be unavailable (private mode, quota, etc.) — silently ignore.
  }
}

function loadSessionFromStorage(setId: number): LearnSession | null {
  try {
    migrateDatedSessions(setId);
    const raw = localStorage.getItem(sessionStorageKey(setId));
    if (!raw) return null;
    return JSON.parse(raw) as LearnSession;
  } catch {
    return null;
  }
}

function clearSessionFromStorage(setId: number) {
  try {
    localStorage.removeItem(sessionStorageKey(setId));
  } catch {
    // ignore
  }
}

function LearnMode({ set }: { set: SetDTO }) {
  const [today, setToday] = useState<Today | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answerWith, setAnswerWith] = useState<AnswerWith>('term');
  const [session, setSession] = useState<LearnSession | null>(null);
  const [endStats, setEndStats] = useState<LearnStatsDTO | 'error' | null>(null);
  /** A saved session from a previous page visit, offered as a resume option. */
  const [savedSession, setSavedSession] = useState<LearnSession | null>(null);
  // Fresh from the server on every load, so a resumed session saved before a
  // reload still sends the streaks the server has now.
  const streaks = useRef<Streaks>(new Map());

  const load = useCallback(() => {
    let live = true;
    setToday(null);
    setLoadError(null);
    setSession(null);
    setSavedSession(null);
    Promise.all([fetchLearnQueue(set.id), fetchLearnStats(set.id)])
      .then(([queue, stats]) => {
        if (!live) return;
        streaks.current = new Map(
          queue.cards.map((card) => [card.id, card.progress?.repetitionNumber ?? null]),
        );
        setToday({ queue: queue.cards, stats: stats.stats });
        // Check for a saved in-progress session.
        const saved = loadSessionFromStorage(set.id);
        if (saved && saved.step.kind !== 'summary') {
          setSavedSession(saved);
          // Carry straight on: the overlay and the main window share this
          // session, so switching between them should not stop at a prompt.
          setSession(saved);
        }
      })
      .catch((err: unknown) => {
        if (live) setLoadError(errorMessage(err, 'Could not load the cards.'));
      });
    return () => {
      live = false;
    };
  }, [set.id]);

  useEffect(() => load(), [load]);

  // Persist session to localStorage on every change.
  useEffect(() => {
    if (!session || !today) return;
    saveSessionToStorage(set.id, session);
  }, [session, set.id, today]);

  // The summary's learned count has to come from the server: the reviews just
  // saved have moved it.
  const onSummary = session?.step.kind === 'summary';
  useEffect(() => {
    if (!onSummary) return;
    let live = true;
    setEndStats(null);
    fetchLearnStats(set.id)
      .then((res) => live && setEndStats(res.stats))
      .catch(() => live && setEndStats('error'));
    return () => {
      live = false;
    };
  }, [onSummary, set.id]);

  if (loadError) {
    return (
      <div className="rt-section">
        <div className="rt-note rt-note--err">{loadError}</div>
        <div className="rt-btnrow" style={{ marginTop: 16 }}>
          <button type="button" className="rt-btn" onClick={load}>
            try again
          </button>
        </div>
      </div>
    );
  }

  if (!today) {
    return (
      <div className="fc-loading" aria-busy="true" aria-label="Loading the cards">
        <div className="fc-skel" style={{ height: 220 }} />
      </div>
    );
  }

  if (!session) {
    return (
      <Setup
        set={set}
        today={today}
        answerWith={answerWith}
        onAnswerWith={setAnswerWith}
        savedSession={savedSession}
        onResumeSaved={() => {
          if (savedSession) setSession(savedSession);
        }}
        onStart={() => {
          clearSessionFromStorage(set.id);
          setSession(startLearn(sessionOrder(today.queue), set.cards, answerWith));
        }}
      />
    );
  }

  if (session.step.kind === 'summary') {
    return (
      <Summary
        session={session}
        setId={set.id}
        stats={endStats}
        onResume={() => setSession(resume(session))}
        onRestart={load}
      />
    );
  }

  if (session.step.kind === 'checkpoint') {
    return (
      <Checkpoint
        session={session}
        onContinue={() => setSession((s) => (s ? resumeCheckpoint(s) : s))}
      />
    );
  }

  return (
    <Play session={session} setSession={setSession} streaks={streaks} key={session.index} />
  );
}

// --- setup ---

function Setup(props: {
  set: SetDTO;
  today: Today;
  answerWith: AnswerWith;
  onAnswerWith: (value: AnswerWith) => void;
  savedSession: LearnSession | null;
  onResumeSaved: () => void;
  onStart: () => void;
}) {
  const uid = useId();
  const { set, today } = props;
  const { stats } = today;
  const count = today.queue.length;
  const options: { value: AnswerWith; title: string; sub: string }[] = [
    { value: 'term', title: 'term', sub: 'See the definition, answer with the term.' },
    { value: 'definition', title: 'definition', sub: 'See the term, answer with the definition.' },
  ];

  const saved = props.savedSession;

  return (
    <form
      className="fc-panel fc-setup"
      onSubmit={(e) => {
        e.preventDefault();
        if (count > 0) props.onStart();
      }}
    >
      {saved && (
        <div className="fc-resume-banner">
          <span className="fc-resume-banner__text">
            You have an unfinished session
            {saved.step.kind !== 'ask' ? '' : ` · ${summarize(saved).remaining} cards left`}.
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

      <dl className="fc-stats">
        <div>
          <dt>new</dt>
          <dd>{stats.new}</dd>
        </div>
        <div>
          <dt>learning</dt>
          <dd>{stats.learning}</dd>
        </div>
        <div>
          <dt>learned</dt>
          <dd>{stats.learned}</dd>
        </div>
      </dl>
      <LearnedMeter stats={stats} />

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

      <p className="rt-small fc-setup__rules">
        {set.cards.length < MIN_CARDS_FOR_CHOICE
          ? `With fewer than ${MIN_CARDS_FOR_CHOICE} cards in the set, every answer is typed.`
          : 'New cards are mostly multiple choice, with the odd typed one; once you have got a card right, you type it.'}{' '}
        Miss a typed one and the answer is shown — type it out to move on, or skip. A miss comes
        back a few questions later until you get it. A card is learned once you have got it right
        twice in a row; a miss starts it over.
      </p>

      <div className="rt-btnrow">
        <button type="submit" className="rt-btn rt-btn--primary" autoFocus={!saved}>
          start · {plural(count, 'card')}
        </button>
      </div>
    </form>
  );
}

function LearnedMeter({ stats }: { stats: LearnStatsDTO }) {
  const share = stats.total === 0 ? 0 : stats.learned / stats.total;
  return (
    <div className="fc-progress">
      <span className="fc-progress__count">
        {stats.learned} / {stats.total} learned
      </span>
      <div className="fc-meter" aria-hidden="true">
        <span className="fc-meter__fill" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

// --- a card being asked ---

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'error'; message: string };

function Play({
  session,
  setSession,
  streaks,
}: {
  session: LearnSession;
  setSession: React.Dispatch<React.SetStateAction<LearnSession | null>>;
  streaks: React.RefObject<Streaks>;
}) {
  const [text, setText] = useState('');
  const [retypeWrong, setRetypeWrong] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  // Set by a button that means "and move on": the move waits for the save.
  const [advanceWhenSaved, setAdvanceWhenSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const continueRef = useRef<HTMLButtonElement>(null);
  const elapsed = useAnswerClock(session.index, session.step.kind === 'ask');

  const turn = currentTurn(session);
  const card = turn?.card ?? null;
  const { step, question, answerWith } = session;
  const expected = card ? answerOf(card, answerWith) : '';
  const sides = SIDE_NAME[answerWith];
  const { cards, right, missed, mastered, remaining } = summarize(session);
  // The whole set's characters, not just today's cards', so the buttons do not
  // change from one session to the next.
  const specialChars = useMemo(
    () => specialCharsOf(session.pool, answerWith),
    [session.pool, answerWith],
  );

  // Each new card, and each change of step on a card, starts with an empty box
  // and the caret in it. A typed question keeps the box mounted and focused
  // through its verdict — Enter there continues after a right answer, and
  // submits the retype after a miss — so a phone's keyboard does not close and
  // then fail to reopen for the next card; a multiple-choice answer puts focus
  // on the button Enter should press.
  //
  // When neither ref exists (e.g. a fresh choice question), blur any currently
  // focused element so no choice button inherits :focus-visible from the
  // previous selection — which would make it look like that option is still
  // highlighted on the new card.
  useEffect(() => {
    setText('');
    setRetypeWrong(false);
    const target = inputRef.current ?? continueRef.current;
    if (target) target.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }, [session.index, step.kind]);

  const goNext = useCallback(() => {
    setSave({ status: 'idle' });
    setAdvanceWhenSaved(false);
    // advance() refuses a card without a grade, so a second call — the pause
    // timer racing a click on continue — is a no-op rather than a skipped card.
    setSession((s) => (s ? advance(s) : s));
  }, [setSession]);

  useEffect(() => {
    if (save.status !== 'saved') return;
    if (advanceWhenSaved) {
      goNext();
      return;
    }
    if (step.kind !== 'correct') return;
    const timer = setTimeout(goNext, CORRECT_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [save.status, advanceWhenSaved, step.kind, goNext]);

  const persist = useCallback(async (cardId: number, quality: Quality) => {
    setSave({ status: 'saving' });
    try {
      // Safe to retry: `seen` stops the server counting the same answer twice.
      const seen = streaks.current.get(cardId) ?? null;
      const { progress } = await reviewCard(cardId, quality, todayKey(), seen);
      streaks.current.set(cardId, progress.repetitionNumber);
      setSave({ status: 'saved' });
    } catch (err) {
      setSave({ status: 'error', message: errorMessage(err, 'Could not save this answer.') });
    }
  }, [streaks]);

  /** Apply a move; if it settled the card's grade, save it straight away. */
  const apply = useCallback(
    (next: LearnSession, thenAdvance = false) => {
      if (next === session) return;
      setSession(next);
      const quality = pendingQuality(next);
      const answered = currentCard(next);
      if (quality === null || !answered || pendingQuality(session) !== null) return;
      setAdvanceWhenSaved(thenAdvance);
      void persist(answered.id, quality);
    },
    [session, setSession, persist],
  );

  const choose = useCallback(
    (optionId: number) => apply(answerChoice(session, optionId, elapsed())),
    [apply, session, elapsed],
  );

  // 1–4 picks an option.
  useEffect(() => {
    if (step.kind !== 'ask' || question?.kind !== 'choice') return;
    const options = question.options;
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > options.length) return;
      e.preventDefault();
      choose(options[n - 1].id);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step.kind, question, choose]);

  const onContinue = useCallback(() => {
    if (save.status === 'saved' || save.status === 'idle') goNext();
    else if (save.status === 'saving') setAdvanceWhenSaved(true);
  }, [save.status, goNext]);

  const leaveMiss = useCallback(() => {
    if (pendingQuality(session) === null) apply(markWrong(session), true);
    else onContinue();
  }, [apply, session, onContinue]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (step.kind === 'correct') {
        e.preventDefault();
        onContinue();
      } else if (step.kind === 'miss') {
        if (document.activeElement !== inputRef.current) {
          e.preventDefault();
          if (!text.trim() || isMatch(text, expected)) {
            leaveMiss();
          } else {
            setRetypeWrong(true);
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step.kind, onContinue, leaveMiss, text, expected]);

  if (!turn || !card || !question) return null;
  const diff = step.kind === 'miss' && step.given !== null && question.kind === 'written' ? computeDiff(step.given, expected) : null;
  // The box is only kept for the keyboard's sake while "correct" shows.
  const locked = step.kind === 'correct';
  // On the way off a miss: waiting for the save, or stuck until it is retried.
  const leaving = advanceWhenSaved || save.status === 'error';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind === 'correct') {
      onContinue();
    } else if (step.kind === 'ask') {
      apply(answerWritten(session, text, elapsed()));
    } else if (step.kind === 'miss') {
      if (!text.trim()) {
        leaveMiss();
      } else if (isMatch(text, expected)) {
        leaveMiss();
      } else {
        setRetypeWrong(true);
      }
    }
  }

  const quality = pendingQuality(session);
  const saveLine = quality !== null && (
    <SaveLine
      save={save}
      quality={quality}
      onRetry={() => {
        if (save.status === 'error') void persist(card.id, quality);
      }}
    />
  );

  return (
    <div className="fc-write">
      <div className="fc-writebar">
        <span className="fc-writebar__round">
          {turn.retry
            ? 'again'
            : (session.credits?.[card.id] ?? 0) >= 1
            ? 'mastery'
            : STATUS_LABEL[card.status]}
        </span>
        <span className="fc-writebar__stat fc-writebar__stat--ok" title="Mastered (typed right twice)">
          <IconCheck size={14} />
          {mastered}
        </span>
        <span
          className="fc-writebar__stat fc-writebar__stat--miss"
          title="Missed: asked again later in this session"
        >
          <IconClose size={14} />
          {missed}
        </span>
        <span className="fc-writebar__stat">{remaining} to master</span>
        {step.kind === 'ask' && (
          <button
            type="button"
            className="rt-linkbtn fc-writebar__stat"
            onClick={() => setSession(endSession(session))}
          >
            stop
          </button>
        )}
      </div>

      <div className="fc-progress">
        <span className="fc-progress__count">
          {mastered} / {cards} mastered
        </span>
        <div className="fc-meter" aria-hidden="true">
          <span className="fc-meter__fill" style={{ width: `${cards > 0 ? (mastered / cards) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="fc-prompt">
        <span className="fc-flip__side">{sides.prompt}</span>
        <div className={`fc-prompt__text${promptSizeClass(promptOf(card, answerWith))}`}>{promptOf(card, answerWith)}</div>
      </div>

      {question.kind === 'choice' && (
        <>
          <ol className="fc-choices" aria-label={`Pick the ${sides.answer}`}>
            {question.options.map((option, i) => {
              const optionText = answerOf(option, answerWith);
              let state = '';
              if (step.kind === 'correct' || step.kind === 'miss') {
                if (option.id === card.id) state = ' is-correct';
                else if (step.given === optionText) state = ' is-wrong';
                else state = ' is-dim';
              }
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    className={`fc-choice${state}`}
                    disabled={step.kind !== 'ask'}
                    onClick={() => choose(option.id)}
                  >
                    <span className="fc-choice__key" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="fc-choice__text">{optionText}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {step.kind === 'ask' && (
            <div className="rt-btnrow fc-learn__actions">
              <button type="button" className="rt-btn" onClick={() => apply(giveUp(session))}>
                no idea
              </button>
              <span className="rt-small fc-keys__keys">or press 1–{question.options.length}</span>
            </div>
          )}
        </>
      )}

      {step.kind === 'correct' && (
        <div className="fc-verdict fc-verdict--ok" role="status">
          <div className="fc-verdict__title">
            {step.overridden ? 'counted as correct' : 'correct'}
          </div>
          {question.kind === 'written' && <div className="fc-verdict__answer">{expected}</div>}
          {saveLine}
          <div className="rt-btnrow">
            <button
              ref={continueRef}
              type="button"
              className="rt-btn rt-btn--sm"
              onMouseDown={keepFocus}
              onClick={onContinue}
              disabled={save.status === 'error'}
            >
              Continue
              <IconEnter />
            </button>
          </div>
        </div>
      )}

      {step.kind === 'miss' && (
        <div className="fc-verdict fc-verdict--miss" role="alert">
          <div className="fc-verdict__title">{step.given === null ? 'no idea' : 'incorrect'}</div>
          {step.given !== null && question.kind === 'written' && diff && (
            <div className="fc-verdict__line">
              <span className="fc-verdict__key">you said</span>
              <span className="fc-verdict__given">
                {diff.filter(p => !p.added).map((p, i) => (
                  <span key={i} className={p.removed ? 'fc-diff-rem' : ''}>{p.value}</span>
                ))}
              </span>
            </div>
          )}
          {step.given !== null && question.kind === 'written' && !diff && (
            <div className="fc-verdict__line">
              <span className="fc-verdict__key">you said</span>
              <s className="fc-verdict__given">{step.given}</s>
            </div>
          )}
          <div className="fc-verdict__line">
            <span className="fc-verdict__key">correct</span>
            <span className="fc-verdict__answer">
              {diff ? (
                diff.filter(p => !p.removed).map((p, i) => (
                  <span key={i} className={p.added ? 'fc-diff-add' : ''}>{p.value}</span>
                ))
              ) : expected}
            </span>
          </div>

          {/* A typed question moves on through the retype box below instead. */}
          {step.quality === null ? (
            <div className="rt-btnrow">
              {question.kind === 'choice' && (
                <button
                  ref={continueRef}
                  type="button"
                  className="rt-btn rt-btn--sm rt-btn--primary"
                  onClick={() => apply(markWrong(session), true)}
                >
                  Continue
                  <IconEnter />
                </button>
              )}
              <button
                type="button"
                className="rt-btn rt-btn--sm"
                onMouseDown={question.kind === 'written' ? keepFocus : undefined}
                onClick={() => apply(overrideCorrect(session))}
              >
                I was correct
              </button>
            </div>
          ) : (
            <>
              {saveLine}
              {question.kind === 'choice' && (
                <div className="rt-btnrow">
                  <button
                    ref={continueRef}
                    type="button"
                    className="rt-btn rt-btn--sm"
                    onClick={onContinue}
                    disabled={save.status === 'error' || advanceWhenSaved}
                  >
                    {advanceWhenSaved ? (
                      'saving…'
                    ) : (
                      <>
                        Continue
                        <IconEnter />
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Rendered on "correct" too, so the input keeps focus (and the phone keyboard stays up). */}
      {question.kind === 'written' && (
        <form className="fc-answer" onSubmit={submit}>
          {/* Not a wrapping <label>: it would adopt the first special-key button as its control. */}
          <div className="rt-field">
            <label htmlFor={inputId} className="rt-field__label">
              {step.kind === 'miss'
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
              // handled here: it is the keyboard's "no idea".
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || step.kind !== 'ask' || text.trim()) return;
                if (e.repeat || e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (elapsed() < STRAY_ENTER_MS) return;
                apply(giveUp(session));
              }}
              // Copying the answer off the screen is not retyping it.
              onPaste={step.kind === 'miss' ? (e) => e.preventDefault() : undefined}
              onDrop={step.kind === 'miss' ? (e) => e.preventDefault() : undefined}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
            />
          </div>
          {step.kind === 'ask' && (
            <>
              {step.hinted && (
                <div className="fc-verdict__line fc-learn__hint" aria-live="polite">
                  <span className="fc-verdict__key">hint</span>
                  <span className="fc-learn__hinttext">{hintFor(expected)}</span>
                </div>
              )}
              <div className="rt-btnrow">
                <button
                  type="submit"
                  className="rt-btn rt-btn--primary"
                  disabled={!text.trim()}
                  onMouseDown={keepFocus}
                >
                  answer
                </button>
                {!step.hinted && (
                  <button
                    type="button"
                    className="rt-btn"
                    onMouseDown={keepFocus}
                    onClick={() => {
                      setSession(showHint(session));
                      inputRef.current?.focus();
                    }}
                  >
                    hint
                  </button>
                )}
                <button
                  type="button"
                  className="rt-btn"
                  onMouseDown={keepFocus}
                  onClick={() => apply(giveUp(session))}
                >
                  no idea
                </button>
              </div>
            </>
          )}
          {retypeWrong && (
            <div className="fc-answer__hint" role="alert">
              Not quite — type it exactly as shown.
            </div>
          )}
          {step.kind === 'miss' && (
            <div className="rt-btnrow">
              <button
                type="submit"
                className="rt-btn rt-btn--primary"
                disabled={leaving}
                onMouseDown={keepFocus}
              >
                {advanceWhenSaved ? 'saving…' : text.trim() ? 'check' : 'continue'}
                <IconEnter />
              </button>
              <button
                type="button"
                className="rt-btn"
                title="Move on without typing it out. The card still comes back later."
                disabled={leaving}
                onMouseDown={keepFocus}
                onClick={leaveMiss}
              >
                skip
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<LearnCardDTO['status'], string> = {
  new: 'new card',
  learning: 'learning',
  learned: 'learned',
};

function SaveLine({
  save,
  quality,
  onRetry,
}: {
  save: SaveState;
  quality: Quality;
  onRetry: () => void;
}) {
  if (save.status === 'error') {
    return (
      <div className="fc-answer__hint" role="alert">
        {save.message}{' '}
        <button type="button" className="rt-linkbtn" onClick={onRetry}>
          retry
        </button>
      </div>
    );
  }
  return (
    <div className="fc-learn__grade">
      {quality} · {QUALITY_LABEL[quality]}
      {' · '}
      {save.status === 'saved' ? 'saved' : 'saving…'}
    </div>
  );
}

/**
 * Milliseconds spent on the current question with the page in view. Switching
 * apps mid-question is not hesitating, and should not grade the answer as slow.
 */
function useAnswerClock(questionKey: number, running: boolean): () => number {
  const clock = useRef({ start: 0, hiddenMs: 0, hiddenSince: null as number | null });

  useEffect(() => {
    if (!running) return;
    const now = performance.now();
    clock.current = { start: now, hiddenMs: 0, hiddenSince: document.hidden ? now : null };
  }, [questionKey, running]);

  useEffect(() => {
    function onVisibilityChange() {
      const c = clock.current;
      const now = performance.now();
      if (document.hidden) {
        c.hiddenSince ??= now;
      } else if (c.hiddenSince !== null) {
        c.hiddenMs += now - c.hiddenSince;
        c.hiddenSince = null;
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return useCallback(() => {
    const c = clock.current;
    const now = performance.now();
    const hidden = c.hiddenMs + (c.hiddenSince !== null ? now - c.hiddenSince : 0);
    return Math.max(0, now - c.start - hidden);
  }, []);
}

// --- in-between checkpoint ---

function Checkpoint({
  session,
  onContinue,
}: {
  session: LearnSession;
  onContinue: () => void;
}) {
  const { cards, right, missed, mastered, learning, remaining, round } = summarize(session);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onContinue();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onContinue]);

  return (
    <div className="fc-panel fc-checkpoint" role="status">
      <div className="fc-checkpoint__badge">Checkpoint · Round {round}</div>
      <h2 className="fc-panel__title">
        {mastered > 0 ? "You're mastering this set!" : "Great progress! Keep going."}
      </h2>

      <div className="fc-progress" style={{ margin: '16px 0 20px' }}>
        <span className="fc-progress__count">
          {mastered} of {cards} cards mastered
        </span>
        <div className="fc-meter" aria-hidden="true">
          <span
            className="fc-meter__fill"
            style={{ width: `${cards > 0 ? (mastered / cards) * 100 : 0}%` }}
          />
        </div>
      </div>

      <dl className="fc-stats">
        <div>
          <dt title="Answered right twice (mastered)">Mastered</dt>
          <dd className="fc-stats__ok">{mastered}</dd>
        </div>
        <div>
          <dt title="Answered right once — you'll type these to master them!">Learning</dt>
          <dd className="fc-stats__learning">{learning}</dd>
        </div>
        <div>
          <dt title="Cards left to master">To go</dt>
          <dd>{remaining}</dd>
        </div>
      </dl>

      <p className="rt-small fc-setup__rules">
        {learning > 0
          ? `${learning} card${learning === 1 ? '' : 's'} in progress — you will type ${learning === 1 ? 'it' : 'them'} in the next round to master!`
          : 'Ready for the next batch of cards!'}
      </p>

      <div className="rt-btnrow">
        <button
          type="button"
          className="rt-btn rt-btn--primary"
          onClick={onContinue}
          autoFocus
        >
          Continue
          <IconEnter />
        </button>
      </div>
    </div>
  );
}

// --- end of the session ---

function Summary({
  session,
  setId,
  stats,
  onResume,
  onRestart,
}: {
  session: LearnSession;
  setId: number;
  stats: LearnStatsDTO | 'error' | null;
  onResume: () => void;
  onRestart: () => void;
}) {
  const { cards, right, missed, mastered, remaining } = summarize(session);
  const finished = remaining === 0;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (finished) onRestart();
        else onResume();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finished, onRestart, onResume]);

  return (
    <div className="fc-panel fc-summary" role="status">
      <h2 className="fc-panel__title">{finished ? 'all done · mastered!' : 'stopped'}</h2>

      <dl className="fc-stats">
        <div>
          <dt>cards</dt>
          <dd>{cards}</dd>
        </div>
        <div>
          <dt title="Cards mastered (answered right twice)">mastered</dt>
          <dd className="fc-stats__ok">{mastered}</dd>
        </div>
        <div>
          <dt title="Wrong answers along the way">missed</dt>
          <dd className={missed > 0 ? 'fc-stats__miss' : undefined}>{missed}</dd>
        </div>
      </dl>

      {stats && stats !== 'error' && <LearnedMeter stats={stats} />}

      <p className="rt-small fc-setup__rules">
        Every answer is already saved.{' '}
        {!finished && `${plural(remaining, 'card')} still to go can wait or be done now.`}
      </p>

      <div className="rt-btnrow">
        {finished ? (
          <button type="button" className="rt-btn rt-btn--primary" onClick={onRestart} autoFocus>
            learn again
          </button>
        ) : (
          <button type="button" className="rt-btn rt-btn--primary" onClick={onResume} autoFocus>
            keep going · {remaining} left
          </button>
        )}
        <Link href={`/flashcards/${setId}`} className="rt-btn">
          back to set
        </Link>
        <Link href={`/flashcards/${setId}/write`} className="rt-btn">
          switch to write
        </Link>
      </div>
    </div>
  );
}
