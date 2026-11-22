
import { ask } from '@/components/Dialogs';
import Link from '@/components/Link';
import { importFile } from '@/lib/app/native';
import { useRouter } from '@/lib/app/router';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';

import { addSetsFromText } from '@/components/SetFileDrop';
import {
  WEB_SET_TYPE,
  clearOwnDrag,
  dragSetFile,
  endWebDrag,
  ownDraggedSet,
  prepareSetFile,
  startWebDrag,
} from '@/lib/app/setDrag';
import { IS_WEB } from '@/lib/app/platform';
import { WebNotice } from '@/web/WebNotice';
import { TodayPanel } from '@/components/TodayPanel';
import { useDataVersion } from '@/lib/app/events';
import { forget, primed } from '@/lib/app/prime';
import { createFolder, errorMessage, fetchFolders, fetchSets, renameFolder, updateSet } from '@/lib/flashcards/client';
import { plural, studiedAgo } from '@/lib/flashcards/format';
import { LIMITS, type SetSummaryDTO } from '@/lib/flashcards/types';
import {
  IconChevronLeft,
  IconFolder,
  IconFolderPlus,
  IconGenerate,
  IconImport,
  IconPlus,
  IconSearch,
} from '@/components/flashcards/FlashcardIcons';
import { SetTitle } from '@/components/motion/SetTitle';
import { useFlip } from '@/components/motion/useFlip';

type Folder = { name: string; sets: number; cards: number };

/** A set row of this window being dragged (an OS file drag, see setDrag.ts; an HTML drag on the web). */
const isSetDrag = (e: DragEvent) =>
  e.dataTransfer.types.includes(IS_WEB ? WEB_SET_TYPE : 'Files') && ownDraggedSet() !== null;

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
  const [sets, setSets] = useState<SetSummaryDTO[] | null>(() => primed('sets')?.sets ?? null);
  // Every folder by name, the empty ones too (sets only name the full ones).
  const [folderNames, setFolderNames] = useState<string[]>(() => primed('sets')?.folders ?? []);
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
  const folderList = useRef<HTMLDivElement>(null);
  const setList = useRef<HTMLDivElement>(null);
  useFlip(folderList);
  useFlip(setList);

  useEffect(() => {
    forget('sets');
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

      {IS_WEB ? <WebNotice /> : <TodayPanel version={version} />}

      <section className="rt-section">
        {error && <div className="rt-note rt-note--err">{error}</div>}

        {sets === null && !error && (
          <div className="fc-list" aria-busy="true">
            <div className="fc-skel fc-skel--tile" />
            <div className="fc-skel fc-skel--tile" />
            <div className="fc-skel fc-skel--tile" />
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
                  <div className="fc-list" ref={folderList}>
                    {folders.map((f) => (
                      <button
                        key={f.name}
                        data-flip={f.name}
                        type="button"
                        className={`fc-tile fc-tile--folder${dropOn === f.name ? ' fc-dropon' : ''}`}
                        onClick={() => setFolder(f.name)}
                        {...dropTarget(f.name, f.name)}
                      >
                        <FolderPicture sets={f.sets} />
                        <span className="fc-tile__info">
                          <span className="fc-tile__name">{f.name}</span>
                          <span className="fc-tile__facts">
                            {f.sets === 0 ? 'no sets yet' : `${plural(f.sets, 'set')} · ${plural(f.cards, 'term')}`}
                          </span>
                        </span>
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
              <div className="fc-list" ref={setList}>
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

/**
 * A set as a little deck lying on the table: its first card face up, on a
 * pile as thick as the set, with the name and a line about it underneath.
 * Hovering lifts the top card off the pile.
 */
function SetRow({
  set,
  showFolder = false,
  onDragDone,
}: {
  set: SetSummaryDTO;
  /** While searching, where each hit is filed stands in for the line about it. */
  showFolder?: boolean;
  /** The row's drag is over, wherever it ended. */
  onDragDone?: () => void;
}) {
  const folder = showFolder ? set.folder : null;
  // Pressed here and not yet dragged: where, and the set's file, read at once
  // so the OS drag can start the moment the pointer has moved far enough.
  const press = useRef<{ x: number; y: number; file: Promise<{ contents: string; name: string }> } | null>(null);
  const dragging = useRef(false);
  const first = set.glance?.peek[0] ?? null;
  const depth = pileDepth(set.cardCount);
  return (
    <Link
      href={`/flashcards/${set.id}`}
      className="fc-tile"
      draggable={IS_WEB}
      title={`${set.description ? `${set.description}

` : ''}Open the set, or drag it onto a folder${IS_WEB ? '' : ', the desktop or another app'}`}
      onDragStart={(e) => {
        if (!IS_WEB) return;
        e.dataTransfer.setData(WEB_SET_TYPE, String(set.id));
        e.dataTransfer.effectAllowed = 'copy';
        startWebDrag(set.id);
      }}
      onDragEnd={() => {
        if (!IS_WEB) return;
        endWebDrag(set.id);
        onDragDone?.();
      }}
      onPointerDown={(e) => {
        if (IS_WEB || e.button !== 0 || e.pointerType !== 'mouse') return;
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
      <span className={`fc-mini${first === null ? ' is-empty' : ''}`} aria-hidden="true">
        {Array.from({ length: depth }, (_, i) => (
          <span key={i} className="fc-mini__under" style={{ '--k': i + 1 } as CSSProperties} />
        ))}
        <span className="fc-mini__card">
          <span className="fc-mini__side">term</span>
          {first !== null && <span className={`fc-mini__text${first.length > 40 ? ' is-long' : ''}`}>{first}</span>}
        </span>
      </span>
      <span className="fc-tile__info">
        <SetTitle setId={set.id}>
          <span className="fc-tile__name">{set.title}</span>
        </SetTitle>
        <span className="fc-tile__facts">
          {folder && <IconFolder size={12} />}
          {folder ?? facts(set)}
        </span>
      </span>
    </Link>
  );
}

/** How many cards lie under the top one: more for a bigger set. */
function pileDepth(n: number): number {
  if (n <= 1) return 0;
  if (n < 8) return 1;
  if (n < 25) return 2;
  return 3;
}

/** "30 terms · 4 learned · today" */
function facts(set: SetSummaryDTO): string {
  const g = set.glance;
  if (set.cardCount === 0) return 'no cards yet';
  const parts = [plural(set.cardCount, 'term')];
  if (g?.learned) parts.push(`${g.learned} learned`);
  parts.push(g?.studiedAt ? studiedAgo(g.studiedAt) : 'not studied yet');
  return parts.join(' · ');
}

/**
 * A folder lying open: its back with the tab, a card standing in it for each
 * set (up to three) and the front pocket. An empty one holds a dashed card.
 * Drawn in a 160 × 100 box, the tile's shape.
 */
function FolderPicture({ sets }: { sets: number }) {
  const n = Math.min(3, sets);
  return (
    <span className="fc-folder" aria-hidden="true">
      <svg className="fc-folder__back" viewBox="0 0 160 100" preserveAspectRatio="none">
        <path d="M0 11 Q0 3 8 3 H45 Q50 3 53.5 6.5 L57 10 Q60 13 65 13 H152 Q160 13 160 21 V92 Q160 100 152 100 H8 Q0 100 0 92 Z" />
      </svg>
      {n === 0 ? (
        <span className="fc-folder__card is-empty" style={{ '--k': 2 } as CSSProperties} />
      ) : (
        // Back to front; the front card is always the third place.
        Array.from({ length: n }, (_, i) => (
          <span key={i} className="fc-folder__card" style={{ '--k': 3 - n + i } as CSSProperties} />
        ))
      )}
      <svg className="fc-folder__front" viewBox="0 0 160 100" preserveAspectRatio="none">
        <path d="M3 58 Q4 52 10 52 H150 Q156 52 157 58 L160 92 Q160 100 152 100 H8 Q0 100 0 92 Z" />
      </svg>
    </span>
  );
}
