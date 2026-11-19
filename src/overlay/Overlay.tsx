// The hotkey overlay: the main window's own Flashcards, Write and Learn
// screens for the set you pick, in a compact frame, plus a quick-add form.
// It is for a few quick answers, so it shows little: one header line (the
// set and mode as one switch, a "⋯" menu, close) and only what a screen needs
// to answer; the screens' other controls sit in the "⋯" menu (MoreControls),
// Write and Learn skip their setup screens, and Test (a whole paper) opens
// in the main window.
//
// It is the same session, not a copy: each mode keeps its place per set in
// the database (study_sessions), which both windows share, so a round started
// in the main window carries on here and the other way round. Answers go to
// the same database. Every write is announced as a data
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
// in the panel has to be scrolled to. The header's menus open in the panel's
// flow, under the header, so the window grows to show them.

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
import { WriteClient } from '@/screens/WriteClient';
import { DialogHost } from '@/components/Dialogs';
import { SetOptions } from '@/components/flashcards/SetOptions';
import { tabStops } from '@/components/flashcards/StudyHeader';
import { OverlayContext } from '@/components/flashcards/overlaySlot';
import { groupByFolder } from '@/lib/flashcards/folders';

/** The modes studied in the overlay. Test (Ctrl+4) opens in the main window. */
const MODES: { id: Exclude<OverlayMode, 'test'>; route: string; label: string; hint: string }[] = [
  { id: 'cards', route: 'cards', label: 'Cards', hint: 'Flip a card, mark it' },
  { id: 'write', route: 'write', label: 'Write', hint: 'Type the answers' },
  { id: 'learn', route: 'learn', label: 'Learn', hint: 'Multiple choice, then typed' },
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
      const scroller = panel.querySelector<HTMLElement>('.ov__embed, .ov__body');
      const hidden = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
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
  const [savedMode, setMode] = usePref('overlayMode');
  // A mode saved as Test (by versions that studied it here) studies Cards.
  const mode = savedMode === 'test' ? 'cards' : savedMode;
  /** The header menu that is open: the set and mode switch, or "⋯". */
  const [menu, setMenu] = useState<'switch' | 'more' | null>(null);
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
    if (m && m[2] !== 'test') {
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
        if (e.key === '4') {
          openTest();
          return;
        }
        setView('study');
        setMode(MODES[Number(e.key) - 1].id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, setMode, menu, setId]);

  /** Test is a whole paper: it opens in the main window, on this set. */
  function openTest() {
    setMenu(null);
    void openMain(setId === null ? '/flashcards' : `/flashcards/${setId}/test`);
  }

  // A press anywhere else in the panel closes an open menu.
  useEffect(() => {
    if (!menu) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Element | null;
      if (t?.closest('.ov__drawer, .ov__switch, .ov__more')) return;
      setMenu(null);
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menu]);

  const hotkey = settings ? formatHotkey(settings.hotkey, isMacPlatform()) : '';
  const currentMode = MODES.find((m) => m.id === mode) ?? MODES[0];
  const currentSet = sets?.find((s) => s.id === setId) ?? null;
  const toggle = (which: 'switch' | 'more') => setMenu((m) => (m === which ? null : which));

  return (
    <OverlayContext.Provider value={{ menu: moreSlot }}>
    <div className="rt-page fc-page ov" data-phase={phase}>
      <div className="ov__panel" ref={panelRef} onAnimationEnd={onPanelAnimationEnd}>
        <header className="ov__head" data-tauri-drag-region>
          {/* The set and the mode, as one switch: what you are studying, and
              the way to change it. */}
          <button
            type="button"
            tabIndex={-1}
            className={`ov__switch${menu === 'switch' ? ' is-open' : ''}`}
            aria-expanded={menu === 'switch'}
            aria-label="Change set or mode"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle('switch')}
          >
            <span className="ov__switch-set">{view === 'add' ? 'Add a card' : (currentSet?.title ?? 'Pick a set')}</span>
            {view !== 'add' && <span className="ov__switch-mode">{currentMode.label}</span>}
            <svg className="ov__switch-chev" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="ov__spacer" data-tauri-drag-region />
          <button
            type="button"
            tabIndex={-1}
            className={`ov__icon ov__more${menu === 'more' ? ' is-on' : ''}`}
            title="More"
            aria-label="More"
            aria-expanded={menu === 'more'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle('more')}
          >
            <svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true">
              <circle cx="2" cy="2" r="1.5" fill="currentColor" />
              <circle cx="7" cy="2" r="1.5" fill="currentColor" />
              <circle cx="12" cy="2" r="1.5" fill="currentColor" />
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
            ×
          </button>
        </header>

        {/* The header's menus open here, in the panel's flow, so the window
            grows to show them. The "⋯" one is always mounted: the screens
            put their own controls in it (MoreControls). */}
        <div className={`ov__drawer${menu ? ' is-open' : ''}`}>
          {menu === 'switch' && (
            <div className="ov__menu ov__menu--switch">
              <div className="ov__menu-label">Mode</div>
              <div className="ov__modelist">
                {MODES.map((m, i) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`ov__menu-item${view === 'study' && mode === m.id ? ' is-on' : ''}`}
                    onClick={() => {
                      setView('study');
                      setMode(m.id);
                      setMenu(null);
                    }}
                  >
                    <span className="ov__menu-main">{m.label}</span>
                    <span className="ov__menu-sub">{m.hint}</span>
                    <span className="ov__menu-key">
                      {SHORTCUT}
                      {i + 1}
                    </span>
                  </button>
                ))}
                <button type="button" className="ov__menu-item" onClick={openTest}>
                  <span className="ov__menu-main">Test ↗</span>
                  <span className="ov__menu-sub">A whole paper, in the main window</span>
                  <span className="ov__menu-key">{SHORTCUT}4</span>
                </button>
              </div>
              <div className="ov__menu-label">Set</div>
              <div className="ov__setlist">
                {groupByFolder(sets ?? []).map((g) => (
                  <div key={g.folder ?? ' loose'} className="ov__setgroup">
                    {g.folder !== null && <div className="ov__setfolder">{g.folder}</div>}
                    {g.sets.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`ov__menu-item ov__setitem${s.id === setId ? ' is-on' : ''}`}
                        onClick={() => {
                          setChosenSet(s.id);
                          setView('study');
                          setMenu(null);
                        }}
                      >
                        <span className="ov__menu-main">{s.title}</span>
                        <span className="ov__menu-count">{s.cardCount}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="ov__menu ov__menu--more" hidden={menu !== 'more'}>
            <div className="ov__menu-slot" ref={setMoreSlot} />
            <button
              type="button"
              className="ov__menu-item"
              onClick={() => {
                setView(view === 'add' ? 'study' : 'add');
                setMenu(null);
              }}
            >
              <span className="ov__menu-main">{view === 'add' ? 'Back to studying' : 'Add a card'}</span>
            </button>
            <button
              type="button"
              className="ov__menu-item"
              onClick={() => {
                setMenu(null);
                void openMain(setId === null ? '/flashcards' : pathname);
              }}
            >
              <span className="ov__menu-main">Open in the main window</span>
            </button>
          </div>
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
          <div className="ov__embed fc-app" key={resync}>
            <Routes>
              <Route path="/flashcards/:id/cards" element={<WithSetId render={(id) => <FlashcardsClient setId={id} />} />} />
              <Route path="/flashcards/:id/write" element={<WithSetId render={(id) => <WriteClient setId={id} />} />} />
              <Route path="/flashcards/:id/learn" element={<WithSetId render={(id) => <LearnClient setId={id} />} />} />
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
