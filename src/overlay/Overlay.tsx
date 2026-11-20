// The hotkey overlay: the main window's own Flashcards, Write, Learn and Test
// screens for the set you pick, in a compact frame, plus a quick-add form.
// It is for a few quick answers, so it shows little: one header line (the
// modes as tabs, the set as a button, a "⋯" menu, open in the main window,
// close) and only what a screen needs to answer; the screens' other controls
// sit in the "⋯" menu (MoreControls), and Write and Learn skip their setup
// screens.
//
// It is the same session, not a copy: each mode keeps its place per set in
// the database (study_sessions), which both windows share, so a round started
// in the main window carries on here and the other way round. Answers go to
// the same database. Test is the exception: a test is not saved (TestClient),
// so the overlay's test is its own. Every write is announced as a data
// change, and a window that was in the background picks up the other's
// changes when it comes back (the overlay when the hotkey opens it, the main
// window when it is focused). Links to the set page or the editor open the
// main window. Esc or a click elsewhere hides the overlay.

// Showing and hiding are animated here, not by the OS: Rust shows the window
// with the panel still invisible and sends "overlay-open"; on "overlay-close"
// the panel plays its exit and, once a frame without it has been painted,
// tells Rust the window can go. So every show starts from an empty frame.
//
// The window is as tall as the panel's content (useFitWindow): Rust zooms it
// for the screen it is on and never makes it shorter than that, so nothing
// in the panel has to be scrolled to. Test is the exception: a paper can be
// long, so Test keeps one fixed height (setup, paper and score alike) and
// the paper scrolls inside it. The header's menus float over the panel; the
// panel grows to hold one on a short screen.

import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';

import { announceDataChange, useDataVersion } from '@/lib/app/events';
import { formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import { hideOverlay, openMain, overlayClosed, overlayFit, overlayState } from '@/lib/app/native';
import { studySetFrom, usePref, type OverlayMode } from '@/lib/app/prefs';
import { useSettings } from '@/lib/app/settings';
import type { SetSummaryDTO } from '@/lib/flashcards/types';
import { asApiError } from '@/lib/store/errors';
import { addCards, lastUsedSetId, listSets } from '@/lib/store/repo';
import { FlashcardsClient } from '@/screens/FlashcardsClient';
import { LearnClient } from '@/screens/LearnClient';
import { TestClient } from '@/screens/TestClient';
import { WriteClient } from '@/screens/WriteClient';
import { DialogHost } from '@/components/Dialogs';
import { SetOptions } from '@/components/flashcards/SetOptions';
import { tabStops } from '@/components/flashcards/StudyHeader';
import { OverlayContext } from '@/components/flashcards/overlaySlot';
import { groupByFolder } from '@/lib/flashcards/folders';

const MODES: { id: OverlayMode; route: string; label: string; hint: string }[] = [
  { id: 'cards', route: 'cards', label: 'Cards', hint: 'Flip a card, mark it' },
  { id: 'write', route: 'write', label: 'Write', hint: 'Type the answers' },
  { id: 'learn', route: 'learn', label: 'Learn', hint: 'Multiple choice, then typed' },
  { id: 'test', route: 'test', label: 'Test', hint: 'A test, marked at the end' },
];
const SHORTCUT = isMacPlatform() ? '⌘' : 'Ctrl+';

const MODE_PATH = /^\/flashcards\/(\d+)\/(cards|write|learn|test)$/;

/** The .ov padding round the panel, top and bottom together. */
const FRAME_PAD = 12;
/** How long a shorter panel has to stay shorter before the window follows. */
const SHRINK_AFTER_MS = 180;

/**
 * Tell Rust how tall the panel's content is, whenever that changes. Taller
 * goes at once (nothing may be cut off); shorter waits a beat, so a step that
 * swaps one screen for the next does not make the window bounce.
 */
function useFitWindow(panelRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let frame = 0;
    let shrink = 0;
    let sent = 0;
    const send = (h: number) => {
      sent = h;
      void overlayFit(h).catch(() => {});
    };
    const measure = () => {
      frame = 0;
      // The panel is as tall as its content until the window holds it back;
      // then the scrolling part says by how much. offsetHeight, not the
      // bounding box: the open animation turns and scales the panel.
      // An open header menu floats over the screen; on a short screen the
      // panel grows to hold it (the window follows), so it is never cut off.
      const pop = panel.querySelector<HTMLElement>('.ov__pop:not([hidden])');
      const popNeed = pop ? pop.offsetTop + pop.scrollHeight + 10 : 0;
      panel.style.minHeight = popNeed ? `${popNeed}px` : '';
      // A fixed-height screen (Test) scrolls on purpose: that is not asked
      // for. A fixed one is cut off by the panel instead while the window is
      // shorter, which the panel's own scrollHeight counts.
      const scroller = panel.querySelector<HTMLElement>('.ov__embed, .ov__body');
      const fixed = scroller?.classList.contains('ov__embed--fixed');
      const hidden = !scroller
        ? 0
        : fixed
          ? Math.max(0, panel.scrollHeight - panel.clientHeight)
          : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const h = panel.offsetHeight + hidden + FRAME_PAD + 1;
      if (h === sent) return;
      window.clearTimeout(shrink);
      if (h > sent) send(h);
      else shrink = window.setTimeout(() => send(h), SHRINK_AFTER_MS);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resized = new ResizeObserver(schedule);
    resized.observe(panel);
    const changed = new MutationObserver(schedule);
    changed.observe(panel, { subtree: true, childList: true, characterData: true, attributes: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(shrink);
      resized.disconnect();
      changed.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [panelRef]);
}

function WithSetId({ render }: { render: (id: number) => React.ReactNode }) {
  const { id } = useParams();
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? <>{render(n)}</> : null;
}

export function Overlay() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <OverlayFrame />
    </MemoryRouter>
  );
}

function OverlayFrame() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [view, setView] = useState<'study' | 'add'>('study');
  const [mode, setMode] = usePref('overlayMode');
  /** The header menu that is open: the set and mode switch, or "⋯". */
  const [menu, setMenu] = useState<'set' | 'more' | null>(null);
  /** Where the screens put their secondary controls (MoreControls). */
  const [moreSlot, setMoreSlot] = useState<HTMLElement | null>(null);
  const [chosenSet, setChosenSet] = usePref('overlaySet');
  const [sets, setSets] = useState<SetSummaryDTO[] | null>(null);
  const [resync, setResync] = useState(0);
  const syncedVersion = useRef(0);
  const [phase, setPhase] = useState<'gone' | 'in' | 'out'>('gone');
  /** The close being played, 0 when none. */
  const closing = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const version = useDataVersion();
  useFitWindow(panelRef);

  // Until the settings arrive, the set and mode are only defaults: the router
  // waits (a screen opened for the wrong set would start a session there).
  const setId = settings ? studySetFrom(chosenSet, sets ?? []) : null;

  useEffect(() => {
    listSets()
      .then(setSets)
      .catch(() => setSets([]));
  }, [version]);

  // Keep the router on the chosen set and mode.
  useEffect(() => {
    if (setId === null) return;
    const route = MODES.find((m) => m.id === mode)?.route ?? 'cards';
    const target = `/flashcards/${setId}/${route}`;
    if (pathname !== target) navigate(target, { replace: true });
    // pathname is read, not followed: following it would undo a mode link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId, mode, navigate]);

  // A link inside a mode: to another mode, follow it here; anywhere else
  // (the set page, the editor), open it in the main window.
  useEffect(() => {
    if (pathname === '/') return;
    const m = MODE_PATH.exec(pathname);
    if (m) {
      const next = m[2] as OverlayMode;
      if (next !== mode) setMode(next);
      return;
    }
    void openMain(pathname);
    navigate(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // The main window saved a session (or changed cards) while this one was
  // hidden: start the screen afresh from what is saved when it opens again.
  //
  // Subscribed once, reading version and view through refs. Re-subscribing on
  // every change left a gap (listen() is async) in which an "overlay-open"
  // was lost, and since every answer saves a session that gap kept coming
  // round: an open that landed in it left the panel playing its exit.
  const versionNow = useRef(version);
  versionNow.current = version;
  const viewNow = useRef(view);
  viewNow.current = view;
  useEffect(() => {
    const off = listen('overlay-open', () => {
      if (syncedVersion.current !== versionNow.current) {
        syncedVersion.current = versionNow.current;
        setResync((n) => n + 1);
      }
      closing.current = 0;
      setPhase('in');
      requestAnimationFrame(() => {
        if (viewNow.current === 'add') document.getElementById('qa-term')?.focus();
        else (document.querySelector('.ov__embed input:not([readonly])') as HTMLInputElement | null)?.focus();
      });
    });
    return () => void off.then((f) => f());
  }, []);

  useEffect(() => {
    const off = listen<number>('overlay-close', (e) => {
      closing.current = e.payload;
      setPhase('out');
    });
    // Loaded after the hotkey already opened it: show without waiting.
    overlayState()
      .then(([open]) => {
        if (open) setPhase((p) => (p === 'gone' ? 'in' : p));
      })
      .catch(() => {});
    return () => void off.then((f) => f());
  }, []);

  function onPanelAnimationEnd(e: React.AnimationEvent<HTMLDivElement>) {
    // ov-fade-out is the exit when the system asks for less motion.
    if (e.target !== e.currentTarget || (e.animationName !== 'ov-out' && e.animationName !== 'ov-fade-out')) return;
    const gen = closing.current;
    if (!gen) return;
    // Two frames: the empty one has to reach the screen before the window
    // hides, or the next show would start from the panel.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (closing.current === gen) void overlayClosed(gen).catch(() => {});
      }),
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Tab goes round what is in the panel and never leaves the page: past
      // the last button WebView2 hands focus to the window frame, the window
      // loses focus, and the overlay hides. The header is not in the round
      // (Ctrl+1 to 4 switch modes, Esc hides).
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.defaultPrevented) {
        e.preventDefault();
        const panel = panelRef.current;
        if (!panel) return;
        // An open dialog (Test's "hand in anyway?") keeps Tab to itself.
        const stops = tabStops(panel.querySelector<HTMLElement>('.dlg') ?? panel);
        if (stops.length === 0) return;
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const step = e.shiftKey ? -1 : 1;
        const next = at === -1 ? (e.shiftKey ? stops.length - 1 : 0) : (at + step + stops.length) % stops.length;
        stops[next].focus();
        return;
      }
      if (e.key === 'Escape') {
        if (menu) setMenu(null);
        else if (view === 'add') setView('study');
        else void hideOverlay();
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        // Not from under an open dialog: its answer would land on a screen
        // that is gone.
        if (panelRef.current?.querySelector('.dlg')) return;
        setMenu(null);
        setView('study');
        setMode(MODES[Number(e.key) - 1].id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, setMode, menu, setId]);

  // A press anywhere else in the panel closes an open menu.
  useEffect(() => {
    if (!menu) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Element | null;
      if (t?.closest('.ov__pop, .ov__setbtn, .ov__more')) return;
      setMenu(null);
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menu]);

  const hotkey = settings ? formatHotkey(settings.hotkey, isMacPlatform()) : '';
  const currentSet = sets?.find((s) => s.id === setId) ?? null;
  const toggle = (which: 'set' | 'more') => setMenu((m) => (m === which ? null : which));

  return (
    <OverlayContext.Provider value={{ menu: moreSlot }}>
    <div className="rt-page fc-page ov" data-phase={phase}>
      <div className="ov__panel" ref={panelRef} onAnimationEnd={onPanelAnimationEnd}>
        <header className="ov__head" data-tauri-drag-region>
          {/* The modes as plain tabs: one click, and Ctrl+1 to 3. */}
          <div className="ov__tabs" role="tablist" aria-label="Study mode">
            {MODES.map((m, i) => (
              <button
                key={m.id}
                type="button"
                tabIndex={-1}
                role="tab"
                aria-selected={view === 'study' && mode === m.id}
                className={`ov__tab${view === 'study' && mode === m.id ? ' is-on' : ''}`}
                title={`${m.hint} (${SHORTCUT}${i + 1})`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setView('study');
                  setMode(m.id);
                  setMenu(null);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="ov__spacer" data-tauri-drag-region />
          <button
            type="button"
            tabIndex={-1}
            className={`ov__setbtn${menu === 'set' ? ' is-open' : ''}`}
            aria-expanded={menu === 'set'}
            aria-haspopup="menu"
            title="Study another set"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle('set')}
          >
            <span className="ov__setbtn-name">{currentSet?.title ?? 'Pick a set'}</span>
            <svg width="9" height="6" viewBox="0 0 10 6" aria-hidden="true">
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            tabIndex={-1}
            className={`ov__icon ov__more${menu === 'more' ? ' is-on' : ''}`}
            title="More"
            aria-label="More"
            aria-expanded={menu === 'more'}
            aria-haspopup="menu"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle('more')}
          >
            <svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true">
              <circle cx="2" cy="2" r="1.4" fill="currentColor" />
              <circle cx="7" cy="2" r="1.4" fill="currentColor" />
              <circle cx="12" cy="2" r="1.4" fill="currentColor" />
            </svg>
          </button>
          {/* Used often enough to be a button of its own, not a menu item. */}
          <button
            type="button"
            tabIndex={-1}
            className="ov__icon"
            title="Open this in the main window"
            aria-label="Open in the main window"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setMenu(null);
              void openMain(setId === null ? '/flashcards' : pathname);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="ov__icon"
            title={`Hide (Esc or ${hotkey})`}
            aria-label="Hide"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void hideOverlay()}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* The header's menus float over the panel, under their button: the
            page under them stays where it is. The "⋯" one is always mounted
            (hidden when closed): the screens put their own controls in it. */}
        {menu === 'set' && (
          <div className="ov__pop ov__pop--set" role="menu" aria-label="Sets">
            {groupByFolder(sets ?? []).map((g) => (
              <div key={g.folder ?? ' loose'} className="ov__popgroup">
                {g.folder !== null && <div className="ov__poplabel">{g.folder}</div>}
                {g.sets.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={s.id === setId}
                    className={`ov__popitem${s.id === setId ? ' is-on' : ''}`}
                    onClick={() => {
                      setChosenSet(s.id);
                      setView('study');
                      setMenu(null);
                    }}
                  >
                    <span className="ov__popitem-main">{s.title}</span>
                    <span className="ov__popitem-side">{s.cardCount}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="ov__pop ov__pop--more" role="menu" aria-label="More" hidden={menu !== 'more'}>
          <div className="ov__popslot" ref={setMoreSlot} />
          <button
            type="button"
            role="menuitem"
            className="ov__popitem"
            onClick={() => {
              setView(view === 'add' ? 'study' : 'add');
              setMenu(null);
            }}
          >
            <span className="ov__popitem-main">{view === 'add' ? 'Back to studying' : 'Add a card'}</span>
          </button>
        </div>

        {view === 'add' ? (
          <QuickAdd onDone={() => setView('study')} preferSet={setId} />
        ) : sets === null || !settings ? (
          <div className="ov__body ov__center rt-ink-faint">loading…</div>
        ) : setId === null ? (
          <div className="ov__body ov__center">
            <p className="ov__big">No sets yet.</p>
            <button type="button" className="rt-btn rt-btn--sm rt-btn--primary" onClick={() => void openMain('/flashcards/new')}>
              make one
            </button>
          </div>
        ) : (
          <div className={`ov__embed fc-app${pathname.endsWith('/test') ? ' ov__embed--fixed' : ''}`} key={resync}>
            <Routes>
              <Route path="/flashcards/:id/cards" element={<WithSetId render={(id) => <FlashcardsClient setId={id} />} />} />
              <Route path="/flashcards/:id/write" element={<WithSetId render={(id) => <WriteClient setId={id} />} />} />
              <Route path="/flashcards/:id/learn" element={<WithSetId render={(id) => <LearnClient setId={id} />} />} />
              <Route path="/flashcards/:id/test" element={<WithSetId render={(id) => <TestClient setId={id} />} />} />
              <Route path="*" element={null} />
            </Routes>
          </div>
        )}
        {/* In the panel, so Tab (kept to the panel) reaches its buttons. */}
        <DialogHost />
      </div>
    </div>
    </OverlayContext.Provider>
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
        <SetOptions sets={sets ?? []} />
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
