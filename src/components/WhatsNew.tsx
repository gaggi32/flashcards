// "What's new in 0.1.20": shown once in the main window after an update,
// from the CHANGELOG.md built into the app. A first install shows nothing (a
// new user has no "before" to compare with); it only remembers the version.

import changelogText from '../../CHANGELOG.md?raw';
import { useEffect, useMemo, useState } from 'react';

import { changesSince, parseChangelog, plainLine, type ChangeGroup } from '@/lib/app/changelog';
import { appInfo, markVersionSeen } from '@/lib/app/native';
import { useSettings } from '@/lib/app/settings';

/** Past this many versions, the card says "and earlier changes" instead. */
const MOST = 3;

export function WhatsNew() {
  const { settings } = useSettings();
  const [running, setRunning] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const entries = useMemo(() => parseChangelog(changelogText), []);

  useEffect(() => {
    appInfo()
      .then((i) => setRunning(i.version))
      .catch(() => {});
  }, []);

  const seen = settings?.lastSeenVersion;

  // First start (nothing seen yet): remember this version, show nothing.
  useEffect(() => {
    if (running && seen === '') void markVersionSeen(running).catch(() => {});
  }, [running, seen]);

  if (!running || !seen || dismissed) return null;
  const news = changesSince(entries, seen, running);
  if (news.length === 0) return null;

  const shown = news.slice(0, MOST);
  return (
    <section className="rt-note rt-note--ok fc-news" aria-label={`What's new in ${running}`}>
      <div className="fc-news__head">
        <div className="rt-note__title">What&apos;s new in {running}</div>
        <button
          type="button"
          className="rt-btn rt-btn--sm"
          onClick={() => {
            setDismissed(true);
            void markVersionSeen(running).catch(() => {});
          }}
        >
          got it
        </button>
      </div>
      {shown.map((entry) => (
        <div key={entry.version} className="fc-news__version">
          {shown.length > 1 && <div className="fc-news__label">{entry.version}</div>}
          <ChangeGroups groups={entry.groups} />
        </div>
      ))}
      {news.length > MOST && <p className="rt-small rt-ink-faint">…and earlier changes, listed in CHANGELOG.md on GitHub.</p>}
    </section>
  );
}

/** Headings and their items, for the card and for an update's notes in Settings. */
export function ChangeGroups({ groups }: { groups: ChangeGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.heading} className="fc-news__group">
          <span className="fc-news__heading">{g.heading.toLowerCase()}</span>
          <ul>
            {g.items.map((item) => (
              <li key={item}>{plainLine(item)}</li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
