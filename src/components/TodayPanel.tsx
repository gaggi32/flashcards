// Today's numbers above the sets list, and the way into the overlay.

import { useEffect, useState } from 'react';

import { formatHotkey, isMacPlatform } from '@/lib/app/hotkey';
import { showOverlay } from '@/lib/app/native';
import { useSettings } from '@/lib/app/settings';
import { todayKey } from '@/lib/nutrition/day';
import { todayNumbers, type Today } from '@/lib/store/repo';

export function TodayPanel({ version }: { version: number }) {
  const { settings } = useSettings();
  const [n, setN] = useState<Today | null>(null);

  useEffect(() => {
    todayNumbers(todayKey())
      .then(setN)
      .catch(() => setN(null));
  }, [version]);

  if (!n || !settings) return null;
  const goal = settings.dailyGoal;
  const pct = Math.min(100, Math.round((n.reviewed / goal) * 100));

  return (
    <section className="rt-section today">
      <div className="today__stats">
        <div className="today__stat">
          <span className="today__num">{n.due}</span>
          <span className="today__label">due</span>
        </div>
        <div className="today__stat">
          <span className="today__num">{n.fresh}</span>
          <span className="today__label">new</span>
        </div>
        <div className="today__stat">
          <span className="today__num">
            {n.reviewed}
            <span className="today__of">/{goal}</span>
          </span>
          <span className="today__label">today</span>
        </div>
        <div className="today__stat">
          <span className="today__num">{n.streak}</span>
          <span className="today__label">day streak</span>
        </div>
        <button
          type="button"
          className="rt-btn rt-btn--primary today__go"
          onClick={() => void showOverlay()}
          disabled={n.due + n.fresh === 0}
          title={n.due + n.fresh === 0 ? 'No cards due and none new in overlay sets' : undefined}
        >
          study now
        </button>
      </div>
      <div className="today__bar" aria-label={`${n.reviewed} of ${goal} answers today`}>
        <span style={{ width: `${pct}%` }} className={pct >= 100 ? 'is-full' : ''} />
      </div>
      <p className="rt-small rt-ink-faint today__hint">
        Press <span className="rt-kbd">{formatHotkey(settings.hotkey, isMacPlatform())}</span> anywhere to
        open the overlay.
      </p>
    </section>
  );
}
