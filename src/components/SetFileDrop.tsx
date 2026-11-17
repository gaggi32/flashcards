// A Flashcards file (a shared set or a whole export) dropped anywhere on the
// main window is added as new sets, the same as "Open shared set". Tauri's own
// drag-drop handler is off for this window (lib.rs), so the webview gets the
// file as an ordinary HTML5 drop and reads it itself: no path ever goes to Rust.

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ask } from '@/components/Dialogs';
import { IconImport } from '@/components/flashcards/FlashcardIcons';
import { announceDataChange } from '@/lib/app/events';
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

export function SetFileDrop() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where a drop lands: the folder the sets page has open, if any.
  const where = useRef<string | null>(null);
  where.current = pathname === '/flashcards' ? new URLSearchParams(search).get('folder') || null : null;

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    };
    // Leaving the window (not just moving between elements inside it).
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) void take(file);
    };
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
        if (ids.length === 1) navigate(`/flashcards/${ids[0]}`);
        else navigate(folder ? `/flashcards?folder=${encodeURIComponent(folder)}` : '/flashcards');
      } catch (err) {
        setError(errorMessage(err, 'Could not open that file.'));
      }
    }
    window.addEventListener('dragenter', onOver);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onOver);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
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
      {error && (
        <div className="rt-note rt-note--err fc-filedrop__err" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </>
  );
}
