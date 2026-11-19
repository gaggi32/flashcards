// The overlay's panel above the sets list: which set the overlay studies,
// where that set stands by learn status, the day streak, and the way in.
// No dates or daily quotas.

import { useEffect, useState } from 'react';

import { CountUp } from '@/components/motion/CountUp';

import { formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import { showOverlay } from '@/lib/app/native';
import { studySetFrom, usePref } from '@/lib/app/prefs';
import { useSettings } from '@/lib/app/settings';
import { SetOptions } from '@/components/flashcards/SetOptions';
import type { SetSummaryDTO } from '@/lib/flashcards/types';
import { todayKey } from '@/lib/nutrition/day';
import { listSets, overview, type Overview } from '@/lib/store/repo';


export function TodayPanel({ version }: { version: number }) {
  const { settings } = useSettings();
  const [n, setN] = useState<Overview | null>(null);
  const [sets, setSets] = useState<SetSummaryDTO[]>([]);
  const [chosen, setChosen] = usePref('overlaySet');

  const studying = studySetFrom(chosen, sets);

  useEffect(() => {
    listSets()
      .then(setSets)
      .catch(() => setSets([]));
  }, [version]);

  useEffect(() => {
    if (studying === null) return;
    overview(todayKey(), studying)
      .then(setN)
      .catch(() => setN(null));
  }, [version, studying]);

  if (!n || !settings || studying === null) return null;
  const total = n.fresh + n.learning + n.learned;
  const pct = (x: number) => (total ? (x / total) * 100 : 0);

  return (
    <section className="rt-section today fx-rise">
      <div className="today__head">
        <label className="today__title" htmlFor="today-set">
          The overlay studies
        </label>
        <select
          id="today-set"
          className="rt-input today__select"
          value={String(studying)}
          onChange={(e) => setChosen(Number(e.target.value))}
        >
          <SetOptions sets={sets} />
        </select>
      </div>
      <div className="today__stats">
        <div className="today__stat">
          <span className="today__num">
            <CountUp value={n.fresh} />
          </span>
          <span className="today__label">
            <i className="today__dot is-new" /> new
          </span>
        </div>
        <div className="today__stat">
          <span className="today__num">
            <CountUp value={n.learning} />
          </span>
          <span className="today__label">
            <i className="today__dot is-learning" /> learning
          </span>
        </div>
        <div className="today__stat">
          <span className="today__num">
            <CountUp value={n.learned} />
          </span>
          <span className="today__label">
            <i className="today__dot is-learned" /> learned
          </span>
        </div>
        <div className={`today__stat today__streak${n.answeredToday ? ' is-lit' : ''}`}>
          <span className="today__num">
            <CountUp value={n.streak} />
          </span>
          <span className="today__label">day streak</span>
        </div>
        <button
          type="button"
          className="rt-btn rt-btn--primary today__go"
          onClick={() => void showOverlay()}
          disabled={total === 0}
          title={total === 0 ? 'No cards to study here yet' : undefined}
        >
          study now
        </button>
      </div>
      <div className="today__bar" role="img" aria-label={`${n.learned} learned, ${n.learning} learning, ${n.fresh} new`}>
        <span className="is-learned" style={{ width: `${pct(n.learned)}%` }} />
        <span className="is-learning" style={{ width: `${pct(n.learning)}%` }} />
      </div>
      <p className="rt-small rt-ink-faint today__hint">
        Pick another set here, in the overlay, or on a set’s page. Press <span className="rt-kbd">{formatHotkey(settings.hotkey, isMacPlatform())}</span> anywhere to
        open it.
      </p>
    </section>
  );
}
