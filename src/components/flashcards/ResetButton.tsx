import { useEffect, useState } from 'react';

import { keepFocus } from './SpecialKeys';

/**
 * A small "reset" that asks inline before it acts ("reset round? yes · no"),
 * since the overlay has no room (and no host) for a dialog. Not in the Tab
 * round and it never takes the focus, so the answer box keeps the caret.
 * The question goes away on its own after a few seconds.
 */
export function ResetButton({
  question,
  title,
  onReset,
}: {
  /** Asked before resetting, e.g. "reset round?". */
  question: string;
  /** Hover text on the plain button: what a reset throws away. */
  title: string;
  onReset: () => void | Promise<void>;
}) {
  const [state, setState] = useState<'idle' | 'asking' | 'busy' | 'failed'>('idle');

  useEffect(() => {
    if (state !== 'asking' && state !== 'failed') return;
    const t = setTimeout(() => setState('idle'), 5000);
    return () => clearTimeout(t);
  }, [state]);

  if (state === 'idle') {
    return (
      <button
        type="button"
        tabIndex={-1}
        className="rt-linkbtn fc-reset"
        title={title}
        onMouseDown={keepFocus}
        onClick={() => setState('asking')}
      >
        reset
      </button>
    );
  }
  if (state === 'failed') {
    return (
      <span className="fc-reset fc-reset--failed" role="alert">
        could not reset
      </span>
    );
  }
  return (
    <span className="fc-reset fc-reset--ask">
      <span>{question}</span>
      <button
        type="button"
        tabIndex={-1}
        className="rt-linkbtn fc-reset__yes"
        disabled={state === 'busy'}
        onMouseDown={keepFocus}
        onClick={async () => {
          setState('busy');
          try {
            await onReset();
            setState('idle');
          } catch {
            setState('failed');
          }
        }}
      >
        yes
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="rt-linkbtn"
        disabled={state === 'busy'}
        onMouseDown={keepFocus}
        onClick={() => setState('idle')}
      >
        no
      </button>
    </span>
  );
}
