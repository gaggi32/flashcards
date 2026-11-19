import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles/index.css';

import { createRoot } from 'react-dom/client';

import { App } from './App';
import { startBackgroundJobs } from './lib/app/background';
import { installLinkGuard } from './lib/app/guard';
import { adoptLocalPrefs } from './lib/app/prefs';
import { applyCachedTheme } from './lib/app/theme';
import { carryOverSessions } from './lib/flashcards/client';

applyCachedTheme();
installLinkGuard();
startBackgroundJobs();
// Before 0.1.15 some choices lived in localStorage; the main window, which
// starts with the app, hands them to Rust (the overlay hears settings-changed).
void adoptLocalPrefs().catch(() => {});
// The same for study sessions (either window does it before its first load).
void carryOverSessions().catch(() => {});

createRoot(document.getElementById('root')!).render(<App />);
