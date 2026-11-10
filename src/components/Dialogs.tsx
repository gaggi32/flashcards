// In-app stand-ins for window.confirm and window.prompt, which WKWebView on
// macOS does not reliably show. `ask.confirm()` / `ask.prompt()` return
// promises; <DialogHost/> (mounted once per window) draws them.

import { useEffect, useRef, useState } from 'react';

type Request =
  | { kind: 'confirm'; message: string; danger?: boolean; ok?: string; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; initial: string; resolve: (v: string | null) => void };

let show: ((r: Request) => void) | null = null;

export const ask = {
  confirm(message: string, opts: { danger?: boolean; ok?: string } = {}): Promise<boolean> {
    return new Promise((resolve) =>
      show ? show({ kind: 'confirm', message, ...opts, resolve }) : resolve(false),
    );
  },
  prompt(message: string, initial = ''): Promise<string | null> {
    return new Promise((resolve) =>
      show ? show({ kind: 'prompt', message, initial, resolve }) : resolve(null),
    );
  },
};

export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [text, setText] = useState('');
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    show = (r) => {
      setReq(r);
      setText(r.kind === 'prompt' ? r.initial : '');
    };
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (!req) return;
    if (req.kind === 'prompt') inputRef.current?.select();
    else okRef.current?.focus();
  }, [req]);

  if (!req) return null;

  const close = (ok: boolean) => {
    if (req.kind === 'confirm') req.resolve(ok);
    else req.resolve(ok ? text : null);
    setReq(null);
  };

  return (
    <div
      className="dlg-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && close(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(false);
        }
      }}
    >
      <div className="dlg rt-panel" role="alertdialog" aria-modal="true" aria-label={req.message}>
        <p className="dlg__msg">{req.message}</p>
        {req.kind === 'prompt' && (
          <input
            ref={inputRef}
            className="rt-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && close(true)}
          />
        )}
        <div className="rt-btnrow dlg__actions">
          <button type="button" className="rt-btn rt-btn--sm" onClick={() => close(false)}>
            cancel
          </button>
          <button
            ref={okRef}
            type="button"
            className={`rt-btn rt-btn--sm ${req.kind === 'confirm' && req.danger ? 'rt-btn--danger' : 'rt-btn--primary'}`}
            onClick={() => close(true)}
          >
            {req.kind === 'confirm' ? (req.ok ?? 'ok') : 'save'}
          </button>
        </div>
      </div>
    </div>
  );
}
