
import { ask } from '@/components/Dialogs';
import Link from '@/components/Link';
import { importFile } from '@/lib/app/native';
import { useRouter } from '@/lib/app/router';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';

import { addSetsFromText } from '@/components/SetFileDrop';
import { clearOwnDrag, dragSetFile, ownDraggedSet, prepareSetFile } from '@/lib/app/setDrag';
import { TodayPanel } from '@/components/TodayPanel';
import { useDataVersion } from '@/lib/app/events';
import { createFolder, errorMessage, fetchFolders, fetchSets, renameFolder, updateSet } from '@/lib/flashcards/client';
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

/** A set row of this window being dragged (an OS file drag, see setDrag.ts). */
const isSetDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files') && ownDraggedSet() !== null;

/** Past this many of your own sets, the list gets a search box. */
const SEARCH_FROM = 6;

/**
 * The sets screen: today's numbers, then the folders and the sets in none.
 * A folder can be made here, empty. A set is filed by dragging its row onto
 * a folder (and out again onto "My sets"), on the set's own page, or by
 * making it inside the folder; a set row stays one link with nothing on it
 * to mis-click.
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
  // The folder a set is being dragged over ('' for "My sets"), to light it up.
  const [dropOn, setDropOn] = useState<string | null>(null);
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

  /** A set dropped on a folder (or on "My sets", `to: null`) moves there. */
  async function fileSet(id: number, to: string | null) {
    setDropOn(null);
    const set = mine.find((s) => s.id === id);
    if (!set || set.folder === to) return;
    setError(null);
    try {
      const { set: saved } = await updateSet(id, { folder: to });
      setSets((prev) => prev?.map((s) => (s.id === id ? { ...s, folder: saved.folder } : s)) ?? null);
    } catch (err) {
      setError(errorMessage(err, 'Could not move the set.'));
    }
  }

  /** Drag handlers for a place a set can be dropped on: `key` lights it, `to` is where it goes. */
  function dropTarget(key: string, to: string | null) {
    return {
      onDragOver(e: DragEvent) {
        if (!isSetDrag(e)) return;
        e.preventDefault();
        // 'copy', the only effect the OS drag allows (drag_set_out in lib.rs
        // starts it as a copy, so the desktop gets a copy of the file). Any
        // other effect makes Windows refuse the drop: no drop event at all.
        e.dataTransfer.dropEffect = 'copy';
        if (dropOn !== key) setDropOn(key);
      },
      onDragLeave(e: DragEvent) {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropOn((cur) => (cur === key ? null : cur));
      },
      onDrop(e: DragEvent) {
        if (!isSetDrag(e)) return;
        // Handled here: the window's file drop (SetFileDrop) sees this and
        // leaves the set's file alone.
        e.preventDefault();
        const id = ownDraggedSet();
        clearOwnDrag();
        if (id !== null) void fileSet(id, to);
        else setDropOn(null);
      },
    };
  }


  const newSetHref = folder ? `/flashcards/new?folder=${encodeURIComponent(folder)}` : '/flashcards/new';

  /**
   * A set someone sent (or any Flashcards export): added as new sets, into
   * the folder showing, and opened when it is just one. Dropping the file on
   * the window does the same (SetFileDrop).
   */
  async function openShared() {
    setError(null);
    try {
      const text = await importFile('json');
      if (text === null) return;
      const ids = await addSetsFromText(text, folder);
      if (ids?.length === 1) router.push(`/flashcards/${ids[0]}`);
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
            title="Add a set someone sent you (a Flashcards .json file). You can also drop the file on the window."
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
                <button
                  type="button"
                  className={`fc-crumbs__back${dropOn === '' ? ' fc-dropon' : ''}`}
                  onClick={() => setFolder(null)}
                  title="Drop a set here to take it out of the folder"
                  {...dropTarget('', null)}
                >
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
                        className={`fc-row fc-row--folder${dropOn === f.name ? ' fc-dropon' : ''}`}
                        onClick={() => setFolder(f.name)}
                        {...dropTarget(f.name, f.name)}
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
              <div className="rt-label fc-label-gap">
                not in a folder <span className="fc-label-hint">· drag one onto a folder to file it</span>
              </div>
            )}

            {visible.length > 0 ? (
              <div className="fc-list">
                {visible.map((set) => (
                  <SetRow
                    key={set.id}
                    set={set}
                    showFolder={searching}
                    onDragDone={() => setDropOn(null)}
                  />
                ))}
              </div>
            ) : searching ? (
              <div className="rt-empty">None of your sets match that.</div>
            ) : folder !== null ? (
              <div className="rt-empty">
                Nothing in this folder yet. <Link href={newSetHref}>Make a set</Link> here, drag one onto
                the folder from <b>My sets</b>, or open a set and use <b>put in a folder</b>.
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

/** A set is drawn as a stack of index cards: one, two or three deep. */
function stackOf(cards: number): 1 | 2 | 3 {
  return cards >= 30 ? 3 : cards >= 10 ? 2 : 1;
}

/** A set's index card: its title above the red line, the count below. */
function SetRow({
  set,
  showFolder = false,
  onDragDone,
}: {
  set: SetSummaryDTO;
  /** While searching, where each hit is filed stands in for its description. */
  showFolder?: boolean;
  /** The row's drag is over, wherever it ended. */
  onDragDone?: () => void;
}) {
  const folder = showFolder ? set.folder : null;
  const sub = folder ?? set.description;
  // Pressed here and not yet dragged: where, and the set's file, read at once
  // so the OS drag can start the moment the pointer has moved far enough.
  const press = useRef<{ x: number; y: number; file: Promise<{ contents: string; name: string }> } | null>(null);
  const dragging = useRef(false);
  return (
    <Link
      href={`/flashcards/${set.id}`}
      className={`fc-row fc-row--set fc-row--stack${stackOf(set.cardCount)}`}
      draggable={false}
      title="Open the set, or drag it onto a folder, the desktop or another app"
      onPointerDown={(e) => {
        if (e.button !== 0 || e.pointerType !== 'mouse') return;
        const file = prepareSetFile(set.id, set.title);
        file.catch(() => {});
        press.current = { x: e.clientX, y: e.clientY, file };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p || dragging.current) return;
        if (!(e.buttons & 1)) {
          press.current = null;
          return;
        }
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
        press.current = null;
        dragging.current = true;
        void (async () => {
          try {
            await dragSetFile(set.id, await p.file);
          } catch {
            // Nothing to undo: the set is where it was.
          } finally {
            dragging.current = false;
            onDragDone?.();
          }
        })();
      }}
      onPointerUp={() => {
        press.current = null;
      }}
    >
      <span className="fc-row__body">
        <span className="fc-row__name">{set.title}</span>
        <span className="fc-row__meta">
          <span className="fc-row__terms">{plural(set.cardCount, 'term')}</span>
          {sub && (
            <span className="fc-row__desc">
              {folder && <IconFolder size={13} />}
              {sub}
            </span>
          )}
        </span>
      </span>
      <IconChevronRight />
    </Link>
  );
}
