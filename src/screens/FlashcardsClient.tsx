
import Link from '@/components/Link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { usePref } from '@/lib/app/prefs';
import { motionLevel } from '@/lib/app/theme';
import { forget, primed } from '@/lib/app/prime';
import { clearSession, errorMessage, loadDeck, saveDeck } from '@/lib/flashcards/client';
import {
  currentId,
  mark,
  move,
  nextRound,
  startDeck,
  tally,
  toggleShuffle,
  type Deck as DeckState,
  type Mark,
} from '@/lib/flashcards/deck';
import { plural } from '@/lib/flashcards/format';
import type { SetDTO } from '@/lib/flashcards/types';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconClose,
  IconShuffle,
} from '@/components/flashcards/FlashcardIcons';
import { SetLoadState, useSet } from '@/components/flashcards/useSet';
import { StudyArea, StudyHeader, enterIsForFocus } from '@/components/flashcards/StudyHeader';
import { ResetButton } from '@/components/flashcards/ResetButton';
import { CountUp } from '@/components/motion/CountUp';
import { Confetti } from '@/components/motion/Confetti';
import { MoreControls } from '@/components/flashcards/overlaySlot';

export function FlashcardsClient({ setId }: { setId: number }) {
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
      <StudyHeader set={set} mode="cards" />
      {set.cards.length === 0 ? (
        <div className="rt-empty">
          No cards to study. <Link href={`/flashcards/${set.id}/edit`}>Add some</Link> first.
        </div>
      ) : (
        <StudyArea>
          <SavedDeck set={set} />
        </StudyArea>
      )}
    </main>
  );
}

/** Long text drops a size so a paragraph-length definition still fits the card. */
function sizeClass(text: string): string {
  if (text.length > 280) return ' fc-flip__text--xs';
  if (text.length > 90) return ' fc-flip__text--sm';
  return '';
}

/** Sideways travel before a press on the card becomes a drag rather than a tap. */
const DRAG_START_PX = 10;
/**
 * How steep a drag's first movement may be and still count as sideways:
 * up to 1.5 px vertical per px horizontal, about 56° from level. A thumb
 * swiping across a card rarely moves dead level; a scroll is near vertical.
 */
const SIDEWAYS_SLOPE = 1.5;

function isSideways(dx: number, dy: number): boolean {
  return Math.abs(dx) * SIDEWAYS_SLOPE >= Math.abs(dy);
}
/** How far a drag has to go to count, as a share of the card's width (or a fast flick). */
const SWIPE_SHARE = 0.28;
const FLICK_PX_PER_MS = 0.6;
/** A mark made with a button or key: the stamp lands on the card first. */
const STAMP_MS = 170;
/**
 * Then the card is thrown off to its pile and the next one is dealt. A
 * thrown card keeps the speed and direction the hand gave it; one let go
 * slowly (or sent by a button) picks up speed so it clears the screen in
 * about this long. A hard throw goes faster.
 */
const THROW_MS = 340;
/** The share of the way off the screen at which the thrown card is gone and the next one dealt. */
const THROW_DONE = 0.85;
/** How quickly a slow card picks up speed, in px/ms². */
const THROW_ACCEL = 0.012;
/** The card follows the hand up and down at this share: held on a table, not lifted off it. */
const Y_FOLLOW = 0.5;
/** Only the last stretch of a drag says how fast the hand was moving when it let go. */
const SPEED_WINDOW_MS = 90;

/** Where the dragged card is drawn, sampled to know its speed on release. */
type Sample = { x: number; y: number; t: number };

function releaseSpeed(samples: Sample[], now: number): { vx: number; vy: number } {
  const recent = samples.filter((s) => now - s.t <= SPEED_WINDOW_MS);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const a = recent[0];
  const b = recent[recent.length - 1];
  const dt = Math.max(8, b.t - a.t);
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

// --- the saved round ---

/**
 * The deck carries on from the round saved for this set (by this window or
 * the other one), so it is read before the deck appears: starting a fresh
 * round meanwhile would save over it.
 */
function SavedDeck({ set }: { set: SetDTO }) {
  const [saved, setSaved] = useState<{ deck: DeckState | null } | null>(() => primed(`deck:${set.id}`));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    // Read by the link that led here: shown at once, and not read again
    // (the round could only have changed through this screen since).
    const had = primed(`deck:${set.id}`);
    forget(`deck:${set.id}`);
    if (had && attempt === 0) return;
    setSaved(null);
    setError(null);
    loadDeck(
      set.id,
      set.cards.map((card) => card.id),
    )
      .then((deck) => live && setSaved({ deck }))
      .catch((err: unknown) => live && setError(errorMessage(err, 'Could not load the round.')));
    return () => {
      live = false;
    };
  }, [set, attempt]);

  if (error) {
    return (
      <div className="rt-section">
        <div className="rt-note rt-note--err">{error}</div>
        <div className="rt-btnrow" style={{ marginTop: 16 }}>
          <button type="button" className="rt-btn" onClick={() => setAttempt((n) => n + 1)}>
            try again
          </button>
        </div>
      </div>
    );
  }
  if (!saved) {
    return (
      <div className="fc-loading" aria-busy="true" aria-label="Loading the round">
        <div className="fc-skel" style={{ height: 220 }} />
      </div>
    );
  }
  return <Deck set={set} saved={saved.deck} />;
}

/** The deck for one set. `persist={false}` (the motion lab) keeps the round to itself. */
export function Deck({ set, saved, persist = true }: { set: SetDTO; saved: DeckState | null; persist?: boolean }) {
  const cards = set.cards;
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const allIds = useCallback(() => cards.map((card) => card.id), [cards]);

  const [deck, setDeck] = useState<DeckState>(() => saved ?? startDeck(allIds(), false));
  const [flipped, setFlipped] = useState(false);
  const [firstSide, setFirstSide] = usePref('cardsFirstSide');
  // Motion only, none of it saved: the stamp on the card being marked, the
  // stack behind it moving up while it flies, how the shown card arrived
  // (dealt after a mark, or slid in by prev / next) and the flip's lift.
  const [stamp, setStamp] = useState<Mark | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [arrival, setArrival] = useState<{ how: 'dealt' | 'next' | 'prev'; n: number } | null>(null);
  const [lifts, setLifts] = useState(0);

  // Kept on every change, without waiting for it.
  useEffect(() => {
    if (persist) saveDeck(set.id, deck);
  }, [deck, set.id, persist]);

  const toggleFirstSide = useCallback(() => {
    setFirstSide(firstSide === 'term' ? 'definition' : 'term');
    setFlipped(false);
  }, [firstSide, setFirstSide]);

  const total = deck.order.length;
  const atEnd = deck.index === total - 1;
  const card = byId.get(currentId(deck));
  const { known, missed } = tally(deck);

  const go = useCallback((delta: -1 | 1) => {
    setDeck((d) => move(d, delta));
    setFlipped(false);
    setLifts(0);
    setArrival((a) => ({ how: delta > 0 ? 'next' : 'prev', n: (a?.n ?? 0) + 1 }));
  }, []);

  const flip = useCallback(() => {
    setFlipped((f) => !f);
    setLifts((n) => n + 1);
  }, []);

  /** "Knew it" or "didn't know": noted, and on to the next card. */
  const markCard = useCallback((value: Mark) => {
    setDeck((d) => mark(d, value));
    setFlipped(false);
    setLifts(0);
    setArrival((a) => ({ how: 'dealt', n: (a?.n ?? 0) + 1 }));
  }, []);

  // Swiping the card sorts it, as a pile of paper cards would be sorted: drag
  // it right if you knew it, left if you didn't. The card follows the finger
  // (or the mouse) and tilts, a stamp fades in to say which pile it is
  // heading for, and letting go past the line (or flicking it) throws it off
  // and marks it: it flies on the way the hand sent it, at that speed. Short
  // of the line it springs back. A press that never moved is a tap and
  // flips the card; a drag that starts upward or downward is left to the
  // page, which scrolls.
  //
  // Which of the two a drag is gets decided once, by its first movement.
  // After that a sideways drag keeps the card however far the finger
  // wanders up or down: the browser would otherwise take any vertical drift
  // as the start of a scroll and cancel the drag (see claimTouch).
  //
  // The drag is written straight to the element's style rather than through
  // state, so following the finger does not re-render the deck every frame.
  const cardRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
    samples: Sample[];
    active: boolean;
  } | null>(null);
  const swiped = useRef(false);
  /** The mark on its way, and how to stop its motion: a new mark finishes it at once. */
  const flying = useRef<{ value: Mark; timers: number[]; frame: number } | null>(null);
  /** A mark made while another card was still in the air: the next card's. */
  const pending = useRef<Mark | null>(null);
  /** Where the card is drawn right now (dragged or in the air). */
  const pos = useRef({ x: 0, y: 0 });

  /** Draws the card at (dx, dy). `settle` springs it back there; `turn` is its tilt. */
  function paint(dx: number, settle: boolean, dy = 0, turn = dx / 28) {
    const el = cardRef.current;
    if (!el) return;
    pos.current = { x: dx, y: dy };
    const width = el.offsetWidth || 1;
    const share = Math.max(-1, Math.min(1, dx / (width * SWIPE_SHARE)));
    el.style.transition = settle ? 'transform 0.38s cubic-bezier(0.25, 1.35, 0.45, 1)' : 'none';
    el.style.transform = dx === 0 && dy === 0 ? '' : `translate(${dx}px, ${dy}px) rotate(${turn}deg)`;
    el.style.opacity = '';
    el.style.setProperty('--swipe-ok', String(Math.max(0, share)));
    el.style.setProperty('--swipe-miss', String(Math.max(0, -share)));
  }

  /**
   * Throws the card off the screen from wherever it is, at the speed it
   * already has: it keeps a swipe's momentum and its drift up or down, and
   * only speeds up when it is too slow to clear the screen in THROW_MS.
   * Calls `done` once it is off.
   */
  function throwCard(dir: 1 | -1, v: { vx: number; vy: number }, done: () => void): number {
    const el = cardRef.current;
    if (!el) {
      done();
      return 0;
    }
    const start = { ...pos.current };
    const turn0 = start.x / 28;
    // How far it has to go: past the window's edge, with room for its tilt.
    const rect = el.getBoundingClientRect();
    const margin = rect.height * 0.35 + 24;
    const travel = dir > 0 ? window.innerWidth - rect.left + margin : rect.right + margin;
    const cruise = travel / THROW_MS;
    let vx = v.vx;
    const vy = Math.max(-1.6, Math.min(1.6, v.vy));
    let x = start.x;
    let y = start.y;
    let last = performance.now();
    const began = last;
    const step = (now: number) => {
      const dt = Math.min(32, now - last);
      last = now;
      if (dir * vx < cruise) vx = dir * Math.min(cruise, dir * vx + THROW_ACCEL * dt);
      x += vx * dt;
      y += vy * dt;
      const gone = dir * (x - start.x) / travel;
      const width = el.offsetWidth || 1;
      const share = Math.max(-1, Math.min(1, x / (width * SWIPE_SHARE)));
      el.style.transition = 'none';
      el.style.transform = `translate(${x}px, ${y}px) rotate(${turn0 + (x - start.x) / 46}deg)`;
      // It fades at the window's edge, and the next card is dealt as it
      // goes, not after a wait on an empty deck.
      el.style.opacity = String(Math.max(0, Math.min(1, (THROW_DONE - gone) / 0.3)));
      el.style.setProperty('--swipe-ok', String(Math.max(0, share)));
      el.style.setProperty('--swipe-miss', String(Math.max(0, -share)));
      if (gone >= THROW_DONE || now - began > THROW_MS * 2.5) {
        done();
        return;
      }
      if (flying.current) flying.current.frame = requestAnimationFrame(step);
    };
    return requestAnimationFrame(step);
  }

  // Touch only. Cancelling a touchmove is the one way to stop the browser
  // turning the gesture into a scroll, and React's touch listeners are
  // passive, so this one is attached by hand (React 19 runs the returned
  // cleanup when the card unmounts). touch-action: pan-y alone is not enough:
  // it lets the page scroll vertically, and a sideways drag that drifts
  // vertically is still a vertical movement.
  const claimTouch = useCallback((el: HTMLButtonElement | null) => {
    cardRef.current = el;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      const d = drag.current;
      const touch = e.touches[0];
      if (!d || !touch || !e.cancelable) return;
      // Ours once it is a drag, or when its first movement is sideways.
      if (d.active || isSideways(touch.clientX - d.x, touch.clientY - d.y)) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    swiped.current = false;
    if (flying.current) {
      // A press while a card is still in the air lands it; this press
      // belonged to that card, so it starts nothing on the next one.
      landFlight();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, samples: [], active: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.active) {
      // A scroll that started on the card: let it go. Once the drag is
      // active, up-and-down movement no longer matters.
      if (Math.abs(dy) > DRAG_START_PX && !isSideways(dx, dy)) {
        drag.current = null;
        return;
      }
      if (Math.abs(dx) < DRAG_START_PX || !isSideways(dx, dy)) return;
      d.active = true;
      // Keep the pointer's moves coming even when it leaves the card.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone; the drag still ends on pointerup */
      }
    }
    d.dx = dx;
    d.dy = dy * Y_FOLLOW;
    const now = performance.now();
    d.samples.push({ x: d.dx, y: d.dy, t: now });
    if (d.samples.length > 12) d.samples.shift();
    paint(d.dx, false, d.dy);
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.active) return;
    // Any drag, even one that springs back, is not a tap.
    swiped.current = true;
    const el = cardRef.current;
    const width = el?.offsetWidth ?? 1;
    const v = releaseSpeed(d.samples, performance.now());
    // A flick decides by the way it was going; a slow release by where the
    // card is. Short of the line and not flicked, it springs back.
    let value: Mark | null = null;
    if (Math.abs(v.vx) >= FLICK_PX_PER_MS) value = v.vx > 0 ? 'known' : 'missed';
    else if (Math.abs(d.dx) >= width * SWIPE_SHARE) value = d.dx > 0 ? 'known' : 'missed';
    if (value === null) {
      paint(0, true);
      return;
    }
    fling(value, v);
  }

  /**
   * Sends the card off to its pile, then records it. Swipes, the mark
   * buttons and the 1 / 2 keys all land here. A mark from a button or key
   * first stamps the card (a swipe has shown its stamp all along), the card
   * takes the hit, then is thrown off while the stack behind moves up and
   * the next card is dealt. A swiped card goes on at the speed the swipe
   * gave it (`speed`, px/ms). Nothing waits for it: a mark made meanwhile
   * lands the flying one at once and goes to the next card.
   */
  function fling(value: Mark, speed?: { vx: number; vy: number }) {
    if (flying.current) {
      landFlight();
      pending.current = value;
      return;
    }
    if (motionLevel() === 'off') {
      markCard(value);
      return;
    }
    const dir = value === 'known' ? 1 : -1;
    const el = cardRef.current;
    const dragged = !!el && el.style.transform !== '';
    const flight = { value, timers: [] as number[], frame: 0 };
    flying.current = flight;
    if (!dragged) setStamp(value);
    const away = () => {
      setAdvancing(true);
      // From a button or key the card sets off gently, lifting a little.
      flight.frame = throwCard(dir, speed ?? { vx: dir * 0.5, vy: -0.2 }, landFlight);
    };
    // A swiped card is already moving: it goes on from the same frame.
    if (dragged) away();
    else flight.timers.push(window.setTimeout(away, STAMP_MS));
  }
  /** The flying card reaches its pile: recorded, and the next one is up. */
  function landFlight() {
    const flight = flying.current;
    if (!flight) return;
    flight.timers.forEach((t) => window.clearTimeout(t));
    cancelAnimationFrame(flight.frame);
    flying.current = null;
    setStamp(null);
    setAdvancing(false);
    // The flown card is left where it is, faded out: the next card mounts
    // fresh (the button is keyed by card) and the old one goes. Putting it
    // back here would show it in the next card's place, its green or red
    // fading, until React gets round to removing it. An element that stays
    // is put back by the layout effect below, before anything is drawn.
    markCard(flight.value);
  }
  // After a mark, the card shown is new, or the same element put back in
  // place (a card that stays up has nothing to fly from).
  useLayoutEffect(() => {
    if (!flying.current && !drag.current) paint(0, false);
  }, [deck.index, deck.round, deck.done]);
  const flingRef = useRef(fling);
  flingRef.current = fling;

  // A mark made while the last card was still in the air belongs to this one.
  useEffect(() => {
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    flingRef.current(value);
  }, [deck.index, deck.round]);

  useEffect(
    () => () => {
      flying.current?.timers.forEach((t) => window.clearTimeout(t));
      if (flying.current) cancelAnimationFrame(flying.current.frame);
    },
    [],
  );

  function onPointerCancel() {
    if (drag.current?.active) paint(0, true);
    drag.current = null;
  }

  function onCardClick() {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    flip();
  }

  function restart() {
    if (persist) clearSession(set.id, 'cards');
    setDeck((d) => startDeck(allIds(), d.shuffled));
    setFlipped(false);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      switch (e.key) {
        case ' ':
        case 'Enter':
        case 'ArrowUp':
        case 'ArrowDown':
          // Cancelling keydown also stops a focused button (say, "next", just
          // clicked) from treating the space bar as a press of itself.
          e.preventDefault();
          if (!e.repeat) flip();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          go(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          go(1);
          break;
        case '1':
        case '2':
          // Held down, a mark key would run through the rest of the pile.
          e.preventDefault();
          if (!e.repeat) flingRef.current(e.key === '1' ? 'missed' : 'known');
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flip, go, markCard]);

  if (deck.done || !card) {
    return (
      <RoundSummary
        deck={deck}
        setId={set.id}
        onNextRound={() => {
          setDeck((d) => nextRound(d));
          setFlipped(false);
        }}
        onRestart={restart}
      />
    );
  }

  const frontLabel = firstSide === 'term' ? 'term' : 'definition';
  const backLabel = firstSide === 'term' ? 'definition' : 'term';
  const frontText = firstSide === 'term' ? card.term : card.definition;
  const backText = firstSide === 'term' ? card.definition : card.term;
  const face = flipped ? backText : frontText;
  const cardMark = deck.marks[card.id];

  return (
    <div className="fc-deck">
      <div className="fc-progress">
        <span className="fc-progress__count" aria-live="polite">
          {deck.round > 1 && `round ${deck.round} · `}
          {deck.index + 1} / {total}
        </span>
        <div className="fc-meter" aria-hidden="true">
          <span
            className="fc-meter__fill"
            style={{ width: `${((deck.index + 1) / total) * 100}%` }}
          />
        </div>
        <span className="fc-deck__tally">
          {/* Keyed by the count: a new number rolls in, and its mark pops. */}
          <span className="fc-writebar__stat--ok" title="Knew it">
            <span key={known} className={known ? 'fx-pop-icon' : undefined}>
              <IconCheck size={14} />
            </span>
            <span className="fx-roll">
              <span key={known}>{known}</span>
            </span>
          </span>
          <span className="fc-writebar__stat--miss" title="Didn't know">
            <span key={missed} className={missed ? 'fx-pop-icon' : undefined}>
              <IconClose size={14} />
            </span>
            <span className="fx-roll">
              <span key={missed}>{missed}</span>
            </span>
          </span>
          <MoreControls>
            <ResetButton
              question="reset round?"
              title="Start the cards over from the first one, with no marks"
              onReset={restart}
            />
          </MoreControls>
        </span>
      </div>

      {/* The cards still to come lie under this one, a little askew; while a
          marked card flies off they move up a place. */}
      <div
        className={`fc-stack${advancing ? ' is-advancing' : ''}${
          arrival?.how === 'dealt' ? ` is-dealt-${arrival.n % 2 ? 'a' : 'b'}` : ''
        }`}
      >
        {deck.index + 2 < total && <span className="fc-stack__back is-2" aria-hidden="true" />}
        {deck.index + 1 < total && <span className="fc-stack__back is-1" aria-hidden="true" />}
      {/* Keyed by card: a new card mounts face-up rather than animating back
          from the previous card's answer, which would flash this one's. */}
      <button
        key={`${card.id}-${firstSide}`}
        ref={claimTouch}
        type="button"
        className={`fc-flip${flipped ? ' is-flipped' : ''}${stamp ? ` is-stamped is-stamped--${stamp}` : ''}${
          lifts ? ` is-lift-${lifts % 2 ? 'a' : 'b'}` : ''
        }${arrival && arrival.how !== 'dealt' ? ` is-from-${arrival.how}` : ''}${
          arrival?.how === 'dealt' ? ' is-dealt' : ''
        }`}
        onClick={onCardClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        aria-label={`${flipped ? backLabel : frontLabel}: ${face}. Activate to flip.`}
      >
        <span className="fc-flip__inner">
          <span className="fc-flip__face fc-flip__face--front" aria-hidden={flipped}>
            <span className="fc-flip__side">{frontLabel}</span>
            <span className={`fc-flip__text${sizeClass(frontText)}`}>{frontText}</span>
          </span>
          <span className="fc-flip__face fc-flip__face--back" aria-hidden={!flipped}>
            <span className="fc-flip__side">{backLabel}</span>
            <span className={`fc-flip__text${sizeClass(backText)}`}>
              {backText}
            </span>
          </span>
        </span>
        <span className="fc-swipehint fc-swipehint--ok" aria-hidden="true">
          <IconCheck size={18} />
          knew it
        </span>
        <span className="fc-swipehint fc-swipehint--miss" aria-hidden="true">
          <IconClose size={18} />
          didn&apos;t know
        </span>
      </button>
      </div>

      {/* Pressed when coming back to a card that already has that mark. */}
      <div className="fc-marks">
        <button
          type="button"
          className={`rt-btn fc-mark fc-mark--miss${cardMark === 'missed' ? ' is-on' : ''}`}
          aria-pressed={cardMark === 'missed'}
          onClick={() => flingRef.current('missed')}
        >
          <IconClose />
          Didn&apos;t know
        </button>
        <button
          type="button"
          className={`rt-btn fc-mark fc-mark--ok${cardMark === 'known' ? ' is-on' : ''}`}
          aria-pressed={cardMark === 'known'}
          onClick={() => flingRef.current('known')}
        >
          <IconCheck />
          Knew it
        </button>
      </div>

      <div className="fc-controls">
        <button
          type="button"
          className="rt-btn"
          onClick={() => go(-1)}
          disabled={deck.index === 0}
          aria-label="Previous card"
        >
          <IconArrowLeft />
          <span className="fc-controls__word">Prev</span>
        </button>
        <button type="button" className="rt-btn fc-controls__flip" onClick={flip}>
          flip
        </button>
        <button
          type="button"
          className="rt-btn"
          onClick={() => go(1)}
          disabled={atEnd}
          aria-label="Next card"
        >
          <span className="fc-controls__word">Next</span>
          <IconArrowRight />
        </button>
      </div>

      <div className="fc-deckbar">
        <MoreControls>
          <button
            type="button"
            className={`rt-btn rt-btn--sm fc-toggle${deck.shuffled ? ' is-on' : ''}`}
            aria-pressed={deck.shuffled}
            onClick={() => setDeck((d) => toggleShuffle(d))}
          >
            <IconShuffle size={15} />
            Shuffle {deck.shuffled ? 'on' : 'off'}
          </button>
          <button
            type="button"
            className="rt-btn rt-btn--sm fc-toggle is-on"
            onClick={toggleFirstSide}
            title="Switch whether term or definition is shown first"
          >
            {firstSide === 'term' ? 'Front: term' : 'Front: definition'}
          </button>
        </MoreControls>
        <span className="fc-keys rt-small">
          <span className="fc-keys__keys">
            <span className="rt-kbd">enter</span> or <span className="rt-kbd">space</span> flip ·{' '}
            <span className="rt-kbd">
              <IconArrowLeft size={12} />
            </span>{' '}
            <span className="rt-kbd">
              <IconArrowRight size={12} />
            </span>{' '}
            move · <span className="rt-kbd">1</span>{' '}
            <span className="rt-kbd">2</span> didn&apos;t know / knew it
          </span>
          <span className="fc-keys__touch">
            tap to flip · swipe right if you knew it, left if not
          </span>
        </span>
      </div>

      {atEnd && (
        <div className="rt-note fc-endnote">
          <div className="rt-note__title">LAST CARD</div>
          <div className="rt-small">Mark it to finish the round.</div>
          <div className="rt-btnrow fc-gap-sm">
            <button type="button" className="rt-btn rt-btn--sm" onClick={restart}>
              start over
            </button>
            <Link href={`/flashcards/${set.id}/write`} className="rt-btn rt-btn--sm">
              test yourself in write mode
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// --- end of a round ---

function RoundSummary({
  deck,
  setId,
  onNextRound,
  onRestart,
}: {
  deck: DeckState;
  setId: number;
  onNextRound: () => void;
  onRestart: () => void;
}) {
  const { known, missed, left } = tally(deck);
  const unmarked = left - missed;
  const finished = left === 0;

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
  }, [finished, onNextRound, onRestart]);

  return (
    <div className="fc-panel fc-summary" role="status">
      {finished && <Confetti />}
      <h2 className="fc-panel__title">
        {finished ? 'you knew every card' : `round ${deck.round} done`}
      </h2>

      <dl className="fc-stats">
        <div>
          <dt>cards</dt>
          <dd>
            <CountUp from={0} value={deck.pile.length} />
          </dd>
        </div>
        <div>
          <dt>knew it</dt>
          <dd>
            <CountUp from={0} value={known} delay={120} />
          </dd>
        </div>
        <div>
          <dt>to go again</dt>
          <dd className={left > 0 ? 'fc-stats__miss' : undefined}>
            <CountUp from={0} value={left} delay={240} />
          </dd>
        </div>
      </dl>

      {unmarked > 0 && (
        <p className="rt-small fc-setup__rules">
          That includes {plural(unmarked, 'card')} you moved past without marking.
        </p>
      )}

      <div className="rt-btnrow">
        {!finished && (
          <button type="button" className="rt-btn rt-btn--primary" onClick={onNextRound} autoFocus>
            study again · {plural(left, 'card')}
          </button>
        )}
        <button
          type="button"
          className={`rt-btn${finished ? ' rt-btn--primary' : ''}`}
          onClick={onRestart}
          autoFocus={finished}
        >
          start over
        </button>
        <Link href={`/flashcards/${setId}/write`} className="rt-btn">
          test yourself in write mode
        </Link>
      </div>
    </div>
  );
}
