// Development only (/dev/motion): every animation in the app on one screen,
// each with a button that plays it again, so a change to the motion can be
// looked at without studying a round to reach it. The pieces here are the
// real components and classes the study screens use.

import { useState, type ReactNode } from 'react';

import Link from '@/components/Link';
import { motionLevel } from '@/lib/app/theme';
import type { SetDTO } from '@/lib/flashcards/types';
import { computeDiff } from '@/lib/flashcards/diff';
import { AnswerLine, TypedLine } from '@/components/flashcards/AnswerDiff';
import { Deck } from '@/screens/FlashcardsClient';

/** A made-up set for the specimens; nothing here is saved. */
export const LAB_SET: SetDTO = {
  id: -1,
  folder: null,
  isPublic: false,
  isOwner: true,
  authorName: null,
  title: 'Unité 4 – En ville',
  description: null,
  createdAt: '2026-11-19T00:00:00Z',
  cardCount: 6,
  cards: [
    ['la boulangerie', 'die Bäckerei'],
    ['le carrefour', 'die Kreuzung'],
    ['la mairie', 'das Rathaus'],
    ['le trottoir', 'das Trottoir'],
    ['la gare routière', 'der Busbahnhof'],
    ["l'épicerie", 'das Lebensmittelgeschäft'],
  ].map(([term, definition], i) => ({ id: -(i + 1), term, definition, position: i })),
};

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

/** Write's answer feedback, both ways, replayed on demand. */
function VerdictSpecimen({ run }: { run: number }) {
  const [right, setRight] = useState(false);
  const given = 'la boulongerie';
  const expected = 'la boulangerie';
  const diff = computeDiff(given, expected);
  return (
    <div key={`${run}-${right}`}>
      <div className="rt-btnrow" style={{ marginBottom: 14 }}>
        <button type="button" className="rt-btn rt-btn--sm" onClick={() => setRight(true)}>
          answer right
        </button>
        <button type="button" className="rt-btn rt-btn--sm" onClick={() => setRight(false)}>
          answer wrong
        </button>
      </div>
      <div>
        <div className="fc-prompt">
          <span className="fc-flip__side">definition</span>
          <div className="fc-prompt__text">die Bäckerei</div>
        </div>
        {right ? (
          <div className="fc-verdict fc-verdict--ok" role="status">
            <div className="fc-verdict__title">correct</div>
            <div className="fc-verdict__answer">{expected}</div>
          </div>
        ) : (
          <div className="fc-verdict fc-verdict--miss" role="alert">
            <div className="fc-verdict__title">incorrect</div>
            <div className="fc-verdict__line">
              <span className="fc-verdict__key">you said</span>
              <span className="fc-verdict__given">
                <TypedLine parts={diff} />
              </span>
            </div>
            <div className="fc-verdict__line">
              <span className="fc-verdict__key">correct</span>
              <span className="fc-verdict__answer">
                <AnswerLine parts={diff} />
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MotionLab() {
  const [entrance, setEntrance] = useState(0);
  const [deckRun, setDeckRun] = useState(0);
  const [verdictRun, setVerdictRun] = useState(0);
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

      <Specimen
        title="The deck"
        note="The real Flashcards deck on a made-up set. Mark cards with the buttons or 1 / 2: the stamp lands, the card flies to its pile, the stack moves up. Press fast: nothing waits. Prev / next slide; space flips with a lift."
        onReplay={() => setDeckRun((n) => n + 1)}
      >
        <Deck key={deckRun} set={LAB_SET} saved={null} persist={false} />
      </Specimen>

      <Specimen
        title="Answers"
        note="Write, Learn and Test: right glows green and stamps its title; wrong glows rust, nudges, and draws the correction in."
        onReplay={() => setVerdictRun((n) => n + 1)}
      >
        <VerdictSpecimen run={verdictRun} />
      </Specimen>
    </main>
  );
}
