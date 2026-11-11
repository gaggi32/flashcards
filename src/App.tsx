// The main window: the website's flashcards screens under a hash router, with
// the app bar on top and Settings one click away.

import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';

import Link from '@/components/Link';
import { DialogHost } from '@/components/Dialogs';
import { SetEditor, type EditorPanel } from '@/components/flashcards/SetEditor';
import { IconCards } from '@/components/flashcards/FlashcardIcons';
import { latestUpdate, onUpdate } from '@/lib/app/background';
import { useDataVersion } from '@/lib/app/events';
import { isPrefKey } from '@/lib/app/prefs';
import { SettingsProvider, useSettings } from '@/lib/app/settings';
import type { UpdateInfo } from '@/lib/app/native';
import { DEFAULT_MODEL } from '@/screens/Settings';
import { FlashcardsClient } from '@/screens/FlashcardsClient';
import { LearnClient } from '@/screens/LearnClient';
import { SetClient } from '@/screens/SetClient';
import { SetsClient } from '@/screens/SetsClient';
import { SettingsScreen } from '@/screens/Settings';
import { WriteClient } from '@/screens/WriteClient';

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
  useEffect(() => onUpdate(setUpdate), []);
  return (
    <div className="fc-bar">
      <Link href="/flashcards" className="fc-bar__title app-bar__home">
        <IconCards size={18} />
        Flashcards
      </Link>
      <span className="fc-bar__spacer" />
      {update?.newer && (
        <Link href="/settings#updates" className="app-bar__update" title={`Version ${update.latest} is out`}>
          update {update.latest}
        </Link>
      )}
      <Link href="/settings" className="rt-btn rt-btn--sm app-bar__settings">
        settings
      </Link>
    </div>
  );
}

/**
 * Each screen fades up as it arrives. A study screen is also started afresh
 * from what is saved when the window comes back to the front after the
 * overlay changed a session (both windows share the saved sessions).
 */
function PageMotion({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [resync, setResync] = useState(0);
  const stale = useRef(false);
  const version = useDataVersion();
  const syncedVersion = useRef(version);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && !isPrefKey(e.key)) stale.current = true;
    };
    const onFocus = () => {
      const studying = /^\/flashcards\/\d+\/(cards|write|learn)$/.test(window.location.hash.slice(1));
      if (studying && (stale.current || syncedVersion.current !== version)) setResync((n) => n + 1);
      stale.current = false;
      syncedVersion.current = version;
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, [version]);

  return (
    <div key={`${pathname}#${resync}`} className="fx-page">
      {children}
    </div>
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
            <PageMotion>
            <Routes>
              <Route path="/" element={<Navigate to="/flashcards" replace />} />
              <Route path="/flashcards" element={<SetsClient />} />
              <Route path="/flashcards/new" element={<NewSet />} />
              <Route path="/flashcards/:id" element={<WithSetId render={(id) => <SetClient setId={id} />} />} />
              <Route path="/flashcards/:id/edit" element={<EditSet />} />
              <Route path="/flashcards/:id/learn" element={<WithSetId render={(id) => <LearnClient setId={id} />} />} />
              <Route path="/flashcards/:id/write" element={<WithSetId render={(id) => <WriteClient setId={id} />} />} />
              <Route
                path="/flashcards/:id/cards"
                element={<WithSetId render={(id) => <FlashcardsClient setId={id} />} />}
              />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="*" element={<Navigate to="/flashcards" replace />} />
            </Routes>
            </PageMotion>
          </div>
          <DialogHost />
        </div>
      </HashRouter>
    </SettingsProvider>
  );
}
