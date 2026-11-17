
import { ask } from '@/components/Dialogs';
import Link from '@/components/Link';
import { announceDataChange } from '@/lib/app/events';
import { importFile } from '@/lib/app/native';
import { useRouter } from '@/lib/app/router';
import { importAll, parseExport } from '@/lib/store/transfer';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { TodayPanel } from '@/components/TodayPanel';
import { useDataVersion } from '@/lib/app/events';
import { createFolder, errorMessage, fetchFolders, fetchSets, renameFolder } from '@/lib/flashcards/client';
import { plural } from '@/lib/flashcards/format';
import { LIMITS, type SetSummaryDTO } from '@/lib/flashcards/types';
import {
  IconChevronLeft,
  IconChevronRight,
  IconFolder,
  IconFolderPlus,
  IconGenerate,
  IconImport,
  IconPlus,
  IconSearch,
} from '@/components/flashcards/FlashcardIcons';

type Folder = { name: string; sets: number; cards: number };

/** Past this many of your own sets, the list gets a search box. */
const SEARCH_FROM = 6;

/**
 * The sets screen: today's numbers, then the folders and the sets in none.
 * A folder can be made here, empty; filing a set happens on the set's own
 * page (or by making it inside the folder), so a set row is one link and
 * nothing on it can be mis-clicked.
 */
export function SetsClient() {
  const router = useRouter();
  const [sets, setSets] = useState<SetSummaryDTO[] | null>(null);
  // Every folder by name, the empty ones too (sets only name the full ones).
  const [folderNames, setFolderNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // In the URL (?folder=), so coming back from a set opens the same folder.
  const [params, setParams] = useSearchParams();
  const folder = params.get('folder') || null;
  const setFolder = (name: string | null) =>
    setParams(name ? { folder: name } : {}, { replace: true });
  const [query, setQuery] = useState('');
  // Re-read when the overlay (the other window) studies or adds cards.
  const version = useDataVersion();

  useEffect(() => {
    Promise.all([fetchSets(), fetchFolders()])
      .then(([res, f]) => {
        setFolderNames(f.folders);
        setSets(res.sets);
      })
      .catch((err: unknown) => setError(errorMessage(err, 'Could not load your sets.')));
  }, [version]);

  const mine = useMemo(() => sets ?? [], [sets]);

  const folders = useMemo(() => {
    const byName = new Map<string, Folder>(folderNames.map((name) => [name, { name, sets: 0, cards: 0 }]));
    for (const s of mine) {
      if (!s.folder) continue;
      const f = byName.get(s.folder) ?? { name: s.folder, sets: 0, cards: 0 };
      f.sets += 1;
      f.cards += s.cardCount;
      byName.set(s.folder, f);
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [mine, folderNames]);

  // A folder renamed or removed (here or in the other window) is gone; fall back out.
  // Only once the sets are in: before that every folder looks empty.
  useEffect(() => {
    if (sets !== null && folder !== null && !folders.some((f) => f.name === folder)) setFolder(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, folder, folders]);

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
      setFolderNames((prev) => [...new Set(prev.map((n) => (n === from ? to : n)))]);
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
      setFolderNames((prev) => prev.filter((n) => n !== name));
      setSets((prev) => prev?.map((s) => (s.isOwner && s.folder === name ? { ...s, folder: null } : s)) ?? null);
      setFolder(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the folder.'));
    }
  }

  /** An empty folder, opened at once so its first set can be made right there. */
  async function newFolder() {
    const name = (await ask.prompt('Name the new folder:'))?.trim();
    if (!name) return;
    if (name.length > LIMITS.folderNameLength) {
      setError(`Keep folder names under ${LIMITS.folderNameLength} characters.`);
      return;
    }
    setError(null);
    try {
      const { folder: made } = await createFolder(name);
      setFolderNames((prev) => (prev.includes(made) ? prev : [...prev, made]));
      setQuery('');
      setFolder(made);
    } catch (err) {
      setError(errorMessage(err, 'Could not make the folder.'));
    }
  }

  const newSetHref = folder ? `/flashcards/new?folder=${encodeURIComponent(folder)}` : '/flashcards/new';

  /**
   * A set someone sent (or any Flashcards export): added as new sets, into
   * the folder showing, and opened when it is just one.
   */
  async function openShared() {
    setError(null);
    try {
      const text = await importFile('json');
      if (text === null) return;
      const file = parseExport(text);
      if (file.sets.length === 0) {
        setError('That file has no sets in it.');
        return;
      }
      if (file.sets.length > 1) {
        const cards = file.sets.reduce((n, x) => n + x.cards.length, 0);
        const yes = await ask.confirm(
          `That file holds ${file.sets.length} sets with ${cards} cards. Add them all? Your sets stay as they are.`,
          { ok: 'add them' },
        );
        if (!yes) return;
      }
      const res = await importAll(file, { folder });
      announceDataChange();
      if (res.setIds.length === 1) router.push(`/flashcards/${res.setIds[0]}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not open that file.'));
    }
  }

  return (
    <main>
      <div className="rt-pagehead fc-pagehead">
        <h1>your sets</h1>
        <div className="rt-btnrow">
          <button
            type="button"
            className="rt-btn rt-btn--sm"
            onClick={() => void openShared()}
            title="Add a set someone sent you (a Flashcards .json file)"
          >
            <IconImport />
            Open shared set
          </button>
          <Link href="/flashcards/new?import=1" className="rt-btn rt-btn--sm" title="Paste or load cards as text">
            <IconImport />
            Import
          </Link>
          <Link href="/flashcards/new?generate=1" className="rt-btn rt-btn--sm">
            <IconGenerate />
            Generate
          </Link>
          {folder === null && (
            <button
              type="button"
              className="rt-btn rt-btn--sm"
              onClick={() => void newFolder()}
              title="Make an empty folder to put sets in"
            >
              <IconFolderPlus />
              New folder
            </button>
          )}
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
            ) : folder !== null ? (
              <div className="rt-empty">
                Nothing in this folder yet. <Link href={newSetHref}>Make a set</Link> here, or open a set
                and use <b>put in a folder</b>.
              </div>
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
                    <Link href="/flashcards/new?import=1">paste in a list</Link> of terms, or import
                    an export file under <Link href="/settings#data">Settings → Data</Link>.
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
