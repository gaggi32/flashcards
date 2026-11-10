// The hotkey overlay: a short round of due cards (then a few new ones), each
// flipped with Space and graded with 1–4, plus a quick-add form. It lives in
// its own borderless, always-on-top window; Esc or a click elsewhere hides it.

import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { announceDataChange, useDataVersion } from '@/lib/app/events';
import { formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import { hideOverlay, openMain } from '@/lib/app/native';
import { useSettings } from '@/lib/app/settings';
import type { Quality } from '@/lib/flashcards/sm2';
import type { SetSummaryDTO } from '@/lib/flashcards/types';
import { todayKey } from '@/lib/nutrition/day';
import { asApiError } from '@/lib/store/errors';
import {
  addCards,
  lastUsedSetId,
  listSets,
  overlayRound,
  reviewCard,
  todayNumbers,
  type OverlayCard,
  type Today,
} from '@/lib/store/repo';

const GRADES: { key: string; label: string; quality: Quality; hint: string }[] = [
  { key: '1', label: 'again', quality: 1, hint: 'did not know it' },
  { key: '2', label: 'hard', quality: 3, hint: 'got it, slowly' },
  { key: '3', label: 'good', quality: 4, hint: 'got it' },
  { key: '4', label: 'easy', quality: 5, hint: 'instantly' },
];

/** A round left open this long is rebuilt on the next open: dates move on. */
const STALE_MS = 15 * 60 * 1000;

type Mode = 'study' | 'add';

export function Overlay() {
  const { settings } = useSettings();
  const [mode, setMode] = useState<Mode>('study');
  const [round, setRound] = useState<OverlayCard[] | null>(null);
  const [builtAt, setBuiltAt] = useState(0);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [right, setRight] = useState(0);
  const [today, setToday] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frontIsTerm, setFrontIsTerm] = useState<boolean[]>([]);
  const busy = useRef(false);
  const version = useDataVersion();

  const build = useCallback(async () => {
    if (!settings) return;
    setError(null);
    try {
      const day = todayKey();
      const cards = await overlayRound(day, settings.overlayRound, settings.overlayNewCards);
      setRound(cards);
      setFrontIsTerm(
        cards.map(() =>
          settings.overlayFront === 'mixed' ? Math.random() < 0.5 : settings.overlayFront === 'term',
        ),
      );
      setIndex(0);
      setFlipped(false);
      setRight(0);
      setBuiltAt(Date.now());
      setToday(await todayNumbers(day));
    } catch (err) {
      setError(asApiError(err, 'Could not load cards.').message);
    }
  }, [settings]);

  // First load, and whenever settings change the round's shape.
  useEffect(() => {
    void build();
  }, [build]);

  // Cards changed in the main window: refresh the numbers, keep the round.
  useEffect(() => {
    if (version > 0) todayNumbers(todayKey()).then(setToday).catch(() => {});
  }, [version]);

  // Each time the hotkey shows the window.
  useEffect(() => {
    const off = listen('overlay-open', () => {
      setError(null);
      const finished = round !== null && index >= round.length;
      if (round === null || finished || Date.now() - builtAt > STALE_MS) void build();
      if (mode === 'add') document.getElementById('qa-term')?.focus();
    });
    return () => void off.then((f) => f());
  }, [round, index, builtAt, build, mode]);

  const card = round && index < round.length ? round[index] : null;
  const showTermFirst = frontIsTerm[index] ?? true;

  const grade = useCallback(
    async (quality: Quality) => {
      if (!card || !flipped || busy.current) return;
      busy.current = true;
      try {
        await reviewCard(card.id, quality, todayKey(), card.progress?.repetitionNumber ?? null);
        announceDataChange();
        if (quality >= 3) setRight((n) => n + 1);
        setIndex((i) => i + 1);
        setFlipped(false);
        setToday(await todayNumbers(todayKey()));
      } catch (err) {
        setError(asApiError(err, 'Could not save that answer.').message);
      } finally {
        busy.current = false;
      }
    },
    [card, flipped],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (mode === 'add') setMode('study');
        else void hideOverlay();
        return;
      }
      if (mode !== 'study') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === ' ' || e.key === 'Enter') && card) {
        e.preventDefault();
        if (!flipped) setFlipped(true);
        else void grade(4);
        return;
      }
      const g = GRADES.find((x) => x.key === e.key);
      if (g && flipped) {
        e.preventDefault();
        void grade(g.quality);
        return;
      }
      if (!card && (e.key === 'r' || e.key === 'R')) void build();
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setMode('add');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, card, flipped, grade, build]);

  const hotkey = settings ? formatHotkey(settings.hotkey, isMacPlatform()) : '';

  return (
    <div className="rt-page fc-page ov">
      <div className="ov__panel">
        <header className="ov__head" data-tauri-drag-region>
          <span className="ov__title" data-tauri-drag-region>
            flashcards
          </span>
          {today && (
            <span className="ov__stats" data-tauri-drag-region>
              {today.due} due · {today.reviewed}/{settings?.dailyGoal ?? '–'} today
              {today.streak > 1 ? ` · ${today.streak}d streak` : ''}
            </span>
          )}
          <span className="ov__spacer" data-tauri-drag-region />
          <button
            type="button"
            className={`ov__icon${mode === 'add' ? ' is-on' : ''}`}
            title="Add a card (A)"
            onClick={() => setMode(mode === 'add' ? 'study' : 'add')}
          >
            +
          </button>
          <button type="button" className="ov__icon" title="Open Flashcards" onClick={() => void openMain('/flashcards')}>
            ⤢
          </button>
          <button type="button" className="ov__icon" title={`Hide (Esc or ${hotkey})`} onClick={() => void hideOverlay()}>
            ×
          </button>
        </header>

        {error && <div className="ov__error">{error}</div>}

        {mode === 'add' ? (
          <QuickAdd onDone={() => setMode('study')} />
        ) : round === null ? (
          <div className="ov__body ov__center rt-ink-faint">loading…</div>
        ) : card ? (
          <>
            <div className="ov__meta">
              <span>
                {index + 1} / {round.length}
              </span>
              <span className="ov__set">{card.setTitle}</span>
              <span className={`ov__tag${card.due ? '' : ' is-new'}`}>{card.due ? 'review' : 'new'}</span>
            </div>
            <button
              type="button"
              className={`ov__card${flipped ? ' is-flipped' : ''}`}
              onClick={() => setFlipped(true)}
              aria-label={flipped ? 'Answer shown' : 'Show the answer'}
            >
              <span className="ov__front">{showTermFirst ? card.term : card.definition}</span>
              {flipped && <span className="ov__back">{showTermFirst ? card.definition : card.term}</span>}
            </button>
            <div className="ov__actions">
              {flipped ? (
                GRADES.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    className={`rt-btn rt-btn--sm ov__grade ov__grade--${g.label}`}
                    title={g.hint}
                    onClick={() => void grade(g.quality)}
                  >
                    <span className="ov__key">{g.key}</span> {g.label}
                  </button>
                ))
              ) : (
                <button type="button" className="rt-btn rt-btn--sm rt-btn--primary ov__show" onClick={() => setFlipped(true)}>
                  <span className="ov__key">space</span> show answer
                </button>
              )}
            </div>
          </>
        ) : (
          <RoundEnd
            done={round.length}
            right={right}
            today={today}
            goal={settings?.dailyGoal ?? 0}
            onAgain={() => void build()}
            onAdd={() => setMode('add')}
          />
        )}
      </div>
    </div>
  );
}

function RoundEnd({
  done,
  right,
  today,
  goal,
  onAgain,
  onAdd,
}: {
  done: number;
  right: number;
  today: Today | null;
  goal: number;
  onAgain: () => void;
  onAdd: () => void;
}) {
  const more = today ? today.due + today.fresh > 0 : false;
  return (
    <div className="ov__body ov__center">
      {done === 0 ? (
        <>
          <p className="ov__big">Nothing due right now.</p>
          <p className="rt-small rt-ink-faint">
            {today && today.fresh === 0
              ? 'No new cards in overlay sets either. Add some, or switch a set into the overlay on its page.'
              : 'Come back later, or raise “new cards per round” in Settings.'}
          </p>
        </>
      ) : (
        <>
          <p className="ov__big">
            Round done: {right} of {done} right.
          </p>
          {today && (
            <p className="rt-small rt-ink-faint">
              {today.reviewed >= goal ? `Daily goal reached (${today.reviewed}/${goal}).` : `${today.reviewed}/${goal} today.`}
            </p>
          )}
        </>
      )}
      <div className="rt-btnrow ov__end-actions">
        {more && (
          <button type="button" className="rt-btn rt-btn--sm rt-btn--primary" onClick={onAgain}>
            <span className="ov__key">R</span> another round
          </button>
        )}
        <button type="button" className="rt-btn rt-btn--sm" onClick={onAdd}>
          <span className="ov__key">A</span> add a card
        </button>
      </div>
    </div>
  );
}

function QuickAdd({ onDone }: { onDone: () => void }) {
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
        setSetId(last ?? list[0]?.id ?? null);
      })
      .catch((err) => setError(asApiError(err).message));
    termRef.current?.focus();
  }, []);

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
      className="ov__body ov__add"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <select
        className="rt-input"
        aria-label="Set"
        value={setId ?? ''}
        onChange={(e) => setSetId(Number(e.target.value))}
      >
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
          {error ? <span className="rt-rust">{error}</span> : saved ? `Added “${saved}”.` : 'Tab moves on, Esc goes back.'}
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
