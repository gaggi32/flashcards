// The hotkey overlay: a short round of cards from the overlay sets, studied in
// one of three modes — Cards (flip, then knew it / missed it), Write (type the
// answer) or Learn (multiple choice for new cards, typed once you know them) —
// plus a quick-add form. No dates: a round is the cards you are still
// learning, then a few new ones, then learned ones you have not seen longest.
// A missed card comes back once at the end of the round. It lives in its own
// borderless, always-on-top window; Esc or a click elsewhere hides it.

import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CountUp } from '@/components/TodayPanel';
import { announceDataChange, useDataVersion } from '@/lib/app/events';
import { formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import { hideOverlay, openMain } from '@/lib/app/native';
import { useSettings } from '@/lib/app/settings';
import { computeDiff } from '@/lib/flashcards/diff';
import { pickDistractors } from '@/lib/flashcards/distractors';
import { shuffle } from '@/lib/flashcards/shuffle';
import type { Quality } from '@/lib/flashcards/sm2';
import type { SetSummaryDTO } from '@/lib/flashcards/types';
import { isMatch } from '@/lib/flashcards/write';
import { todayKey } from '@/lib/nutrition/day';
import { asApiError } from '@/lib/store/errors';
import {
  addCards,
  lastUsedSetId,
  learnStatus,
  listSets,
  overlayPool,
  overlayRound,
  overview,
  reviewCard,
  type OverlayCard,
  type Overview,
} from '@/lib/store/repo';

type StudyMode = 'cards' | 'write' | 'learn';
const MODES: { id: StudyMode; label: string; hint: string }[] = [
  { id: 'cards', label: 'Cards', hint: 'Flip, then say whether you knew it' },
  { id: 'write', label: 'Write', hint: 'Type the answer' },
  { id: 'learn', label: 'Learn', hint: 'Multiple choice for new cards, typed once you know them' },
];
const MODE_KEY = 'flashcards.overlay-mode';

const RIGHT: Quality = 4;
const MISSED: Quality = 1;
/** How long a right answer stays green before the next card (Enter skips it). */
const RIGHT_PAUSE_MS = 650;
/** An Enter this soon after a card appears belongs to the previous card. */
const STRAY_ENTER_MS = 400;
/** A round left open this long is rebuilt on the next open. */
const STALE_MS = 15 * 60 * 1000;

type Item = { card: OverlayCard; termFirst: boolean; retry: boolean };
type Phase =
  | { kind: 'ask' }
  | { kind: 'right'; choice?: number }
  | { kind: 'wrong'; given: string | null; choice?: number; quality: Quality };
type PoolCard = { id: number; term: string; definition: string; setId: number };

function loadMode(): StudyMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === 'cards' || m === 'write' || m === 'learn') return m;
  } catch {
    /* storage can be unavailable; the default will do */
  }
  return 'cards';
}

function saveMode(m: StudyMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* only a convenience */
  }
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
}

export function Overlay() {
  const { settings } = useSettings();
  const [view, setView] = useState<'study' | 'add'>('study');
  const [mode, setModeState] = useState<StudyMode>(loadMode);
  const [round, setRound] = useState<Item[] | null>(null);
  const [pool, setPool] = useState<PoolCard[]>([]);
  const [builtAt, setBuiltAt] = useState(0);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' });
  const [right, setRight] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [stats, setStats] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const shownAt = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const version = useDataVersion();

  const setMode = useCallback((m: StudyMode) => {
    setModeState(m);
    saveMode(m);
    setFlipped(false);
    setPhase({ kind: 'ask' });
    shownAt.current = performance.now();
  }, []);

  const refreshStats = useCallback(() => {
    overview(todayKey())
      .then(setStats)
      .catch(() => {});
  }, []);

  const build = useCallback(async () => {
    if (!settings) return;
    setError(null);
    try {
      const [cards, all] = await Promise.all([
        overlayRound(settings.overlayRound, settings.overlayNewCards),
        overlayPool(),
      ]);
      setRound(
        cards.map((card) => ({
          card,
          termFirst: settings.overlayFront === 'mixed' ? Math.random() < 0.5 : settings.overlayFront === 'term',
          retry: false,
        })),
      );
      setPool(all);
      setIndex(0);
      setFlipped(false);
      setPhase({ kind: 'ask' });
      setRight(0);
      setAnswered(0);
      setBuiltAt(Date.now());
      shownAt.current = performance.now();
      refreshStats();
    } catch (err) {
      setError(asApiError(err, 'Could not load cards.').message);
    }
  }, [settings, refreshStats]);

  useEffect(() => {
    void build();
  }, [build]);

  // Cards changed in the main window: refresh the numbers, keep the round.
  useEffect(() => {
    if (version > 0) refreshStats();
  }, [version, refreshStats]);

  // Each time the hotkey shows the window: pop the panel in, refresh if stale.
  useEffect(() => {
    const off = listen('overlay-open', () => {
      setError(null);
      panel.current?.animate(
        [
          { opacity: 0, transform: 'translateY(8px) scale(0.97)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.2)' },
      );
      const finished = round !== null && index >= round.length;
      if (round === null || finished || Date.now() - builtAt > STALE_MS) void build();
      requestAnimationFrame(() =>
        document.getElementById(view === 'add' ? 'qa-term' : 'ov-answer')?.focus(),
      );
    });
    return () => void off.then((f) => f());
  }, [round, index, builtAt, build, view]);

  const item = round && index < round.length ? round[index] : null;
  const card = item?.card ?? null;
  const prompt = card ? (item!.termFirst ? card.term : card.definition) : '';
  const expected = card ? (item!.termFirst ? card.definition : card.term) : '';

  // Learn asks new cards as multiple choice when the set has enough other
  // cards to make real options; everything else is typed.
  const choices = useMemo(() => {
    if (!item || mode !== 'learn' || item.card.status !== 'new') return null;
    const side = item.termFirst ? 'definition' : 'term';
    const sameSet = pool.filter((p) => p.setId === item.card.setId);
    const self = sameSet.find((p) => p.id === item.card.id) ?? { ...item.card };
    const wrong = pickDistractors(self, sameSet, 3, { side });
    if (wrong.length < 3) return null;
    return shuffle([expected, ...wrong.map((w) => (side === 'definition' ? w.definition : w.term))]);
    // A new question per card shown, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mode, round?.length, pool]);

  const typed = mode === 'write' || (mode === 'learn' && !choices);

  /** Saves the answer, re-queues a miss once, and moves to the next card. */
  const finish = useCallback(
    async (quality: Quality) => {
      if (!item || busy.current) return;
      busy.current = true;
      try {
        const { progress } = await reviewCard(item.card.id, quality, todayKey(), item.card.progress?.repetitionNumber ?? null);
        announceDataChange();
        const updated: OverlayCard = { ...item.card, progress, status: learnStatus(progress) };
        setRound((r) => {
          if (!r) return r;
          const next = r.map((it) => (it.card.id === updated.id ? { ...it, card: updated } : it));
          if (quality < 3 && !item.retry) next.push({ card: updated, termFirst: item.termFirst, retry: true });
          return next;
        });
        setAnswered((n) => n + 1);
        if (quality >= 3) setRight((n) => n + 1);
        setIndex((i) => i + 1);
        setFlipped(false);
        setPhase({ kind: 'ask' });
        shownAt.current = performance.now();
        refreshStats();
      } catch (err) {
        setError(asApiError(err, 'Could not save that answer.').message);
      } finally {
        busy.current = false;
      }
    },
    [item, refreshStats],
  );

  // A right answer shows green for a moment, then moves on by itself.
  useEffect(() => {
    if (phase.kind !== 'right') return;
    const t = setTimeout(() => void finish(RIGHT), RIGHT_PAUSE_MS);
    return () => clearTimeout(t);
  }, [phase, finish]);

  const checkTyped = useCallback(
    (given: string) => {
      if (!item || phase.kind !== 'ask') return;
      if (!given.trim()) {
        // Empty Enter means "no idea" — unless it was a late Enter from the last card.
        if (performance.now() - shownAt.current < STRAY_ENTER_MS) return;
        setPhase({ kind: 'wrong', given: null, quality: MISSED });
        return;
      }
      if (isMatch(given, expected)) setPhase({ kind: 'right' });
      else setPhase({ kind: 'wrong', given, quality: MISSED });
    },
    [item, phase, expected],
  );

  const pick = useCallback(
    (i: number) => {
      if (!choices || phase.kind !== 'ask') return;
      if (choices[i] === expected) setPhase({ kind: 'right', choice: i });
      else setPhase({ kind: 'wrong', given: null, choice: i, quality: MISSED });
    },
    [choices, phase, expected],
  );

  // Move focus off the answer box once a verdict shows, so keys reach the window.
  useEffect(() => {
    if (phase.kind !== 'ask' && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [phase]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (view === 'add') setView('study');
        else void hideOverlay();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        setView('study');
        setMode(MODES[Number(e.key) - 1].id);
        return;
      }
      if (view !== 'study' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();

      if (!card) {
        if (k === 'r') void build();
        if (k === 'a') {
          e.preventDefault();
          setView('add');
        }
        return;
      }
      if (phase.kind === 'right' && (k === 'enter' || k === ' ')) {
        e.preventDefault();
        void finish(RIGHT);
        return;
      }
      if (phase.kind === 'wrong') {
        if (k === 'enter' || k === ' ') {
          e.preventDefault();
          void finish(phase.quality);
        } else if (k === 'o' && phase.given !== null) {
          e.preventDefault();
          setPhase({ kind: 'right' });
        }
        return;
      }
      if (mode === 'cards') {
        if (!flipped && (k === ' ' || k === 'enter')) {
          e.preventDefault();
          setFlipped(true);
        } else if (flipped && (k === '1' || k === 'arrowleft')) {
          e.preventDefault();
          void finish(MISSED);
        } else if (flipped && (k === '2' || k === 'arrowright' || k === ' ' || k === 'enter')) {
          e.preventDefault();
          void finish(RIGHT);
        }
      } else if (choices && ['1', '2', '3', '4'].includes(k)) {
        e.preventDefault();
        pick(Number(k) - 1);
      }
      if (k === 'a') {
        e.preventDefault();
        setView('add');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, mode, card, flipped, phase, choices, finish, pick, build, setMode]);

  const hotkey = settings ? formatHotkey(settings.hotkey, isMacPlatform()) : '';
  const modeIndex = MODES.findIndex((m) => m.id === mode);
  const progress = round && round.length ? Math.min(1, index / round.length) : 0;

  return (
    <div className="rt-page fc-page ov">
      <div
        className="ov__panel"
        ref={panel}
        // Clicking a button must not take focus: Space and Enter belong to the
        // round (a focused button would run them twice), and the answer box keeps its caret.
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) e.preventDefault();
        }}
      >
        <header className="ov__head" data-tauri-drag-region>
          <div className="ov__modes" role="tablist" aria-label="Study mode" style={{ ['--i' as string]: modeIndex }}>
            <span className="ov__modes-pill" aria-hidden="true" />
            {MODES.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id && view === 'study'}
                className={`ov__mode${mode === m.id ? ' is-on' : ''}`}
                title={`${m.hint} (${isMacPlatform() ? '⌘' : 'Ctrl+'}${i + 1})`}
                onClick={() => {
                  setView('study');
                  setMode(m.id);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          {stats && (
            <span className="ov__stats" data-tauri-drag-region>
              <CountUp value={stats.learning} /> learning · <CountUp value={stats.fresh} /> new
              {stats.streak > 0 && (
                <>
                  {' · '}
                  <span className={`ov__streak${stats.answeredToday ? ' is-lit' : ''}`}>
                    <CountUp value={stats.streak} />d streak
                  </span>
                </>
              )}
            </span>
          )}
          <span className="ov__spacer" data-tauri-drag-region />
          <button
            type="button"
            className={`ov__icon${view === 'add' ? ' is-on' : ''}`}
            title="Add a card (A)"
            onClick={() => setView(view === 'add' ? 'study' : 'add')}
          >
            +
          </button>
          <button type="button" className="ov__icon" title="Open Flashcards" onClick={() => void openMain('/flashcards')}>
            ⤢
          </button>
          <button type="button" className="ov__icon" title={`Hide (Esc or ${hotkey})`} onClick={() => void hideOverlay()}>
            ×
          </button>
        </header>
        <div className="ov__progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${view === 'study' ? progress : 0})` }} />
        </div>

        {error && <div className="ov__error">{error}</div>}

        {view === 'add' ? (
          <QuickAdd onDone={() => setView('study')} />
        ) : round === null ? (
          <div className="ov__body ov__center rt-ink-faint">loading…</div>
        ) : item && card ? (
          <div className="ov__study" key={`${index}-${mode}`}>
            <div className="ov__meta">
              <span>
                {index + 1} / {round.length}
              </span>
              <span className="ov__set">{card.setTitle}</span>
              {item.retry && <span className="ov__tag is-retry">again</span>}
              <span className={`ov__tag is-${card.status}`}>{card.status}</span>
            </div>

            {mode === 'cards' ? (
              <>
                <button
                  type="button"
                  className={`ov__flip${flipped ? ' is-flipped' : ''}`}
                  onClick={() => setFlipped((f) => !f)}
                  aria-label={flipped ? 'Show the question again' : 'Show the answer'}
                >
                  <span className="ov__face ov__face--front">
                    <span className="ov__front">{prompt}</span>
                  </span>
                  <span className="ov__face ov__face--back">
                    <span className="ov__back-prompt">{prompt}</span>
                    <span className="ov__front">{expected}</span>
                  </span>
                </button>
                <div className="ov__actions">
                  {flipped ? (
                    <>
                      <button type="button" className="rt-btn rt-btn--sm ov__grade ov__grade--miss" onClick={() => void finish(MISSED)}>
                        <span className="ov__key">1</span> missed it
                      </button>
                      <button type="button" className="rt-btn rt-btn--sm ov__grade ov__grade--knew" onClick={() => void finish(RIGHT)}>
                        <span className="ov__key">2</span> knew it
                      </button>
                    </>
                  ) : (
                    <button type="button" className="rt-btn rt-btn--sm rt-btn--primary ov__show" onClick={() => setFlipped(true)}>
                      <span className="ov__key">space</span> flip
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className={`ov__card ov__card--${phase.kind}`}>
                  <span className="ov__front">{prompt}</span>
                </div>
                {choices ? (
                  <ol className="ov__choices">
                    {choices.map((c, i) => {
                      const state =
                        phase.kind === 'ask'
                          ? ''
                          : c === expected
                            ? ' is-right'
                            : phase.choice === i
                              ? ' is-wrong'
                              : ' is-dim';
                      return (
                        <li key={i} style={{ ['--d' as string]: `${i * 45}ms` }}>
                          <button type="button" className={`ov__choice${state}`} disabled={phase.kind !== 'ask'} onClick={() => pick(i)}>
                            <span className="ov__key">{i + 1}</span>
                            <span className="ov__choice-text">{c}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  typed && <TypedAnswer phase={phase} expected={expected} onCheck={checkTyped} />
                )}
                <div className="ov__hint">
                  {phase.kind === 'ask' &&
                    (choices ? 'Pick with 1–4.' : 'Enter checks. Enter on an empty box means no idea.')}
                  {phase.kind === 'right' && <span className="ov__good">Right! Enter skips the pause.</span>}
                  {phase.kind === 'wrong' && (
                    <>
                      <span className="ov__bad">{phase.given === null && !choices ? 'No worries.' : 'Not quite.'}</span> It comes back
                      at the end of the round. <span className="ov__key">enter</span> continue
                      {phase.given !== null && (
                        <button type="button" className="ov__link" onClick={() => setPhase({ kind: 'right' })}>
                          <span className="ov__key">O</span> I was right
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <RoundEnd
            done={answered}
            right={right}
            empty={round.length === 0}
            onAgain={() => void build()}
            onAdd={() => setView('add')}
          />
        )}
      </div>
    </div>
  );
}

function TypedAnswer({
  phase,
  expected,
  onCheck,
}: {
  phase: Phase;
  expected: string;
  onCheck: (given: string) => void;
}) {
  const [value, setValue] = useState('');
  if (phase.kind === 'wrong') {
    const diff = phase.given !== null ? computeDiff(phase.given, expected) : null;
    return (
      <div className="ov__verdict">
        {diff && (
          <div className="ov__verdict-line">
            <span className="ov__verdict-key">you</span>
            <span>
              {diff.filter((p) => !p.added).map((p, i) => (
                <span key={i} className={p.removed ? 'fc-diff-rem' : ''}>
                  {p.value}
                </span>
              ))}
            </span>
          </div>
        )}
        <div className="ov__verdict-line">
          <span className="ov__verdict-key">answer</span>
          <span className="ov__verdict-answer">
            {diff
              ? diff.filter((p) => !p.removed).map((p, i) => (
                  <span key={i} className={p.added ? 'fc-diff-add' : ''}>
                    {p.value}
                  </span>
                ))
              : expected}
          </span>
        </div>
      </div>
    );
  }
  return (
    <form
      className="ov__typed"
      onSubmit={(e) => {
        e.preventDefault();
        onCheck(value);
      }}
    >
      <input
        id="ov-answer"
        className={`rt-input ov__input${phase.kind === 'right' ? ' is-right' : ''}`}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder="type the answer"
        aria-label="Your answer"
        value={value}
        readOnly={phase.kind !== 'ask'}
        maxLength={2000}
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}

function RoundEnd({
  done,
  right,
  empty,
  onAgain,
  onAdd,
}: {
  done: number;
  right: number;
  empty: boolean;
  onAgain: () => void;
  onAdd: () => void;
}) {
  const share = done ? right / done : 0;
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="ov__body ov__center ov__end">
      {empty ? (
        <>
          <p className="ov__big">No cards in the overlay yet.</p>
          <p className="rt-small rt-ink-faint">Add some, or switch a set into the overlay on its page.</p>
        </>
      ) : (
        <>
          <svg className="ov__ring" width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">
            <circle cx="34" cy="34" r={r} className="ov__ring-track" />
            <circle
              cx="34"
              cy="34"
              r={r}
              className="ov__ring-fill"
              style={{ strokeDasharray: circ, ['--to' as string]: `${circ * (1 - share)}`, ['--from' as string]: `${circ}` }}
            />
          </svg>
          <p className="ov__big">
            Round done: {right} of {done} right.
          </p>
          <p className="rt-small rt-ink-faint">{share === 1 ? 'Clean sweep.' : 'Misses get asked again first next round.'}</p>
        </>
      )}
      <div className="rt-btnrow ov__end-actions">
        {!empty && (
          <button type="button" className="rt-btn rt-btn--sm rt-btn--primary" onClick={onAgain}>
            <span className="ov__key">R</span> another round
          </button>
        )}
        <button type="button" className="rt-btn rt-btn--sm" onClick={onAdd}>
          <span className="ov__key">A</span> add a card
        </button>
      </div>
    </div>
  );
}

function QuickAdd({ onDone }: { onDone: () => void }) {
  const [sets, setSets] = useState<SetSummaryDTO[] | null>(null);
  const [setId, setSetId] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const [definition, setDefinition] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const termRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([listSets(), lastUsedSetId()])
      .then(([list, last]) => {
        setSets(list);
        setSetId(last ?? list[0]?.id ?? null);
      })
      .catch((err) => setError(asApiError(err).message));
    termRef.current?.focus();
  }, []);

  const ordered = useMemo(() => [...(sets ?? [])].sort((a, b) => a.title.localeCompare(b.title)), [sets]);

  async function submit() {
    if (!setId || !term.trim() || !definition.trim()) return;
    setError(null);
    try {
      await addCards(setId, [{ term: term.trim(), definition: definition.trim() }]);
      announceDataChange();
      setSaved(term.trim());
      setTerm('');
      setDefinition('');
      termRef.current?.focus();
    } catch (err) {
      setError(asApiError(err, 'Could not add the card.').message);
    }
  }

  if (sets && sets.length === 0) {
    return (
      <div className="ov__body ov__center">
        <p className="ov__big">No sets yet.</p>
        <button type="button" className="rt-btn rt-btn--sm rt-btn--primary" onClick={() => void openMain('/flashcards/new')}>
          make one
        </button>
      </div>
    );
  }

  return (
    <form
      className="ov__body ov__add fx-rise"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <select className="rt-input" aria-label="Set" value={setId ?? ''} onChange={(e) => setSetId(Number(e.target.value))}>
        {ordered.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
      <input
        id="qa-term"
        ref={termRef}
        className="rt-input"
        placeholder="term"
        aria-label="Term"
        value={term}
        maxLength={2000}
        onChange={(e) => setTerm(e.target.value)}
      />
      <input
        className="rt-input"
        placeholder="definition — Enter saves"
        aria-label="Definition"
        value={definition}
        maxLength={2000}
        onChange={(e) => setDefinition(e.target.value)}
      />
      <div className="ov__add-foot">
        <span className="rt-small rt-ink-faint">
          {error ? (
            <span className="rt-rust">{error}</span>
          ) : saved ? (
            <span className="ov__saved" key={saved}>
              Added “{saved}”.
            </span>
          ) : (
            'Tab moves on, Esc goes back.'
          )}
        </span>
        <span className="ov__spacer" />
        <button type="button" className="rt-btn rt-btn--sm" onClick={onDone}>
          done
        </button>
        <button type="submit" className="rt-btn rt-btn--sm rt-btn--primary" disabled={!term.trim() || !definition.trim() || !setId}>
          add
        </button>
      </div>
    </form>
  );
}
