// The overlay's panel above the sets list: which set the overlay studies (one
// set, or the mix of sets switched into it), where that stands by learn
// status, the day streak, and the way in. No dates or daily quotas.

import { useEffect, useRef, useState } from 'react';

import { formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import { showOverlay } from '@/lib/app/native';
import { usePref } from '@/lib/app/prefs';
import { useSettings } from '@/lib/app/settings';
import type { SetSummaryDTO } from '@/lib/flashcards/types';
import { todayKey } from '@/lib/nutrition/day';
import { listSets, overview, type Overview } from '@/lib/store/repo';

/** Counts from the last shown value to the new one, so a change visibly moves. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);
  return <>{shown}</>;
}

export function TodayPanel({ version }: { version: number }) {
  const { settings } = useSettings();
  const [n, setN] = useState<Overview | null>(null);
  const [sets, setSets] = useState<SetSummaryDTO[]>([]);
  const [chosen, setChosen] = usePref('overlaySet');

  // A chosen set that has since been deleted falls back to the mix.
  const studying = chosen !== 'all' && sets.length > 0 && !sets.some((s) => s.id === chosen) ? 'all' : chosen;

  useEffect(() => {
    listSets()
      .then(setSets)
      .catch(() => setSets([]));
  }, [version]);

  useEffect(() => {
    overview(todayKey(), studying === 'all' ? null : studying)
      .then(setN)
      .catch(() => setN(null));
  }, [version, studying]);

  if (!n || !settings) return null;
  const inMix = sets.filter((s) => s.inOverlay !== false).length;
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
          onChange={(e) => setChosen(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">
            Mix of {inMix} set{inMix === 1 ? '' : 's'}
          </option>
          {[...sets]
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
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
        {studying === 'all'
          ? 'The mix is every set whose “in the overlay” switch is on (on each set’s page). '
          : 'Only this set, until you pick another here or in the overlay. '}
        Press <span className="rt-kbd">{formatHotkey(settings.hotkey, isMacPlatform())}</span> anywhere to
        open it.
      </p>
    </section>
  );
}
