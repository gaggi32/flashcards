// A Flashcards file (a shared set or a whole export) dropped anywhere on the
// main window is added as new sets, the same as "Open shared set". Tauri's own
// drag-drop handler is off for this window (lib.rs), so the webview gets the
// file as an ordinary HTML5 drop and reads it itself: no path ever goes to Rust.

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ask } from '@/components/Dialogs';
import { IconImport } from '@/components/flashcards/FlashcardIcons';
import { announceDataChange } from '@/lib/app/events';
import { ownDraggedSet } from '@/lib/app/setDrag';
import { ApiError, errorMessage } from '@/lib/store/errors';
import { importAll, parseExport } from '@/lib/store/transfer';

/** The same cap as the file picker's import (MAX_IMPORT_BYTES in lib.rs). */
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Add the sets in an export file's text, into `folder`. More than one set is
 * asked about first. Resolves with the new sets' ids, or null when declined.
 */
export async function addSetsFromText(text: string, folder: string | null): Promise<number[] | null> {
  const file = parseExport(text);
  if (file.sets.length === 0) throw new ApiError('That file has no sets in it.', 400);
  if (file.sets.length > 1) {
    const cards = file.sets.reduce((n, x) => n + x.cards.length, 0);
    const yes = await ask.confirm(
      `That file holds ${file.sets.length} sets with ${cards} cards. Add them all? Your sets stay as they are.`,
      { ok: 'add them' },
    );
    if (!yes) return null;
  }
  const res = await importAll(file, { folder });
  announceDataChange();
  return res.setIds;
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/**
 * A file drag this component should answer: not one of this window's own set
 * rows (setDrag.ts), and not only pictures (the generator's drop zone takes
 * those, and nothing else here would).
 */
function isForUs(e: DragEvent): boolean {
  if (!hasFiles(e) || ownDraggedSet() !== null) return false;
  const types = Array.from(e.dataTransfer?.items ?? [], (i) => i.type);
  return !(types.length > 0 && types.every((t) => t.startsWith('image/')));
}

/** No dragover for this long means the drag left or ended somewhere unseen. */
const OVER_TIMEOUT_MS = 400;

export function SetFileDrop() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const setError = (text: string | null) => setNote(text === null ? null : { ok: false, text });
  // Where a drop lands: the folder the sets page has open, if any.
  const where = useRef<string | null>(null);
  where.current = pathname === '/flashcards' ? new URLSearchParams(search).get('folder') || null : null;
  // An editor with unsaved work is never navigated away from: the set is
  // added and a note says so.
  const editing = useRef(false);
  editing.current = /^\/flashcards\/(new|\d+\/edit)$/.test(pathname);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  useEffect(() => {
    // The prompt goes as soon as dragover stops coming: a drop handled (and
    // stopped) by something else, or a drag that ended outside, can never
    // leave it covering the page.
    let overTimer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(overTimer);
      setOver(false);
    };
    // On the document, after React's handlers: a drop zone that took the
    // event (preventDefault) keeps it. The link guard's window listener
    // comes later still.
    const onOver = (e: DragEvent) => {
      if (e.defaultPrevented || !isForUs(e)) {
        if (!e.defaultPrevented && hasFiles(e)) e.preventDefault();
        hide();
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setOver(true);
      clearTimeout(overTimer);
      overTimer = setTimeout(() => setOver(false), OVER_TIMEOUT_MS);
    };
    // Leaving the window (not just moving between elements inside it).
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) hide();
    };
    const onDrop = (e: DragEvent) => {
      hide();
      if (e.defaultPrevented || !isForUs(e)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) void take(file);
    };
    // Captured first, so the prompt goes even when a drop zone stops the event.
    const onAnyDrop = () => hide();
    async function take(file: File) {
      setError(null);
      if (!/\.json$/i.test(file.name)) {
        setError('Drop a Flashcards file (.json): a shared set or an export.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError('That file is too big to import (over 50 MB).');
        return;
      }
      try {
        const folder = where.current;
        const ids = await addSetsFromText(await file.text(), folder);
        if (ids === null) return;
        if (editing.current) {
          setNote({ ok: true, text: `Added ${ids.length === 1 ? 'the set' : `${ids.length} sets`} to your sets.` });
        } else if (ids.length === 1) navigate(`/flashcards/${ids[0]}`);
        else navigate(folder ? `/flashcards?folder=${encodeURIComponent(folder)}` : '/flashcards');
      } catch (err) {
        setError(errorMessage(err, 'Could not open that file.'));
      }
    }
    document.addEventListener('dragenter', onOver);
    document.addEventListener('dragover', onOver);
    document.addEventListener('dragleave', onLeave);
    document.addEventListener('drop', onDrop);
    window.addEventListener('drop', onAnyDrop, true);
    return () => {
      clearTimeout(overTimer);
      document.removeEventListener('dragenter', onOver);
      document.removeEventListener('dragover', onOver);
      document.removeEventListener('dragleave', onLeave);
      document.removeEventListener('drop', onDrop);
      window.removeEventListener('drop', onAnyDrop, true);
    };
  }, [navigate]);

  return (
    <>
      {over && (
        <div className="fc-filedrop" aria-hidden="true">
          <div className="fc-filedrop__box">
            <IconImport size={22} />
            <span>Drop to add the set{where.current ? ` to “${where.current}”` : ''}</span>
          </div>
        </div>
      )}
      {note && (
        <div
          className={`rt-note rt-note--${note.ok ? 'ok' : 'err'} fc-filedrop__err`}
          role={note.ok ? 'status' : 'alert'}
          onClick={() => setNote(null)}
        >
          {note.text}
        </div>
      )}
    </>
  );
}
