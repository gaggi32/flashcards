import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/silkscreen/400.css';
import './styles/index.css';
import './styles/overlay.css';

import { createRoot } from 'react-dom/client';

import { installLinkGuard } from './lib/app/guard';
import { SettingsProvider } from './lib/app/settings';
import { applyCachedTheme } from './lib/app/theme';
import { Overlay } from './overlay/Overlay';

applyCachedTheme();
installLinkGuard();

createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <Overlay />
  </SettingsProvider>,
);
