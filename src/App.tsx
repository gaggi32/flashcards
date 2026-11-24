// The main window: the flashcards screens under a hash router, with
// the app bar on top and Settings one click away.

import { listen } from '@tauri-apps/api/event';
import { Suspense, ViewTransition, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import Link from '@/components/Link';
import { DialogHost } from '@/components/Dialogs';
import { WhatsNew } from '@/components/WhatsNew';
import { SetEditor, type EditorPanel } from '@/components/flashcards/SetEditor';
import { IconCards, IconSettings } from '@/components/flashcards/FlashcardIcons';
import { SetFileDrop } from '@/components/SetFileDrop';
import { latestUpdate, onUpdate } from '@/lib/app/background';
import { IS_WEB } from '@/lib/app/platform';
import { useDataVersion } from '@/lib/app/events';
import { SettingsProvider, useSettings } from '@/lib/app/settings';
import { useSetOrigins } from '@/lib/app/setOrigin';
import type { UpdateInfo } from '@/lib/app/native';
import { DEFAULT_MODEL } from '@/screens/Settings';
import { FlashcardsClient } from '@/screens/FlashcardsClient';
import { LearnClient } from '@/screens/LearnClient';
import { SetClient } from '@/screens/SetClient';
import { SetsClient } from '@/screens/SetsClient';
import { SettingsScreen } from '@/screens/Settings';
import { TestClient } from '@/screens/TestClient';
import { WriteClient } from '@/screens/WriteClient';

// The motion lab exists in development builds only: imported lazily behind
// import.meta.env.DEV, so a release build leaves it out entirely.
const MotionLab = import.meta.env.DEV
  ? lazy(() => import('@/screens/MotionLab').then((m) => ({ default: m.MotionLab })))
  : null;

/** `:id` → a set id, or the sets list for anything that is not one. */
function WithSetId({ render }: { render: (id: number) => ReactNode }) {
  const { id } = useParams();
  const n = /^\d{1,15}$/.test(id ?? '') ? Number(id) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) return <Navigate to="/flashcards" replace />;
  // Keyed by id so moving between sets starts each screen fresh.
  return <div key={n}>{render(n)}</div>;
}

function useModel(): string {
  return useSettings().settings?.aiModel ?? DEFAULT_MODEL;
}

function NewSet() {
  const [params] = useSearchParams();
  const model = useModel();
  const openPanel: EditorPanel =
    params.get('generate') === '1' ? 'generate' : params.get('import') === '1' ? 'import' : null;
  const folder = params.get('folder')?.trim() || null;
  return <SetEditor openPanel={openPanel} folder={folder} aiModel={model} />;
}

function EditSet() {
  const model = useModel();
  return <WithSetId render={(id) => <SetEditor setId={id} aiModel={model} />} />;
}

/** Rust's tray menu and the overlay ask for a screen with a `navigate` event. */
function NavigationListener() {
  const navigate = useNavigate();
  useSetOrigins();
  useEffect(() => {
    const off = listen<string>('navigate', (e) => {
      const route = e.payload;
      if (typeof route === 'string' && /^\/(flashcards|settings)(\/[\w/?=&#-]*)?$/.test(route)) navigate(route);
    });
    return () => void off.then((f) => f());
  }, [navigate]);
  return null;
}

function AppBar() {
  const [update, setUpdate] = useState<UpdateInfo | null>(latestUpdate());
  // The cog turns one tooth (60°) when the pointer comes onto it, and always
  // finishes: it then looks exactly as at rest, so leaving has nothing to
  // undo and nothing can jump.
  const [turning, setTurning] = useState(false);
  useEffect(() => onUpdate(setUpdate), []);
  return (
    <div className="fc-bar">
      <Link href="/flashcards" className="fc-bar__title app-bar__home">
        <IconCards size={18} />
        Flashcards
        {IS_WEB && <span className="rt-chip app-bar__web">web</span>}
      </Link>
      <span className="fc-bar__spacer" />
      {update?.newer && (
        <Link href="/settings#updates" className="app-bar__update" title={`Version ${update.latest} is out`}>
          update {update.latest}
        </Link>
      )}
      <Link
        href="/settings"
        className="app-bar__settings"
        title="Settings"
        aria-label="Settings"
        onPointerEnter={() => setTurning(true)}
      >
        <span className={`app-bar__cog${turning ? ' is-turning' : ''}`} onAnimationEnd={() => setTurning(false)}>
          <IconSettings size={20} />
        </span>
      </Link>
    </div>
  );
}

/** How long after coming to the front the other window's last save still counts as before it. */
const LATE_SAVE_MS = 1500;

const isStudying = () => /^\/flashcards\/\d+\/(cards|write|learn|test)$/.test(window.location.hash.slice(1));

/**
 * Each screen fades up as it arrives. A study screen is also started afresh
 * from what is saved when the window comes back to the front after the
 * overlay changed the data, sessions included (both windows share the saved
 * sessions, and every save is announced as a data change). The other
 * window's last save (what it sends as it loses the focus) can land just
 * after this one is in front: a change in the first moment, before anything
 * was pressed here, starts the screen afresh too.
 */
function PageMotion({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [resync, setResync] = useState(0);
  const version = useDataVersion();
  const syncedVersion = useRef(version);
  /** When the window came to the front; 0 once something was pressed here. */
  const frontAt = useRef(0);

  useEffect(() => {
    const onFocus = () => {
      if (isStudying() && syncedVersion.current !== version) setResync((n) => n + 1);
      syncedVersion.current = version;
      frontAt.current = performance.now();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [version]);

  useEffect(() => {
    const pressed = () => {
      frontAt.current = 0;
    };
    window.addEventListener('keydown', pressed, true);
    window.addEventListener('pointerdown', pressed, true);
    return () => {
      window.removeEventListener('keydown', pressed, true);
      window.removeEventListener('pointerdown', pressed, true);
    };
  }, []);

  useEffect(() => {
    if (syncedVersion.current === version || !document.hasFocus()) return;
    if (!frontAt.current || performance.now() - frontAt.current > LATE_SAVE_MS || !isStudying()) return;
    syncedVersion.current = version;
    setResync((n) => n + 1);
  }, [version]);

  // Moving between screens is a view transition (Link tags its direction):
  // the old screen slides off, the new one in from the side it lies on, and
  // a set's title travels from its card to the set's page and on into study.
  return (
    <ViewTransition
      key={`${pathname}#${resync}`}
      default="none"
      enter={{ 'nav-forward': 'vt-in-forward', 'nav-back': 'vt-in-back', default: 'vt-in' }}
      exit={{ 'nav-forward': 'vt-out-forward', 'nav-back': 'vt-out-back', default: 'vt-out' }}
    >
      <div className="fx-page">{children}</div>
    </ViewTransition>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <HashRouter>
        <NavigationListener />
        <div className="rt-page fc-page">
          <div className="fc-app">
            <AppBar />
            {!IS_WEB && <WhatsNew />}
            <PageMotion>
            <Routes>
              <Route path="/" element={<Navigate to="/flashcards" replace />} />
              <Route path="/flashcards" element={<SetsClient />} />
              <Route path="/flashcards/new" element={<NewSet />} />
              <Route path="/flashcards/:id" element={<WithSetId render={(id) => <SetClient setId={id} />} />} />
              <Route path="/flashcards/:id/edit" element={<EditSet />} />
              <Route path="/flashcards/:id/learn" element={<WithSetId render={(id) => <LearnClient setId={id} />} />} />
              <Route path="/flashcards/:id/write" element={<WithSetId render={(id) => <WriteClient setId={id} />} />} />
              <Route path="/flashcards/:id/test" element={<WithSetId render={(id) => <TestClient setId={id} />} />} />
              <Route
                path="/flashcards/:id/cards"
                element={<WithSetId render={(id) => <FlashcardsClient setId={id} />} />}
              />
              <Route path="/settings" element={<SettingsScreen />} />
              {MotionLab && (
                <Route
                  path="/dev/motion"
                  element={
                    <Suspense fallback={null}>
                      <MotionLab />
                    </Suspense>
                  }
                />
              )}
              <Route path="*" element={<Navigate to="/flashcards" replace />} />
            </Routes>
            </PageMotion>
          </div>
          <SetFileDrop />
          <DialogHost />
        </div>
      </HashRouter>
    </SettingsProvider>
  );
}
