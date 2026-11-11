// The hotkey overlay: the main window's own Flashcards, Write and Learn screens
// for the set you pick, in a compact frame, plus a quick-add form.
//
// It is the same session, not a copy: each mode keeps its place per set in
// localStorage, which both windows share, so a round started in the main
// window carries on here and the other way round. Answers go to the same
// database. A window that was in the background picks up the other's changes
// when it comes back (the overlay when the hotkey opens it, the main window
// when it is focused). Links to the set page or the editor open the main
// window. Esc or a click elsewhere hides the overlay.

import { listen } from '@tauri-apps/api/event';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';

import { CountUp } from '@/components/TodayPanel';
import { announceDataChange, useDataVersion } from '@/lib/app/events';
import { formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import { hideOverlay, openMain } from '@/lib/app/native';
import { isPrefKey, studySetFrom, usePref, type OverlayMode } from '@/lib/app/prefs';
import { useSettings } from '@/lib/app/settings';
import type { SetSummaryDTO } from '@/lib/flashcards/types';
import { todayKey } from '@/lib/nutrition/day';
import { asApiError } from '@/lib/store/errors';
import { addCards, lastUsedSetId, listSets, overview, type Overview } from '@/lib/store/repo';
import { FlashcardsClient } from '@/screens/FlashcardsClient';
import { LearnClient } from '@/screens/LearnClient';
import { WriteClient } from '@/screens/WriteClient';

const MODES: { id: OverlayMode; route: string; label: string; hint: string }[] = [
  { id: 'cards', route: 'cards', label: 'Cards', hint: 'Flashcards' },
  { id: 'write', route: 'write', label: 'Write', hint: 'Type the answers' },
  { id: 'learn', route: 'learn', label: 'Learn', hint: 'Multiple choice, then typed' },
];

const MODE_PATH = /^\/flashcards\/(\d+)\/(cards|write|learn)$/;

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
  const [chosenSet, setChosenSet] = usePref('overlaySet');
  const [sets, setSets] = useState<SetSummaryDTO[] | null>(null);
  const [stats, setStats] = useState<Overview | null>(null);
  const [resync, setResync] = useState(0);
  const stale = useRef(false);
  const syncedVersion = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const version = useDataVersion();

  const setId = studySetFrom(chosenSet, sets ?? []);

  useEffect(() => {
    listSets()
      .then(setSets)
      .catch(() => setSets([]));
  }, [version]);

  useEffect(() => {
    if (setId === null) return;
    overview(todayKey(), setId)
      .then(setStats)
      .catch(() => {});
  }, [setId, version]);

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

  // The main window wrote a session (or changed cards) while this one was
  // hidden: start the screen afresh from what is saved when it opens again.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && !isPrefKey(e.key)) stale.current = true;
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const off = listen('overlay-open', () => {
      if (stale.current || syncedVersion.current !== version) {
        stale.current = false;
        syncedVersion.current = version;
        setResync((n) => n + 1);
      }
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        panel.current?.animate(
          [
            { opacity: 0, transform: 'translateY(8px) scale(0.97)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.2)' },
        );
      }
      requestAnimationFrame(() => {
        if (view === 'add') document.getElementById('qa-term')?.focus();
        else (document.querySelector('.ov__embed input:not([readonly])') as HTMLInputElement | null)?.focus();
      });
    });
    return () => void off.then((f) => f());
  }, [version, view]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (view === 'add') setView('study');
        else void hideOverlay();
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        setView('study');
        setMode(MODES[Number(e.key) - 1].id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, setMode]);

  const hotkey = settings ? formatHotkey(settings.hotkey, isMacPlatform()) : '';
  const modeIndex = MODES.findIndex((m) => m.id === mode);
  const ordered = useMemo(() => [...(sets ?? [])].sort((a, b) => a.title.localeCompare(b.title)), [sets]);

  return (
    <div className="rt-page fc-page ov">
      <div className="ov__panel" ref={panel}>
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
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setView('study');
                  setMode(m.id);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
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
            {ordered.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <span className="ov__spacer" data-tauri-drag-region />
          {stats && (
            <span className="ov__stats" data-tauri-drag-region title="This set, all modes together">
              <CountUp value={stats.learned} />/<CountUp value={stats.fresh + stats.learning + stats.learned} /> learned
              {stats.streak > 0 && (
                <span className={`ov__streak${stats.answeredToday ? ' is-lit' : ''}`}>
                  {' · '}
                  <CountUp value={stats.streak} />d
                </span>
              )}
            </span>
          )}
          <button
            type="button"
            className={`ov__icon ov__plus${view === 'add' ? ' is-on' : ''}`}
            title="Add a card"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setView(view === 'add' ? 'study' : 'add')}
          >
            +
          </button>
          <button
            type="button"
            className="ov__icon"
            title="Open this in the main window"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void openMain(setId === null ? '/flashcards' : pathname)}
          >
            ⤢
          </button>
          <button
            type="button"
            className="ov__icon"
            title={`Hide (Esc or ${hotkey})`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void hideOverlay()}
          >
            ×
          </button>
        </header>

        {view === 'add' ? (
          <QuickAdd onDone={() => setView('study')} preferSet={setId} />
        ) : sets === null ? (
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
