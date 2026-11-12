
import { ask } from '@/components/Dialogs';
import Link from '@/components/Link';
import { useRouter } from '@/lib/app/router';
import { useState } from 'react';

import { deleteSet, errorMessage, resetSet } from '@/lib/flashcards/client';
import {
  IconCards,
  IconChevronLeft,
  IconGlobe,
  IconLearn,
  IconWrite,
} from '@/components/flashcards/FlashcardIcons';
import { OrganizeSet } from '@/components/flashcards/OrganizeSet';
import { SetLoadState, useSet } from '@/components/flashcards/useSet';
import { formatCreated, plural } from '@/lib/flashcards/format';

export function SetClient({ setId }: { setId: number }) {
  const router = useRouter();
  const { set, error } = useSet(setId);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetNote, setResetNote] = useState<string | null>(null);

  if (!set) {
    return (
      <main>
        <Link href="/flashcards" className="rt-backlink">
          <IconChevronLeft />
          All sets
        </Link>
        <SetLoadState error={error} />
      </main>
    );
  }

  const count = set.cards.length;

  async function remove() {
    if (!set) return;
    if (!(await ask.confirm(`Delete "${set.title}" and its ${plural(count, 'card')}? This cannot be undone.`, { danger: true, ok: 'delete' }))) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSet(set.id);
      router.push('/flashcards');
    } catch (err) {
      setDeleteError(errorMessage(err, 'Could not delete this set.'));
      setDeleting(false);
    }
  }

  async function reset() {
    if (!set) return;
    const ok = await ask.confirm(
      `Start "${set.title}" over? All ${plural(count, 'card')} become new again and any round in progress is dropped. The cards themselves stay.`,
      { danger: true, ok: 'reset' },
    );
    if (!ok) return;
    setResetting(true);
    setDeleteError(null);
    setResetNote(null);
    try {
      await resetSet(set.id);
      setResetNote('Progress reset: every card is new again.');
    } catch (err) {
      setDeleteError(errorMessage(err, 'Could not reset this set.'));
    } finally {
      setResetting(false);
    }
  }

  return (
    <main className="rt-boot">
      <Link href="/flashcards" className="rt-backlink">
        <IconChevronLeft />
        All sets
      </Link>

      <div className="rt-pagehead">
        <h1>{set.title}</h1>
      </div>

      <div className="rt-metarow">
        <span>{plural(count, 'term')}</span>
        <span>created {formatCreated(set.createdAt)}</span>
        {set.isPublic && (
          <span className="fc-badge">
            <IconGlobe size={13} />
            {set.isOwner ? 'shared' : `public · by ${set.authorName ?? 'someone'}`}
          </span>
        )}
        <span className="rt-metarow__status rt-btnrow fc-gap-sm">
          {set.isOwner && (
            <>
              <Link href={`/flashcards/${set.id}/edit`} className="rt-btn rt-btn--sm">
                edit
              </Link>
              <button type="button" className="rt-btn rt-btn--sm" onClick={reset} disabled={resetting || count === 0}>
                {resetting ? 'resetting…' : 'reset progress'}
              </button>
              <button
                type="button"
                className="rt-btn rt-btn--sm rt-btn--danger"
                onClick={remove}
                disabled={deleting}
              >
                {deleting ? 'deleting…' : 'delete'}
              </button>
            </>
          )}
        </span>
      </div>

      {set.description && <p className="fc-desc">{set.description}</p>}
      {resetNote && (
        <div className="rt-note rt-note--ok" style={{ marginTop: 14 }}>
          {resetNote}
        </div>
      )}
      {deleteError && (
        <div className="rt-note rt-note--err" style={{ marginTop: 14 }}>
          {deleteError}
        </div>
      )}

      <section className="rt-section">
        <div className="rt-label">study</div>
        {count === 0 ? (
          <div className="rt-empty">
            This set has no cards yet. <Link href={`/flashcards/${set.id}/edit`}>Add some</Link>{' '}
            to start studying.
          </div>
        ) : (
          <div className="fc-modes">
            <Link href={`/flashcards/${set.id}/cards`} className="fc-mode">
              <span className="fc-mode__icon">
                <IconCards />
              </span>
              <span className="fc-mode__name">flashcards</span>
              <span className="fc-mode__sub">
                One card at a time. Flip it to check yourself, then move on.
              </span>
            </Link>
            <Link href={`/flashcards/${set.id}/write`} className="fc-mode">
              <span className="fc-mode__icon">
                <IconWrite />
              </span>
              <span className="fc-mode__name">write</span>
              <span className="fc-mode__sub">
                Type the answers. Anything you miss comes back until you get it right.
              </span>
            </Link>
            <Link href={`/flashcards/${set.id}/learn`} className="fc-mode">
              <span className="fc-mode__icon">
                <IconLearn />
              </span>
              <span className="fc-mode__name">learn</span>
              <span className="fc-mode__sub">
                Multiple choice, then typed. Cards you don&apos;t know yet first; misses come back until you get them.
              </span>
            </Link>
          </div>
        )}
      </section>

      {set.isOwner && <OrganizeSet set={set} />}

      {count > 0 && (
        <section className="rt-section">
          <div className="rt-label">terms in this set</div>
          <ol className="fc-terms">
            {set.cards.map((card) => (
              <li key={card.id} className="fc-term">
                <div className="fc-term__term">{card.term}</div>
                <div className="fc-term__def">{card.definition}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
