
import { useState } from 'react';

import { showOverlay } from '@/lib/app/native';
import { usePref } from '@/lib/app/prefs';
import { errorMessage, fetchFolders, updateSet } from '@/lib/flashcards/client';
import { LIMITS, type SetDTO } from '@/lib/flashcards/types';
import { IconCards, IconFolder } from './FlashcardIcons';

/**
 * A set's two filing controls: which folder it sits in, and the overlay —
 * study only this set there, or whether it belongs to the overlay's mix.
 */
export function OrganizeSet({ set }: { set: SetDTO }) {
  const [folder, setFolder] = useState(set.folder);
  const [inOverlay, setInOverlay] = useState(set.inOverlay !== false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [known, setKnown] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'folder' | 'share' | null>(null);
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

  async function toggleOverlay() {
    setBusy('share');
    setError(null);
    try {
      const { set: saved } = await updateSet(set.id, { inOverlay: !inOverlay });
      setInOverlay(saved.inOverlay !== false);
    } catch (err) {
      setError(errorMessage(err, 'Could not change the overlay setting.'));
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
                  ? 'Only this set comes up when you press the overlay hotkey.'
                  : inOverlay
                    ? 'Part of the overlay’s mix of sets. Study only this one there, or leave it out of the mix.'
                    : 'Left out of the overlay’s mix. You can still study only this set there.'}
              </div>
            </div>
          </div>
          <div className="rt-btnrow">
            {studyingThis ? (
              <button type="button" className="rt-btn rt-btn--sm" onClick={() => setOverlaySet('all')}>
                back to the mix
              </button>
            ) : (
              <button
                type="button"
                className="rt-btn rt-btn--sm rt-btn--primary"
                onClick={() => {
                  setOverlaySet(set.id);
                  void showOverlay();
                }}
              >
                study only this set
              </button>
            )}
            <button type="button" className="rt-btn rt-btn--sm" disabled={busy !== null} onClick={toggleOverlay}>
              {busy === 'share' ? 'saving…' : inOverlay ? 'leave out of the mix' : 'add to the mix'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
