
import { ask } from '@/components/Dialogs';
import { useEffect, useId, useRef, useState } from 'react';

import {
  deleteAiKey,
  errorMessage,
  fetchAiKeyStatus,
  saveAiKey,
} from '@/lib/flashcards/client';
import { formatUsd } from '@/lib/openrouter/format';
import type { AiKeyStatus } from '@/lib/openrouter/types';

/** The spend limit that binds first: a per-key cap, or the account balance. */
export function effectiveBalance(status: AiKeyStatus | null): number | null {
  const account = status?.account;
  if (!account) return null;
  if (account.limitRemaining !== null && account.remaining !== null) {
    return Math.min(account.limitRemaining, account.remaining);
  }
  return account.limitRemaining ?? account.remaining;
}

/**
 * Bring-your-own OpenRouter key, plus what is left on it.
 *
 * The same key the food log's photo estimates use — there is one per user, so
 * adding it here turns both on. No <form> element on purpose: this panel also
 * renders inside the set editor, which is a form already, and a form nested in
 * a form submits the outer one.
 */
export function AiKeyPanel({
  model,
  onStatus,
  intro = true,
}: {
  model: string;
  /** Called whenever the status is read or changes. */
  onStatus?: (status: AiKeyStatus) => void;
  /** The explanatory paragraph; the generate panel has its own. */
  intro?: boolean;
}) {
  const uid = useId();
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so a parent passing an inline callback does not re-read the
  // status (a live call to OpenRouter) on every render.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  function apply(next: AiKeyStatus) {
    setStatus(next);
    onStatusRef.current?.(next);
  }

  useEffect(() => {
    fetchAiKeyStatus()
      .then((next) => {
        setStatus(next);
        onStatusRef.current?.(next);
      })
      .catch((err: unknown) => setError(errorMessage(err, 'Could not read the key status.')));
  }, []);

  async function save() {
    if (busy || apiKey.trim().length < 20) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      apply(await saveAiKey(apiKey.trim()));
      // Out of React state the moment it is stored.
      setApiKey('');
      setNote('Key saved. Generating cards now bills your OpenRouter account.');
    } catch (err) {
      setError(errorMessage(err, 'Could not save that key.'));
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    if (!(await ask.confirm('Forget your OpenRouter key? It is removed from this computer’s credential store.', { danger: true, ok: 'forget' }))) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      apply(await deleteAiKey());
      setNote('Key removed.');
    } catch (err) {
      setError(errorMessage(err, 'Could not remove that key.'));
    } finally {
      setBusy(false);
    }
  }

  const account = status?.account ?? null;
  const left = effectiveBalance(status);
  const low = left !== null && left < 0.5;

  return (
    <div className="fc-keypanel">
      <div className="fc-keypanel__head">
        <span className="fc-keypanel__title">openrouter key</span>
        <span className="rt-chip">
          {status === null
            ? '…'
            : status.source === 'user'
              ? `your key ····${status.hint}`
              : status.source === 'server'
                ? 'site key'
                : 'none'}
        </span>
      </div>

      {intro && (
        <p className="rt-small fc-keypanel__intro">
          Screenshots and notes go to <code className="rt-mono">{model}</code> through
          OpenRouter and come back as cards you check before saving. Every generation shows
          what it cost. The food log&apos;s photo estimates use this same key.
        </p>
      )}

      {error && <div className="rt-note rt-note--err">{error}</div>}

      {status !== null && status.source !== 'none' && (
        <dl className={`rt-spec fc-keypanel__balance${low ? ' is-low' : ''}`}>
          {left !== null && (
            <div>
              <dt>left</dt>
              <dd>{formatUsd(left)}</dd>
            </div>
          )}
          {account?.totalUsage !== null && account?.totalUsage !== undefined && (
            <div>
              <dt>spent</dt>
              <dd>{formatUsd(account.totalUsage)}</dd>
            </div>
          )}
          {account?.limit !== null && account?.limit !== undefined && (
            <div>
              <dt>key cap</dt>
              <dd>{formatUsd(account.limit)}</dd>
            </div>
          )}
          {account === null && (
            <div>
              <dt>balance</dt>
              <dd className="rt-quiet">unavailable right now</dd>
            </div>
          )}
        </dl>
      )}
      {low && (
        <div className="rt-note rt-note--warn">Running low — top up at openrouter.ai/credits.</div>
      )}

      <label className="rt-field" htmlFor={`${uid}-key`}>
        <span className="rt-field__label">
          {status?.source === 'user' ? 'replace your key' : 'your OpenRouter key'}
        </span>
      </label>
      <div className="fc-keypanel__row">
        <input
          id={`${uid}-key`}
          className="rt-input"
          type="password"
          // Browsers ignore "off" on a password field and fill in the saved
          // *login* password — one Enter away from being sent as an API key.
          // "new-password" is never offered a saved one; the data-* attributes
          // opt out of 1Password, LastPass and Bitwarden.
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          spellCheck={false}
          placeholder="sk-or-v1-…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Never the surrounding form's submit — see the note above.
              e.preventDefault();
              void save();
            }
          }}
        />
        <button
          type="button"
          className="rt-btn rt-btn--primary"
          onClick={() => void save()}
          disabled={busy || apiKey.trim().length < 20}
        >
          {busy ? 'checking…' : 'save key'}
        </button>
      </div>
      <div className="rt-small">
        Stored encrypted and never sent back to the browser. Create one at openrouter.ai/keys —
        a key with a spend cap is the safe way to do this.
      </div>

      {note && <div className="rt-small fc-keypanel__note">{note}</div>}

      {status?.source === 'user' && (
        <div>
          <button type="button" className="rt-linkbtn" onClick={() => void forget()} disabled={busy}>
            forget this key
          </button>
        </div>
      )}
    </div>
  );
}
