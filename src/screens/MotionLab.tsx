// Development only (/dev/motion): every animation in the app on one screen,
// each with a button that plays it again, so a change to the motion can be
// looked at without studying a round to reach it. The pieces here are the
// real components and classes the study screens use.

import { useRef, useState, type ReactNode } from 'react';

import Link from '@/components/Link';
import { motionLevel } from '@/lib/app/theme';
import type { SetDTO } from '@/lib/flashcards/types';
import { computeDiff } from '@/lib/flashcards/diff';
import { AnswerLine, TypedLine } from '@/components/flashcards/AnswerDiff';
import { Confetti } from '@/components/motion/Confetti';
import { CountUp } from '@/components/motion/CountUp';
import { Deck } from '@/screens/FlashcardsClient';
import { useFlip } from '@/components/motion/useFlip';

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

/** The end of a round and a test's score, as the study screens draw them. */
function ResultsSpecimen({ run }: { run: number }) {
  const [perfect, setPerfect] = useState(true);
  const known = perfect ? 6 : 5;
  const percent = perfect ? 100 : 83;
  return (
    <div key={`${run}-${perfect}`}>
      <div className="rt-btnrow" style={{ marginBottom: 14 }}>
        <button type="button" className="rt-btn rt-btn--sm" onClick={() => setPerfect(true)}>
          every card known
        </button>
        <button type="button" className="rt-btn rt-btn--sm" onClick={() => setPerfect(false)}>
          one missed
        </button>
      </div>
      <div className="fc-panel fc-summary" role="status">
        {perfect && <Confetti seed={run + 1} />}
        <h2 className="fc-panel__title">{perfect ? 'you knew every card' : 'round 1 done'}</h2>
        <dl className="fc-stats">
          <div>
            <dt>cards</dt>
            <dd>
              <CountUp from={0} value={6} />
            </dd>
          </div>
          <div>
            <dt>knew it</dt>
            <dd>
              <CountUp from={0} value={known} delay={120} />
            </dd>
          </div>
          <div>
            <dt>to go again</dt>
            <dd className={perfect ? undefined : 'fc-stats__miss'}>
              <CountUp from={0} value={6 - known} delay={240} />
            </dd>
          </div>
        </dl>
      </div>
      <div className="fc-panel fc-testscore" role="status">
        {percent === 100 ? <Confetti seed={run + 7} /> : <Confetti size="small" seed={run + 7} />}
        <div className="fc-testscore__head">
          <div className={`fc-testscore__ring${percent === 100 ? ' is-full' : ''}`} style={{ ['--p' as string]: percent }}>
            <span>
              <CountUp from={0} value={percent} ms={900} />%
            </span>
          </div>
          <div>
            <h2 className="fc-panel__title">{percent === 100 ? 'every answer right' : 'well done'}</h2>
            <p className="rt-small rt-ink-soft">{percent === 100 ? '12' : '10'} of 12 questions right · 3 min</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const WORDS = ['la mairie', 'le carrefour', 'la gare', 'le trottoir', "l'épicerie", 'la boulangerie'];

/** A list that gets shuffled and trimmed on each press, to watch the glide. */
function ListSpecimen({ run }: { run: number }) {
  const list = useRef<HTMLDivElement>(null);
  useFlip(list);
  const words = WORDS.map((w, i) => ({ w, k: (i * 7 + run * 5) % 11 }))
    .sort((a, b) => a.k - b.k)
    .slice(0, run % 2 ? 5 : 6)
    .map((x) => x.w);
  return (
    <div className="fc-terms" ref={list}>
      {words.map((w) => (
        <div key={w} data-flip={w} className="fc-term">
          <span className="fc-term__term">{w}</span>
        </div>
      ))}
    </div>
  );
}

export function MotionLab() {
  const [listRun, setListRun] = useState(0);
  const [deckRun, setDeckRun] = useState(0);
  const [verdictRun, setVerdictRun] = useState(0);
  const [resultsRun, setResultsRun] = useState(0);
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

      <Specimen
        title="Moving between screens"
        note="Screens slide in from the side they lie on (deeper from the right, back from the left) and a set's title travels from its card to its page and into study. In calm the screens rise in instead."
      >
        <div className="rt-btnrow">
          <Link href="/flashcards" className="rt-btn rt-btn--sm">
            go to your sets
          </Link>
        </div>
      </Specimen>

      <Specimen title="Lists" note="When items are added, removed or moved, the rest glide to their new places." onReplay={() => setListRun((n) => n + 1)}>
        <ListSpecimen run={listRun} />
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

      <Specimen
        title="Results"
        note="End of a round and a test's score. Confetti only for a set known all the way through or a test above 80% (big at 100%); none in calm, no motion or eye comfort."
        onReplay={() => setResultsRun((n) => n + 1)}
      >
        <ResultsSpecimen run={resultsRun} />
      </Specimen>
    </main>
  );
}
