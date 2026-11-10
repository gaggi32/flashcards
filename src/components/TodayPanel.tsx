// Where you stand, above the sets list: cards in overlay sets by learn status,
// the day streak, and the way into the overlay. No dates or daily quotas.

import { useEffect, useRef, useState } from 'react';

import { formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import { showOverlay } from '@/lib/app/native';
import { useSettings } from '@/lib/app/settings';
import { todayKey } from '@/lib/nutrition/day';
import { overview, type Overview } from '@/lib/store/repo';

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

  useEffect(() => {
    overview(todayKey())
      .then(setN)
      .catch(() => setN(null));
  }, [version]);

  if (!n || !settings) return null;
  const total = n.fresh + n.learning + n.learned;
  const pct = (x: number) => (total ? (x / total) * 100 : 0);

  return (
    <section className="rt-section today fx-rise">
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
          title={total === 0 ? 'No cards in overlay sets yet' : undefined}
        >
          study now
        </button>
      </div>
      <div className="today__bar" role="img" aria-label={`${n.learned} learned, ${n.learning} learning, ${n.fresh} new`}>
        <span className="is-learned" style={{ width: `${pct(n.learned)}%` }} />
        <span className="is-learning" style={{ width: `${pct(n.learning)}%` }} />
      </div>
      <p className="rt-small rt-ink-faint today__hint">
        Press <span className="rt-kbd">{formatHotkey(settings.hotkey, isMacPlatform())}</span> anywhere to
        open the overlay.
      </p>
    </section>
  );
}
