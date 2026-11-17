// "What's new in 0.1.20": shown once in the main window after an update,
// from the CHANGELOG.md built into the app. A first install shows nothing (a
// new user has no "before" to compare with); it only remembers the version.

import changelogText from '../../CHANGELOG.md?raw';
import { useEffect, useMemo, useState } from 'react';

import { changesSince, parseChangelog, parseGroups, plainLine, type ChangeGroup } from '@/lib/app/changelog';
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
      <Versions entries={news} />
    </section>
  );
}

/**
 * Every version an update brings, from the releases' notes on GitHub, for
 * Settings before installing. Null when none of them has notes.
 */
export function UpdateNotes({ missed }: { missed: { version: string; notes: string }[] }) {
  const entries = missed
    .map((m) => ({ version: m.version, groups: parseGroups(m.notes) }))
    .filter((e) => e.groups.length > 0);
  if (entries.length === 0) return null;
  return (
    <>
      <div className="rt-note__title">
        What&apos;s new in {entries.length > 1 ? `the ${entries.length} versions up to ${entries[0].version}` : entries[0].version}
      </div>
      <Versions entries={entries} />
    </>
  );
}

/** Versions newest first, a label on each when there are several; past MOST, behind a button. */
function Versions({ entries }: { entries: { version: string; groups: ChangeGroup[] }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, MOST);
  return (
    <>
      {shown.map((entry) => (
        <div key={entry.version} className="fc-news__version">
          {entries.length > 1 && <div className="fc-news__label">{entry.version}</div>}
          <ChangeGroups groups={entry.groups} />
        </div>
      ))}
      {entries.length > shown.length && (
        <button type="button" className="rt-linkbtn fc-news__more" onClick={() => setAll(true)}>
          {entries.length - shown.length === 1 ? 'show 1 earlier version' : `show ${entries.length - shown.length} earlier versions`}
        </button>
      )}
    </>
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
