
import Link from '@/components/Link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
          <Deck set={set} />
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
/** The card's flight off screen before the next one appears. */
const FLY_MS = 180;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

// --- deck session persistence ---

function deckStorageKey(setId: number) {
  return `fc-deck-session-${setId}`;
}

function saveDeckToStorage(setId: number, deck: DeckState) {
  try {
    if (deck.done) {
      localStorage.removeItem(deckStorageKey(setId));
    } else {
      localStorage.setItem(deckStorageKey(setId), JSON.stringify(deck));
    }
  } catch {}
}

function loadDeckFromStorage(setId: number): DeckState | null {
  try {
    const raw = localStorage.getItem(deckStorageKey(setId));
    if (!raw) return null;
    return JSON.parse(raw) as DeckState;
  } catch {
    return null;
  }
}

function clearDeckFromStorage(setId: number) {
  try {
    localStorage.removeItem(deckStorageKey(setId));
  } catch {}
}

function Deck({ set }: { set: SetDTO }) {
  const cards = set.cards;
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const allIds = useCallback(() => cards.map((card) => card.id), [cards]);

  const [deck, setDeck] = useState<DeckState>(() => {
    if (typeof window !== 'undefined') {
      const saved = loadDeckFromStorage(set.id);
      if (saved && !saved.done) {
        const currentIds = new Set(cards.map((c) => c.id));
        // Ensure saved deck cards belong to this set
        const valid = saved.order.length > 0 && saved.order.every((id) => currentIds.has(id));
        if (valid) return saved;
      }
    }
    return startDeck(allIds(), false);
  });
  const [flipped, setFlipped] = useState(false);
  const [firstSide, setFirstSide] = useState<'term' | 'definition'>(() => {
    if (typeof window === 'undefined') return 'term';
    try {
      const saved = localStorage.getItem('fc-first-side');
      if (saved === 'definition' || saved === 'term') return saved;
    } catch {}
    return 'term';
  });

  // Save deck changes to localStorage
  useEffect(() => {
    saveDeckToStorage(set.id, deck);
  }, [deck, set.id]);

  const toggleFirstSide = useCallback(() => {
    setFirstSide((curr) => {
      const next = curr === 'term' ? 'definition' : 'term';
      try {
        localStorage.setItem('fc-first-side', next);
      } catch {}
      return next;
    });
    setFlipped(false);
  }, []);

  const total = deck.order.length;
  const atEnd = deck.index === total - 1;
  const card = byId.get(currentId(deck));
  const { known, missed } = tally(deck);

  const go = useCallback((delta: -1 | 1) => {
    setDeck((d) => move(d, delta));
    setFlipped(false);
  }, []);

  const flip = useCallback(() => setFlipped((f) => !f), []);

  /** "Knew it" or "didn't know": noted, and on to the next card. */
  const markCard = useCallback((value: Mark) => {
    setDeck((d) => mark(d, value));
    setFlipped(false);
  }, []);

  // Swiping the card sorts it, as a pile of paper cards would be sorted: drag
  // it right if you knew it, left if you didn't. The card follows the finger
  // (or the mouse) and tilts, a stamp fades in to say which pile it is
  // heading for, and letting go past the line throws it off and marks it.
  // Short of the line it springs back. A press that never moved is a tap and
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
    t: number;
    dx: number;
    active: boolean;
  } | null>(null);
  const swiped = useRef(false);
  const flying = useRef(false);

  function paint(dx: number, settle: boolean) {
    const el = cardRef.current;
    if (!el) return;
    const width = el.offsetWidth || 1;
    const share = Math.max(-1, Math.min(1, dx / (width * SWIPE_SHARE)));
    el.style.transition = settle ? 'transform 0.2s ease' : 'none';
    el.style.transform = dx === 0 ? '' : `translateX(${dx}px) rotate(${dx / 28}deg)`;
    el.style.setProperty('--swipe-ok', String(Math.max(0, share)));
    el.style.setProperty('--swipe-miss', String(Math.max(0, -share)));
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
    if (flying.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, dx: 0, active: false };
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
    paint(dx, false);
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.active) return;
    // Any drag, even one that springs back, is not a tap.
    swiped.current = true;
    const el = cardRef.current;
    const width = el?.offsetWidth ?? 1;
    const speed = Math.abs(d.dx) / Math.max(1, e.timeStamp - d.t);
    if (Math.abs(d.dx) < width * SWIPE_SHARE && speed < FLICK_PX_PER_MS) {
      paint(0, true);
      return;
    }
    fling(d.dx > 0 ? 'known' : 'missed');
  }

  /** Sends the card off to its pile, green or red, then records it. Swipes and the 1 / 2 keys both land here. */
  function fling(value: Mark) {
    if (flying.current) return;
    if (prefersReducedMotion()) {
      paint(0, false);
      markCard(value);
      return;
    }
    flying.current = true;
    paint((value === 'known' ? 1 : -1) * window.innerWidth, true);
    window.setTimeout(() => {
      flying.current = false;
      // The next card mounts fresh (the button is keyed by card), so there is
      // nothing to reset — unless this was the last card and the same
      // element stays up for the summary's sake.
      paint(0, false);
      markCard(value);
    }, FLY_MS);
  }
  const flingRef = useRef(fling);
  flingRef.current = fling;

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
    clearDeckFromStorage(set.id);
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
          <span className="fc-writebar__stat--ok" title="Knew it">
            <IconCheck size={14} />
            {known}
          </span>
          <span className="fc-writebar__stat--miss" title="Didn't know">
            <IconClose size={14} />
            {missed}
          </span>
          <ResetButton
            question="reset round?"
            title="Start the cards over from the first one, with no marks"
            onReset={restart}
          />
        </span>
      </div>

      {/* Keyed by card: a new card mounts face-up rather than animating back
          from the previous card's answer, which would flash this one's. */}
      <button
        key={`${card.id}-${firstSide}`}
        ref={claimTouch}
        type="button"
        className={`fc-flip${flipped ? ' is-flipped' : ''}`}
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

      {/* Pressed when coming back to a card that already has that mark. */}
      <div className="fc-marks">
        <button
          type="button"
          className={`rt-btn fc-mark fc-mark--miss${cardMark === 'missed' ? ' is-on' : ''}`}
          aria-pressed={cardMark === 'missed'}
          onClick={() => markCard('missed')}
        >
          <IconClose />
          Didn&apos;t know
        </button>
        <button
          type="button"
          className={`rt-btn fc-mark fc-mark--ok${cardMark === 'known' ? ' is-on' : ''}`}
          aria-pressed={cardMark === 'known'}
          onClick={() => markCard('known')}
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
      <h2 className="fc-panel__title">
        {finished ? 'you knew every card' : `round ${deck.round} done`}
      </h2>

      <dl className="fc-stats">
        <div>
          <dt>cards</dt>
          <dd>{deck.pile.length}</dd>
        </div>
        <div>
          <dt>knew it</dt>
          <dd>{known}</dd>
        </div>
        <div>
          <dt>to go again</dt>
          <dd className={left > 0 ? 'fc-stats__miss' : undefined}>{left}</dd>
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
