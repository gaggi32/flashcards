
import { ask } from '@/components/Dialogs';
import Link from '@/components/Link';
import { useRouter } from '@/lib/app/router';
import { backFromSet } from '@/lib/app/setOrigin';
import { exportFile } from '@/lib/app/native';
import { exportSet, setFileName } from '@/lib/store/transfer';
import { useState } from 'react';

import { deleteSet, errorMessage } from '@/lib/flashcards/client';
import {
  IconCards,
  IconChevronLeft,
  IconGlobe,
  IconLearn,
  IconTest,
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
  const [shareNote, setShareNote] = useState<{ ok: boolean; text: string } | null>(null);
  // The page before the set, not always the sets list (see setOrigin.ts).
  const back = backFromSet(setId);

  if (!set) {
    return (
      <main>
        <Link href={back.href} className="rt-backlink">
          <IconChevronLeft />
          {back.label}
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
      router.push(back.href);
    } catch (err) {
      setDeleteError(errorMessage(err, 'Could not delete this set.'));
      setDeleting(false);
    }
  }

  /** Save this one set to a file to send: the cards, not your progress on them. */
  async function share() {
    if (!set) return;
    setShareNote(null);
    try {
      const file = await exportSet(set.id);
      const where = await exportFile(JSON.stringify(file, null, 1), setFileName(set.title));
      if (where) {
        setShareNote({
          ok: true,
          text: `Saved to ${where}. Send that file; in Flashcards it opens with "open shared set" on the sets page. Your study progress is not in it.`,
        });
      }
    } catch (err) {
      setShareNote({ ok: false, text: errorMessage(err, 'Could not save the set.') });
    }
  }

  return (
    <main className="rt-boot">
      <Link href={back.href} className="rt-backlink">
        <IconChevronLeft />
        {back.label}
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
              <button
                type="button"
                className="rt-btn rt-btn--sm"
                onClick={() => void share()}
                disabled={count === 0}
                title={count === 0 ? 'Add cards before sharing the set' : 'Save this set to a file you can send'}
              >
                share…
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
      {shareNote && (
        <div className={`rt-note rt-note--${shareNote.ok ? 'ok' : 'err'}`} style={{ marginTop: 14 }}>
          {shareNote.text}
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
            <Link href={`/flashcards/${set.id}/test`} className="fc-mode">
              <span className="fc-mode__icon">
                <IconTest />
              </span>
              <span className="fc-mode__name">test</span>
              <span className="fc-mode__sub">
                One paper of true or false, multiple choice, matching and written questions, marked when you hand it in.
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
