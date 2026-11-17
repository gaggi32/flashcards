// "What's new": shown once in the main window after an update, from the
// CHANGELOG.md built into the app, and in Settings for the versions an update
// would bring. A first install shows nothing (a new user has no "before" to
// compare with); it only remembers the version.
//
// The newest version is open; older ones are one line each ("1.2.0 · 4
// changes") that open on a click, so a long way behind stays readable.

import changelogText from '../../CHANGELOG.md?raw';
import { useEffect, useMemo, useState } from 'react';

import { changesSince, parseChangelog, parseGroups, plainLine, type ChangeGroup } from '@/lib/app/changelog';
import { appInfo, markVersionSeen } from '@/lib/app/native';
import { useSettings } from '@/lib/app/settings';
import { IconChevronRight } from './flashcards/FlashcardIcons';

type Version = { version: string; date?: string; groups: ChangeGroup[] };

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
    <section className="fc-news" aria-labelledby="fc-news-title">
      <div className="fc-news__head">
        <div>
          <h2 id="fc-news-title" className="fc-news__title">
            What&apos;s new
          </h2>
          <p className="fc-news__sub">
            {news.length > 1 ? `Flashcards ${running} · ${news.length} versions since ${seen}` : `Flashcards ${running}`}
          </p>
        </div>
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
export function UpdateNotes({ missed, current }: { missed: { version: string; notes: string }[]; current: string }) {
  const entries = missed
    .map((m) => ({ version: m.version, groups: parseGroups(m.notes) }))
    .filter((e) => e.groups.length > 0);
  if (entries.length === 0) return null;
  return (
    <>
      <div className="fc-news__head">
        <div>
          <h3 className="fc-news__title">What&apos;s new in {entries[0].version}</h3>
          <p className="fc-news__sub">
            {entries.length > 1 ? `${entries.length} versions since yours (${current})` : `You have ${current}`}
          </p>
        </div>
      </div>
      <Versions entries={entries} />
    </>
  );
}

/** The newest version open, older ones folded to a line each. */
function Versions({ entries }: { entries: Version[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([entries[0]?.version]));
  const several = entries.length > 1;
  return (
    <div className="fc-news__versions">
      {entries.map((entry) => {
        const isOpen = open.has(entry.version);
        const count = entry.groups.reduce((n, g) => n + g.items.length, 0);
        return (
          <div key={entry.version} className="fc-news__version">
            {several && (
              <button
                type="button"
                className={`fc-news__toggle${isOpen ? ' is-open' : ''}`}
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((s) => {
                    const next = new Set(s);
                    if (isOpen) next.delete(entry.version);
                    else next.add(entry.version);
                    return next;
                  })
                }
              >
                <IconChevronRight size={14} />
                <span className="fc-news__vnum">{entry.version}</span>
                {entry.date && <span className="fc-news__date">{formatDate(entry.date)}</span>}
                {!isOpen && <span className="fc-news__count">{count === 1 ? '1 change' : `${count} changes`}</span>}
              </button>
            )}
            {(isOpen || !several) && <ChangeGroups groups={entry.groups} />}
          </div>
        );
      })}
    </div>
  );
}

const TAGS: Record<string, { label: string; tone: string }> = {
  added: { label: 'New', tone: 'new' },
  changed: { label: 'Improved', tone: 'improved' },
  fixed: { label: 'Fixed', tone: 'fixed' },
  removed: { label: 'Removed', tone: 'removed' },
  security: { label: 'Security', tone: 'fixed' },
};

/** A version's groups: a coloured tag per kind of change, its items as a list. */
export function ChangeGroups({ groups }: { groups: ChangeGroup[] }) {
  return (
    <div className="fc-news__groups">
      {groups.map((g) => {
        const tag = TAGS[g.heading.toLowerCase()] ?? { label: g.heading, tone: 'other' };
        return (
          <div key={g.heading} className="fc-news__group">
            <span className={`fc-news__tag fc-news__tag--${tag.tone}`}>{tag.label}</span>
            <ul className="fc-news__list">
              {g.items.map((item) => (
                <li key={item}>{plainLine(item)}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** "2026-11-17" as "17 Nov 2026"; anything else as it is. */
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
