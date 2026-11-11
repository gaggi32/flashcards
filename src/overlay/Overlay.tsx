// The hotkey overlay: a short round of cards from the set you pick, studied in
// one of three modes:
//   Cards — flip, then swipe or press 1 / 2 for missed it / knew it;
//   Write — type the answer; a wrong one has to be typed out correctly;
//   Learn — like the full Learn mode: multiple choice until you have got a
//           card right once (with the odd typed one), typed after that.
// No dates: a round is the cards you are still learning, then a few new ones,
// then learned ones you have not seen longest. A miss comes back once at the
// end of the round. Sides are the website's: Cards shows the term, Write and
// Learn show the definition and you type the term; ⇄ swaps them. It lives in its own
// borderless, always-on-top window; Esc or a click elsewhere hides it.

import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SpecialKeys } from '@/components/flashcards/SpecialKeys';
import { CountUp } from '@/components/TodayPanel';
import { announceDataChange, useDataVersion } from '@/lib/app/events';
import { formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import { hideOverlay, openMain } from '@/lib/app/native';
import { studySetFrom, usePref, type OverlayMode } from '@/lib/app/prefs';
import { useSettings } from '@/lib/app/settings';
import { computeDiff } from '@/lib/flashcards/diff';
import { pickDistractors } from '@/lib/flashcards/distractors';
import { WRITTEN_MIX } from '@/lib/flashcards/learn';
import { shuffle } from '@/lib/flashcards/shuffle';
import type { Quality } from '@/lib/flashcards/sm2';
import { specialCharsOf } from '@/lib/flashcards/specialChars';
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

const MODES: { id: OverlayMode; label: string; hint: string }[] = [
  { id: 'cards', label: 'Cards', hint: 'Flip, then swipe or press 1 / 2' },
  { id: 'write', label: 'Write', hint: 'Type the answer' },
  { id: 'learn', label: 'Learn', hint: 'Multiple choice until you know it, then typed' },
];

const RIGHT: Quality = 4;
const MISSED: Quality = 1;
/** How long a right answer stays green before the next card (Enter skips it). */
const RIGHT_PAUSE_MS = 650;
/** An Enter this soon after a card appears belongs to the previous card. */
const STRAY_ENTER_MS = 400;
/** A round left open this long is rebuilt on the next open. */
const STALE_MS = 15 * 60 * 1000;
/** A drag this far (share of the card's width) counts as a swipe. */
const SWIPE_SHARE = 0.22;
/** How long a swiped or graded card takes to fly off. */
const FLY_MS = 260;

type Item = {
  card: OverlayCard;
  retry: boolean;
  /** Fixed per item, so a re-render never changes the question. */
  coinTyped: boolean;
};
type Phase =
  | { kind: 'ask' }
  | { kind: 'right'; choice?: number }
  | { kind: 'wrong'; given: string | null; choice?: number };
type PoolCard = { id: number; term: string; definition: string; setId: number };

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  );
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Overlay() {
  const { settings } = useSettings();
  const [view, setView] = useState<'study' | 'add'>('study');
  const [mode, setModePref] = usePref('overlayMode');
  const [chosenSet, setChosenSet] = usePref('overlaySet');
  const [swapped, setSwapped] = usePref('swapped');
  const [sets, setSets] = useState<SetSummaryDTO[]>([]);
  const [round, setRound] = useState<Item[] | null>(null);
  const [pool, setPool] = useState<PoolCard[]>([]);
  const [builtAt, setBuiltAt] = useState(0);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [fly, setFly] = useState<'known' | 'missed' | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' });
  const [right, setRight] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [stats, setStats] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const shownAt = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const version = useDataVersion();

  const setId = studySetFrom(chosenSet, sets);

  const resetCard = useCallback(() => {
    setFlipped(false);
    setFly(null);
    setPhase({ kind: 'ask' });
    shownAt.current = performance.now();
  }, []);

  const setMode = useCallback(
    (m: OverlayMode) => {
      setModePref(m);
      resetCard();
    },
    [setModePref, resetCard],
  );

  const refreshStats = useCallback(() => {
    if (setId === null) return;
    overview(todayKey(), setId)
      .then(setStats)
      .catch(() => {});
  }, [setId]);

  const build = useCallback(async () => {
    if (!settings) return;
    if (setId === null) {
      setRound([]);
      return;
    }
    setError(null);
    try {
      // 0 cards per round means the whole set.
      const all = settings.overlayRound === 0;
      const [cards, everyCard] = await Promise.all([
        overlayRound(all ? 100_000 : settings.overlayRound, all ? 100_000 : settings.overlayNewCards, setId),
        overlayPool(setId),
      ]);
      setRound(cards.map((card) => ({ card, retry: false, coinTyped: Math.random() < WRITTEN_MIX })));
      setPool(everyCard);
      setIndex(0);
      setRight(0);
      setAnswered(0);
      setBuiltAt(Date.now());
      resetCard();
      refreshStats();
    } catch (err) {
      setError(asApiError(err, 'Could not load cards.').message);
    }
  }, [settings, setId, resetCard, refreshStats]);

  // First load, and a new round whenever the set or the round's shape changes.
  useEffect(() => {
    void build();
  }, [build]);

  useEffect(() => {
    listSets()
      .then(setSets)
      .catch(() => {});
  }, [version]);

  // Cards changed in the main window: refresh the numbers, keep the round.
  useEffect(() => {
    if (version > 0) refreshStats();
  }, [version, refreshStats]);

  // Each time the hotkey shows the window: pop the panel in, refresh if stale.
  useEffect(() => {
    const off = listen('overlay-open', () => {
      setError(null);
      if (!reducedMotion()) {
        panel.current?.animate(
          [
            { opacity: 0, transform: 'translateY(8px) scale(0.97)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.2)' },
        );
      }
      const finished = round !== null && index >= round.length;
      if (round === null || finished || Date.now() - builtAt > STALE_MS) void build();
      requestAnimationFrame(() => document.getElementById(view === 'add' ? 'qa-term' : 'ov-answer')?.focus());
    });
    return () => void off.then((f) => f());
  }, [round, index, builtAt, build, view]);

  const item = round && index < round.length ? round[index] : null;
  const card = item?.card ?? null;
  // The website's way round: Cards shows the term; Write and Learn show the
  // definition and you type the term.
  const termFirst = (mode === 'cards') !== swapped;
  const prompt = card ? (termFirst ? card.term : card.definition) : '';
  const expected = card ? (termFirst ? card.definition : card.term) : '';
  const answerSide = termFirst ? 'definition' : 'term';

  // Learn, as in the full Learn mode: multiple choice until the card has been
  // answered right once (a quarter of those typed anyway), typed after that,
  // and typed whenever the set cannot supply three real wrong options.
  const choices = useMemo(() => {
    if (!item || mode !== 'learn') return null;
    const gotItRight = (item.card.progress?.repetitionNumber ?? 0) > 0;
    if ((gotItRight && !item.retry) || item.coinTyped) return null;
    const sameSet = pool.filter((p) => p.setId === item.card.setId);
    const self = sameSet.find((p) => p.id === item.card.id) ?? { ...item.card };
    const wrong = pickDistractors(self, sameSet, 3, { side: answerSide });
    if (wrong.length < 3) return null;
    return shuffle([expected, ...wrong.map((w) => (answerSide === 'definition' ? w.definition : w.term))]);
    // A new question per card shown (or side swapped), not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, mode, round?.length, pool, answerSide]);

  const typed = mode === 'write' || (mode === 'learn' && !choices);

  const specialChars = useMemo(() => {
    if (!item || !typed) return [];
    return specialCharsOf(
      pool.filter((p) => p.setId === item.card.setId),
      answerSide,
    );
  }, [item, typed, pool, answerSide]);

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
          if (quality < 3 && !item.retry) next.push({ ...item, card: updated, retry: true });
          return next;
        });
        setAnswered((n) => n + 1);
        if (quality >= 3) setRight((n) => n + 1);
        setIndex((i) => i + 1);
        resetCard();
        refreshStats();
      } catch (err) {
        setError(asApiError(err, 'Could not save that answer.').message);
      } finally {
        busy.current = false;
      }
    },
    [item, refreshStats, resetCard],
  );

  /** Cards mode: the card flies off green or red, then the answer is saved. */
  const mark = useCallback(
    (known: boolean) => {
      if (!item || fly || busy.current) return;
      if (reducedMotion()) {
        void finish(known ? RIGHT : MISSED);
        return;
      }
      setFly(known ? 'known' : 'missed');
      window.setTimeout(() => void finish(known ? RIGHT : MISSED), FLY_MS);
    },
    [item, fly, finish],
  );

  // A right answer shows green for a moment, then moves on by itself.
  useEffect(() => {
    if (phase.kind !== 'right') return;
    const t = setTimeout(() => void finish(RIGHT), RIGHT_PAUSE_MS);
    return () => clearTimeout(t);
  }, [phase, finish]);

  const checkTyped = useCallback(
    (given: string) => {
      if (phase.kind === 'right') {
        void finish(RIGHT);
        return;
      }
      if (!item || phase.kind !== 'ask') return;
      if (!given.trim()) {
        // Empty Enter means "no idea" — unless it was a late Enter from the last card.
        if (performance.now() - shownAt.current < STRAY_ENTER_MS) return;
        setPhase({ kind: 'wrong', given: null });
        return;
      }
      if (isMatch(given, expected)) setPhase({ kind: 'right' });
      else setPhase({ kind: 'wrong', given });
    },
    [item, phase, expected, finish],
  );

  const pick = useCallback(
    (i: number) => {
      if (!choices || phase.kind !== 'ask') return;
      if (choices[i] === expected) setPhase({ kind: 'right', choice: i });
      else setPhase({ kind: 'wrong', given: null, choice: i });
    },
    [choices, phase, expected],
  );

  const swapSides = useCallback(() => {
    setSwapped(!swapped);
    resetCard();
  }, [swapped, setSwapped, resetCard]);

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

      if (k === 's') {
        e.preventDefault();
        swapSides();
        return;
      }
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
      if (phase.kind === 'wrong' && choices && (k === 'enter' || k === ' ')) {
        e.preventDefault();
        void finish(MISSED);
        return;
      }
      if (mode === 'cards') {
        if (!flipped && (k === ' ' || k === 'enter')) {
          e.preventDefault();
          setFlipped(true);
        } else if (flipped && (k === '1' || k === 'arrowleft')) {
          e.preventDefault();
          if (!e.repeat) mark(false);
        } else if (flipped && (k === '2' || k === 'arrowright' || k === ' ' || k === 'enter')) {
          e.preventDefault();
          if (!e.repeat) mark(true);
        }
      } else if (choices && phase.kind === 'ask' && ['1', '2', '3', '4'].includes(k)) {
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
  }, [view, mode, card, flipped, phase, choices, finish, mark, pick, build, setMode, swapSides]);

  const hotkey = settings ? formatHotkey(settings.hotkey, isMacPlatform()) : '';
  const modeIndex = MODES.findIndex((m) => m.id === mode);
  const progress = round && round.length ? Math.min(1, index / round.length) : 0;
  const sideLabel = termFirst ? 'showing the term' : 'showing the definition';

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
          <span className="ov__spacer" data-tauri-drag-region />
          <button type="button" className="ov__icon ov__swap" title={`Swap sides — now ${sideLabel} (S)`} onClick={swapSides}>
            ⇄
          </button>
          <button
            type="button"
            className={`ov__icon ov__plus${view === 'add' ? ' is-on' : ''}`}
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

        <div className="ov__bar">
          <select
            className="ov__setpick"
            aria-label="Set to study"
            value={setId === null ? '' : String(setId)}
            onChange={(e) => {
              setChosenSet(Number(e.target.value));
              setView('study');
              e.currentTarget.blur();
            }}
          >
            {[...sets]
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
          </select>
          {stats && (
            <span className="ov__stats">
              <CountUp value={stats.learning} /> learning · <CountUp value={stats.fresh} /> new ·{' '}
              <CountUp value={stats.learned} /> learned
              {stats.streak > 0 && (
                <span className={`ov__streak${stats.answeredToday ? ' is-lit' : ''}`}>
                  {' · '}
                  <CountUp value={stats.streak} />d streak
                </span>
              )}
            </span>
          )}
        </div>
        <div className="ov__progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${view === 'study' ? progress : 0})` }} />
        </div>

        {error && <div className="ov__error">{error}</div>}

        {view === 'add' ? (
          <QuickAdd onDone={() => setView('study')} preferSet={setId} />
        ) : round === null ? (
          <div className="ov__body ov__center rt-ink-faint">loading…</div>
        ) : item && card ? (
          <div className="ov__study" key={`${index}-${mode}-${termFirst}`}>
            <div className="ov__meta">
              <span>
                {index + 1} / {round.length}
              </span>
              <span className="ov__set" />
              {item.retry && <span className="ov__tag is-retry">again</span>}
              <span className={`ov__tag is-${card.status}`}>{card.status}</span>
            </div>

            {mode === 'cards' ? (
              <CardsMode
                prompt={prompt}
                answer={expected}
                flipped={flipped}
                fly={fly}
                onFlip={() => setFlipped((f) => !f)}
                onMark={mark}
              />
            ) : (
              <>
                <div className={`ov__card ov__card--${phase.kind}`}>
                  <span className="ov__front">{prompt}</span>
                </div>
                {choices ? (
                  <ol className="ov__choices">
                    {choices.map((c, i) => {
                      const state =
                        phase.kind === 'ask' ? '' : c === expected ? ' is-right' : phase.choice === i ? ' is-wrong' : ' is-dim';
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
                  typed && (
                    <TypedAnswer
                      phase={phase}
                      expected={expected}
                      specialChars={specialChars}
                      onCheck={checkTyped}
                      onRetyped={() => void finish(MISSED)}
                      onOverride={() => setPhase({ kind: 'right' })}
                    />
                  )
                )}
                {choices && (
                  <div className="ov__hint">
                    {phase.kind === 'ask' && 'Pick with 1–4.'}
                    {phase.kind === 'right' && <span className="ov__good">Right! Enter skips the pause.</span>}
                    {phase.kind === 'wrong' && (
                      <>
                        <span className="ov__bad">Not quite.</span> It comes back at the end of the round.
                        <span className="ov__spacer" />
                        <span className="ov__key">enter</span> continue
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <RoundEnd
            done={answered}
            right={right}
            empty={round.length === 0}
            noSets={sets.length === 0}
            onAgain={() => void build()}
            onAdd={() => setView('add')}
          />
        )}
      </div>
    </div>
  );
}

/** Flip with Space or a click; swipe right (or 2) if you knew it, left (or 1) if not. */
function CardsMode({
  prompt,
  answer,
  flipped,
  fly,
  onFlip,
  onMark,
}: {
  prompt: string;
  answer: string;
  flipped: boolean;
  fly: 'known' | 'missed' | null;
  onFlip: () => void;
  onMark: (known: boolean) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; x: number; dx: number; active: boolean } | null>(null);
  const dragged = useRef(false);

  function paint(dx: number, settle: boolean) {
    const el = ref.current;
    if (!el) return;
    const share = Math.max(-1, Math.min(1, dx / ((el.offsetWidth || 1) * SWIPE_SHARE)));
    el.style.transition = settle ? 'transform 0.22s ease' : 'none';
    el.style.transform = dx === 0 ? '' : `translateX(${dx}px) rotate(${dx / 30}deg)`;
    el.style.setProperty('--swipe-ok', String(Math.max(0, share)));
    el.style.setProperty('--swipe-miss', String(Math.max(0, -share)));
  }

  // Keys and buttons fly the card off too: the same colours as a swipe.
  useEffect(() => {
    if (!fly) return;
    const el = ref.current;
    if (!el) return;
    el.style.transition = `transform ${FLY_MS}ms ease-in, opacity ${FLY_MS}ms ease-in`;
    el.style.setProperty('--swipe-ok', fly === 'known' ? '1' : '0');
    el.style.setProperty('--swipe-miss', fly === 'missed' ? '1' : '0');
    const dir = fly === 'known' ? 1 : -1;
    el.style.transform = `translateX(${dir * 420}px) rotate(${dir * 14}deg)`;
    el.style.opacity = '0';
  }, [fly]);

  return (
    <>
      <button
        type="button"
        ref={ref}
        className={`ov__flip${flipped ? ' is-flipped' : ''}`}
        aria-label={flipped ? 'Show the question again' : 'Show the answer'}
        onPointerDown={(e) => {
          if (e.button !== 0 || fly) return;
          drag.current = { id: e.pointerId, x: e.clientX, dx: 0, active: false };
          dragged.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          d.dx = e.clientX - d.x;
          if (!d.active && Math.abs(d.dx) > 6) {
            d.active = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          if (d.active) paint(d.dx, false);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.id !== e.pointerId || !d.active) return;
          dragged.current = true;
          const width = ref.current?.offsetWidth ?? 1;
          if (Math.abs(d.dx) < width * SWIPE_SHARE) {
            paint(0, true);
            return;
          }
          onMark(d.dx > 0);
        }}
        onPointerCancel={() => {
          if (drag.current?.active) paint(0, true);
          drag.current = null;
        }}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onFlip();
        }}
      >
        <span className="ov__face ov__face--front">
          <span className="ov__front">{prompt}</span>
        </span>
        <span className="ov__face ov__face--back">
          <span className="ov__back-prompt">{prompt}</span>
          <span className="ov__front">{answer}</span>
        </span>
        <span className="ov__stamp ov__stamp--ok" aria-hidden="true">
          knew it
        </span>
        <span className="ov__stamp ov__stamp--miss" aria-hidden="true">
          missed it
        </span>
      </button>
      <div className="ov__actions">
        {flipped ? (
          <>
            <button type="button" className="rt-btn rt-btn--sm ov__grade ov__grade--miss" onClick={() => onMark(false)}>
              <span className="ov__key">1</span>
              <span>missed it</span>
            </button>
            <button type="button" className="rt-btn rt-btn--sm ov__grade ov__grade--knew" onClick={() => onMark(true)}>
              <span className="ov__key">2</span>
              <span>knew it</span>
            </button>
          </>
        ) : (
          <button type="button" className="rt-btn rt-btn--sm rt-btn--primary ov__show" onClick={onFlip}>
            <span className="ov__key">space</span>
            <span>flip</span>
          </button>
        )}
      </div>
      <div className="ov__hint ov__hint--center">Swipe right if you knew it, left if not.</div>
    </>
  );
}

/**
 * The typed answer. A wrong one shows the difference, then has to be typed
 * out correctly before moving on (as in Write); an empty Enter there skips it.
 */
function TypedAnswer({
  phase,
  expected,
  specialChars,
  onCheck,
  onRetyped,
  onOverride,
}: {
  phase: Phase;
  expected: string;
  specialChars: string[];
  onCheck: (given: string) => void;
  onRetyped: () => void;
  onOverride: () => void;
}) {
  const [value, setValue] = useState('');
  const [retype, setRetype] = useState('');
  const [shake, setShake] = useState(0);
  const answerRef = useRef<HTMLInputElement>(null);
  const retypeRef = useRef<HTMLInputElement>(null);
  const shownAt = useRef(performance.now());

  useEffect(() => {
    if (phase.kind === 'wrong') {
      shownAt.current = performance.now();
      retypeRef.current?.focus();
    }
  }, [phase.kind]);

  if (phase.kind === 'wrong') {
    const diff = phase.given !== null ? computeDiff(phase.given, expected) : null;
    return (
      <div className="ov__typed">
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!retype.trim()) {
              if (performance.now() - shownAt.current > STRAY_ENTER_MS) onRetyped();
              return;
            }
            if (isMatch(retype, expected)) onRetyped();
            else setShake((n) => n + 1);
          }}
        >
          <input
            id="ov-answer"
            ref={retypeRef}
            key={shake}
            className={`rt-input ov__input ov__input--retype${shake ? ' is-shaking' : ''}`}
            autoComplete="off"
            spellCheck={false}
            placeholder="type it out to go on — Enter on empty skips"
            aria-label="Type the right answer"
            value={retype}
            maxLength={2000}
            onChange={(e) => setRetype(e.target.value)}
          />
        </form>
        <SpecialKeys chars={specialChars} value={retype} onChange={setRetype} inputRef={retypeRef} />
        <div className="ov__hint">
          <span className="ov__bad">{phase.given === null ? 'No worries.' : 'Not quite.'}</span> It comes back at the end
          of the round.
          {phase.given !== null && (
            <button type="button" className="ov__link" onClick={onOverride}>
              I was right
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="ov__typed">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCheck(value);
        }}
      >
        <input
          id="ov-answer"
          ref={answerRef}
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
      {phase.kind === 'ask' && <SpecialKeys chars={specialChars} value={value} onChange={setValue} inputRef={answerRef} />}
      <div className="ov__hint">
        {phase.kind === 'ask' ? (
          'Enter checks. Enter on an empty box means no idea.'
        ) : (
          <span className="ov__good">Right! Enter skips the pause.</span>
        )}
      </div>
    </div>
  );
}

function RoundEnd({
  done,
  right,
  empty,
  noSets,
  onAgain,
  onAdd,
}: {
  done: number;
  right: number;
  empty: boolean;
  noSets: boolean;
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
          <p className="ov__big">{noSets ? 'No sets yet.' : 'No cards in this set yet.'}</p>
          <p className="rt-small rt-ink-faint">
            {noSets ? 'Make one in the main window, or add a card here.' : 'Add some, or pick another set above.'}
          </p>
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
            <span className="ov__key">R</span>
            <span>another round</span>
          </button>
        )}
        <button type="button" className="rt-btn rt-btn--sm" onClick={onAdd}>
          <span className="ov__key">A</span>
          <span>add a card</span>
        </button>
      </div>
    </div>
  );
}

function QuickAdd({ onDone, preferSet }: { onDone: () => void; preferSet: number | null }) {
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
        setSetId(preferSet ?? last ?? list[0]?.id ?? null);
      })
      .catch((err) => setError(asApiError(err).message));
    termRef.current?.focus();
  }, [preferSet]);

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
