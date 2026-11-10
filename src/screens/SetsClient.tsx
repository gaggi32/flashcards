
import { ask } from '@/components/Dialogs';
import Link from '@/components/Link';
import { useEffect, useMemo, useState } from 'react';

import { TodayPanel } from '@/components/TodayPanel';
import { useDataVersion } from '@/lib/app/events';
import { errorMessage, fetchSets, renameFolder } from '@/lib/flashcards/client';
import { plural } from '@/lib/flashcards/format';
import { LIMITS, type SetSummaryDTO } from '@/lib/flashcards/types';
import {
  IconChevronLeft,
  IconChevronRight,
  IconFolder,
  IconGenerate,
  IconImport,
  IconPlus,
  IconSearch,
} from '@/components/flashcards/FlashcardIcons';

type Folder = { name: string; sets: number; cards: number };

/** Past this many of your own sets, the list gets a search box. */
const SEARCH_FROM = 6;

/**
 * The sets screen: today's numbers, then every set (a folder is just a label
 * on them). Filing a set happens on the set's own page; this screen only
 * browses, so a row is one link and nothing on it can be mis-clicked.
 */
export function SetsClient() {
  const [sets, setSets] = useState<SetSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Re-read when the overlay (the other window) studies or adds cards.
  const version = useDataVersion();

  useEffect(() => {
    fetchSets()
      .then((res) => setSets(res.sets))
      .catch((err: unknown) => setError(errorMessage(err, 'Could not load your sets.')));
  }, [version]);

  const mine = useMemo(() => sets ?? [], [sets]);

  const folders = useMemo(() => {
    const byName = new Map<string, Folder>();
    for (const s of mine) {
      if (!s.folder) continue;
      const f = byName.get(s.folder) ?? { name: s.folder, sets: 0, cards: 0 };
      f.sets += 1;
      f.cards += s.cardCount;
      byName.set(s.folder, f);
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [mine]);

  // A folder that was emptied (or renamed away) stops existing; fall back out.
  useEffect(() => {
    if (folder !== null && !folders.some((f) => f.name === folder)) setFolder(null);
  }, [folder, folders]);

  // A search looks through every one of your sets, whichever folder it is in.
  const searching = query.trim() !== '';
  const visible = searching
    ? mine.filter((s) => matches(s, query))
    : folder !== null
      ? mine.filter((s) => s.folder === folder)
      : mine.filter((s) => s.folder === null);

  async function rename(from: string) {
    const to = (await ask.prompt(`Rename the folder "${from}" to:`, from))?.trim();
    if (!to || to === from) return;
    if (to.length > LIMITS.folderNameLength) {
      setError(`Keep folder names under ${LIMITS.folderNameLength} characters.`);
      return;
    }
    setError(null);
    try {
      await renameFolder(from, to);
      setSets((prev) => prev?.map((s) => (s.isOwner && s.folder === from ? { ...s, folder: to } : s)) ?? null);
      setFolder(to);
    } catch (err) {
      setError(errorMessage(err, 'Could not rename the folder.'));
    }
  }

  async function dissolve(name: string) {
    if (!(await ask.confirm(`Remove the folder "${name}"? Its sets stay, just outside any folder.`, { ok: 'remove' }))) return;
    setError(null);
    try {
      await renameFolder(name, null);
      setSets((prev) => prev?.map((s) => (s.isOwner && s.folder === name ? { ...s, folder: null } : s)) ?? null);
      setFolder(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the folder.'));
    }
  }

  const newSetHref = folder ? `/flashcards/new?folder=${encodeURIComponent(folder)}` : '/flashcards/new';

  return (
    <main>
      <div className="rt-pagehead fc-pagehead">
        <h1>your sets</h1>
        <div className="rt-btnrow">
          <Link href="/flashcards/new?import=1" className="rt-btn rt-btn--sm">
            <IconImport />
            Import
          </Link>
          <Link href="/flashcards/new?generate=1" className="rt-btn rt-btn--sm">
            <IconGenerate />
            Generate
          </Link>
          <Link href={newSetHref} className="rt-btn rt-btn--sm rt-btn--primary">
            <IconPlus />
            New set
          </Link>
        </div>
      </div>

      <TodayPanel version={version} />

      <section className="rt-section">
        {error && <div className="rt-note rt-note--err">{error}</div>}

        {sets === null && !error && (
          <div className="fc-list" aria-busy="true">
            <div className="fc-skel" style={{ height: 68 }} />
            <div className="fc-skel" style={{ height: 68 }} />
            <div className="fc-skel" style={{ height: 68 }} />
          </div>
        )}

        {sets && (
          <>
            {mine.length > SEARCH_FROM && (
              <SearchBox value={query} onChange={setQuery} label="Search your sets" />
            )}

            {searching ? null : folder !== null ? (
              <div className="fc-crumbs">
                <button type="button" className="fc-crumbs__back" onClick={() => setFolder(null)}>
                  <IconChevronLeft />
                  My sets
                </button>
                <span className="fc-crumbs__here">
                  <IconFolder size={16} />
                  {folder}
                </span>
                <span className="fc-crumbs__spacer" />
                <button type="button" className="rt-linkbtn rt-small" onClick={() => rename(folder)}>
                  rename
                </button>
                <button type="button" className="rt-linkbtn rt-small rt-rust" onClick={() => dissolve(folder)}>
                  remove folder
                </button>
              </div>
            ) : (
              folders.length > 0 && (
                <>
                  <div className="rt-label">folders</div>
                  <div className="fc-list">
                    {folders.map((f) => (
                      <button
                        key={f.name}
                        type="button"
                        className="fc-row fc-row--folder"
                        onClick={() => setFolder(f.name)}
                      >
                        <span className="fc-row__badge" aria-hidden="true">
                          <IconFolder size={20} />
                        </span>
                        <span className="fc-row__body">
                          <span className="fc-row__name">{f.name}</span>
                          <span className="fc-row__meta">
                            {plural(f.sets, 'set')} · {plural(f.cards, 'term')}
                          </span>
                        </span>
                        <IconChevronRight />
                      </button>
                    ))}
                  </div>
                </>
              )
            )}

            {!searching && folder === null && folders.length > 0 && visible.length > 0 && (
              <div className="rt-label fc-label-gap">not in a folder</div>
            )}

            {visible.length > 0 ? (
              <div className="fc-list">
                {visible.map((set) => (
                  <SetRow key={set.id} set={set} showFolder={searching} />
                ))}
              </div>
            ) : searching ? (
              <div className="rt-empty">None of your sets match that.</div>
            ) : (
              mine.length === 0 && (
                <div className="fc-emptystate">
                  <span className="fc-emptystate__art" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <p>No sets yet.</p>
                  <p className="rt-small">
                    <Link href="/flashcards/new">Make one</Link>,{' '}
                    <Link href="/flashcards/new?import=1">paste in a list</Link> of terms, or bring
                    your sets over from 404canvas.ch under{' '}
                    <Link href="/settings#data">Settings → Data</Link>.
                  </p>
                </div>
              )
            )}

          </>
        )}
      </section>
    </main>
  );
}

function matches(set: SetSummaryDTO, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [set.title, set.description ?? '', set.authorName ?? ''].some((v) => v.toLowerCase().includes(q));
}

function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="fc-search">
      <IconSearch size={16} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
      />
    </label>
  );
}

/** The badge carries the count, so the title gets the whole width beside it. */
function SetRow({
  set,
  showFolder = false,
}: {
  set: SetSummaryDTO;
  /** While searching, where each hit is filed stands in for its description. */
  showFolder?: boolean;
}) {
  const folder = showFolder ? set.folder : null;
  const sub = folder ?? set.description;
  return (
    <Link href={`/flashcards/${set.id}`} className="fc-row">
      <span className="fc-row__badge" aria-label={plural(set.cardCount, 'term')}>
        <span className="fc-row__count">{set.cardCount}</span>
        <span className="fc-row__unit" aria-hidden="true">
          {set.cardCount === 1 ? 'term' : 'terms'}
        </span>
      </span>
      <span className="fc-row__body">
        <span className="fc-row__name">{set.title}</span>
        {sub && (
          <span className="fc-row__meta">
            {sub && (
              <span className="fc-row__desc">
                {folder && <IconFolder size={13} />}
                {sub}
              </span>
            )}
          </span>
        )}
      </span>
      <IconChevronRight />
    </Link>
  );
}
