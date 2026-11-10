import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './styles/index.css';

import { createRoot } from 'react-dom/client';

import { App } from './App';
import { startBackgroundJobs } from './lib/app/background';
import { installLinkGuard } from './lib/app/guard';
import { applyCachedTheme } from './lib/app/theme';

applyCachedTheme();
installLinkGuard();
startBackgroundJobs();

createRoot(document.getElementById('root')!).render(<App />);
