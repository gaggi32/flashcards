
import { useState } from 'react';

import { showOverlay } from '@/lib/app/native';
import { usePref } from '@/lib/app/prefs';
import { errorMessage, fetchFolders, updateSet } from '@/lib/flashcards/client';
import { LIMITS, type SetDTO } from '@/lib/flashcards/types';
import { IconCards, IconFolder } from './FlashcardIcons';

/**
 * A set's two controls here: which folder it sits in, and whether the hotkey
 * overlay studies it (it studies one set at a time).
 */
export function OrganizeSet({ set }: { set: SetDTO }) {
  const [folder, setFolder] = useState(set.folder);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [known, setKnown] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'folder' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlaySet, setOverlaySet] = usePref('overlaySet');
  const studyingThis = overlaySet === set.id;

  function startMove() {
    setDraft(folder ?? '');
    setEditing(true);
    setError(null);
    // Existing names only matter once someone is choosing one, so they are
    // fetched here rather than with the set.
    if (known === null) {
      fetchFolders()
        .then((res) => setKnown(res.folders))
        .catch(() => setKnown([]));
    }
  }

  async function saveFolder(next: string | null) {
    setBusy('folder');
    setError(null);
    try {
      const { set: saved } = await updateSet(set.id, { folder: next });
      setFolder(saved.folder);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not move the set.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rt-section">
      <div className="rt-label">organize</div>
      {error && <div className="rt-note rt-note--err">{error}</div>}
      <div className="fc-organize">
        <div className="fc-organize__card">
          <div className="fc-organize__head">
            <span className="fc-organize__icon">
              <IconFolder size={18} />
            </span>
            <div>
              <div className="fc-organize__title">{folder ?? 'Not in a folder'}</div>
              <div className="fc-organize__sub">{folder ? 'Folder' : 'Shown on the main sets list.'}</div>
            </div>
          </div>
          {editing ? (
            <form
              className="fc-organize__form"
              onSubmit={(e) => {
                e.preventDefault();
                saveFolder(draft.trim() || null);
              }}
            >
              <input
                className="rt-input"
                list={`folders-${set.id}`}
                value={draft}
                maxLength={LIMITS.folderNameLength}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Folder name, new or existing"
                aria-label="Folder name"
                autoFocus
              />
              <datalist id={`folders-${set.id}`}>
                {known?.map((name) => <option key={name} value={name} />)}
              </datalist>
              <button type="submit" className="rt-btn rt-btn--sm rt-btn--primary" disabled={busy !== null}>
                {busy === 'folder' ? 'saving…' : 'save'}
              </button>
              <button type="button" className="rt-btn rt-btn--sm" onClick={() => setEditing(false)}>
                cancel
              </button>
            </form>
          ) : (
            <div className="rt-btnrow fc-gap-sm">
              <button type="button" className="rt-btn rt-btn--sm" onClick={startMove}>
                {folder ? 'move' : 'put in a folder'}
              </button>
              {folder && (
                <button
                  type="button"
                  className="rt-btn rt-btn--sm"
                  disabled={busy !== null}
                  onClick={() => saveFolder(null)}
                >
                  take out
                </button>
              )}
            </div>
          )}
        </div>

        <div className={`fc-organize__card${studyingThis ? ' is-public' : ''}`}>
          <div className="fc-organize__head">
            <span className="fc-organize__icon">
              <IconCards size={18} />
            </span>
            <div>
              <div className="fc-organize__title">
                {studyingThis ? 'The overlay studies this set' : 'Hotkey overlay'}
              </div>
              <div className="fc-organize__sub">
                {studyingThis
                  ? 'Its cards come up when you press the overlay hotkey.'
                  : 'The overlay studies one set at a time. Switch it to this one?'}
              </div>
            </div>
          </div>
          {!studyingThis && (
            <div className="rt-btnrow">
              <button
                type="button"
                className="rt-btn rt-btn--sm rt-btn--primary"
                onClick={() => {
                  setOverlaySet(set.id);
                  void showOverlay();
                }}
              >
                study in the overlay
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
