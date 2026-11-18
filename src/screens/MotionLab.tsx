// Development only (/dev/motion): every animation in the app on one screen,
// each with a button that plays it again, so a change to the motion can be
// looked at without studying a round to reach it. The pieces here are the
// real components and classes the study screens use.

import { useState, type ReactNode } from 'react';

import Link from '@/components/Link';
import { motionLevel } from '@/lib/app/theme';

function Specimen({ title, note, children, onReplay }: { title: string; note: string; children: ReactNode; onReplay?: () => void }) {
  return (
    <section className="fc-panel lab__specimen">
      <div className="fc-panel__head">
        <h2 className="fc-panel__title">{title}</h2>
        {onReplay && (
          <button type="button" className="rt-btn rt-btn--sm" onClick={onReplay}>
            play again
          </button>
        )}
      </div>
      <p className="rt-small rt-ink-soft">{note}</p>
      <div className="lab__stage">{children}</div>
    </section>
  );
}

/** Theme and motion for this window only, without touching the saved settings. */
function Switcher() {
  const root = document.documentElement;
  const [, redraw] = useState(0);
  const set = (attr: string, value: string | null) => {
    if (value === null) root.removeAttribute(attr);
    else root.setAttribute(attr, value);
    redraw((n) => n + 1);
  };
  const theme = root.getAttribute('data-theme');
  const eye = root.getAttribute('data-eye') === 'on';
  const motion = root.getAttribute('data-motion') ?? 'full';
  return (
    <div className="rt-btnrow lab__switcher">
      <button type="button" className="rt-btn rt-btn--sm" onClick={() => set('data-theme', theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? 'dark' : 'light'}
      </button>
      <button type="button" className="rt-btn rt-btn--sm" onClick={() => set('data-eye', eye ? null : 'on')}>
        eye comfort {eye ? 'on' : 'off'}
      </button>
      {(['full', 'calm', 'off'] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={`rt-btn rt-btn--sm${motion === m ? ' rt-btn--primary' : ''}`}
          onClick={() => set('data-motion', m === 'full' ? null : m)}
        >
          motion {m}
        </button>
      ))}
    </div>
  );
}

function FlipSpecimen() {
  const [flipped, setFlipped] = useState(false);
  return (
    <button type="button" className={`fc-flip${flipped ? ' is-flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
      <span className="fc-flip__inner">
        <span className="fc-flip__face fc-flip__face--front">
          <span className="fc-flip__side">term</span>
          <span className="fc-flip__text">la boulangerie</span>
        </span>
        <span className="fc-flip__face fc-flip__face--back">
          <span className="fc-flip__side">definition</span>
          <span className="fc-flip__text">die Bäckerei</span>
        </span>
      </span>
    </button>
  );
}

export function MotionLab() {
  const [entrance, setEntrance] = useState(0);
  return (
    <main className="lab">
      <Link href="/settings" className="rt-backlink">
        Settings
      </Link>
      <div className="rt-pagehead">
        <h1>Motion lab</h1>
      </div>
      <p className="rt-small rt-ink-soft">
        Development build only. Motion right now: <strong>{motionLevel()}</strong> (the setting, or off when the system
        asks for less motion).
      </p>
      <Switcher />

      <Specimen title="Page entrance" note="Each screen rises in as it arrives." onReplay={() => setEntrance((n) => n + 1)}>
        <div key={entrance} className="fx-page">
          <div className="fc-terms">
            <div className="fc-term">
              <span className="fc-term__term">la mairie</span>
              <span className="fc-term__def">das Rathaus</span>
            </div>
            <div className="fc-term">
              <span className="fc-term__term">le carrefour</span>
              <span className="fc-term__def">die Kreuzung</span>
            </div>
          </div>
        </div>
      </Specimen>

      <Specimen title="Card flip" note="Click the card.">
        <FlipSpecimen />
      </Specimen>
    </main>
  );
}
