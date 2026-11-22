// The web version's panel above the sets (where the desktop app shows the
// overlay's set): where the sets are kept, that they are not connected to the
// desktop app, and how to keep a copy. Once dismissed it stays a single line.

import { useState } from 'react';

import Link from '@/components/Link';
import { askToKeep } from './pwa';
import { DESKTOP_PAGE } from './links';

const DISMISSED = 'flashcards:web-notice';

function read(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

export function WebNotice() {
  const [small, setSmall] = useState(read);

  if (small) {
    return (
      <p className="web-notice web-notice--small rt-small">
        <span className="rt-chip">web version</span> Your sets are saved in this browser only.{' '}
        <button type="button" className="rt-linkbtn" onClick={() => setSmall(false)}>
          more
        </button>
      </p>
    );
  }

  return (
    <section className="rt-section web-notice fx-rise" aria-label="About the web version">
      <div className="web-notice__head">
        <span className="rt-chip">web version</span>
        <strong>Your sets stay in this browser</strong>
      </div>
      <p>
        Everything you make here is saved in this browser, on this device. There is no account and no server, and
        it is <strong>not connected to the Flashcards desktop app</strong> or to your other devices.
      </p>
      <p>
        To keep a copy, or move sets to another device or into the desktop app, use{' '}
        <Link href="/settings#data">Settings → data → export</Link> and import the file there. Clearing this
        browser&apos;s site data deletes the sets.
      </p>
      <p className="rt-ink-faint">
        On a phone: Share → <em>Add to Home Screen</em> opens it like an app, offline too. Want the hotkey overlay?
        That is the <a href={DESKTOP_PAGE}>desktop app</a>.
      </p>
      <div className="rt-btnrow">
        <button
          type="button"
          className="rt-btn rt-btn--sm"
          onClick={() => {
            try {
              localStorage.setItem(DISMISSED, '1');
            } catch {
              /* shown again next time */
            }
            setSmall(true);
            // A click is the moment a browser may ask to keep the sets safe from clean-up.
            void askToKeep();
          }}
        >
          got it
        </button>
      </div>
    </section>
  );
}
