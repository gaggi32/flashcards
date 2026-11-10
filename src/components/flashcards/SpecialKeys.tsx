
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';

/**
 * Put on a button that sits beside a text input. Tapping a button would blur
 * the input: the phone keyboard closes, the viewport jumps, and it has to be
 * reopened. Cancelling the mousedown keeps the focus where it is; the click
 * still fires.
 */
export function keepFocus(e: MouseEvent) {
  e.preventDefault();
}

const SHORTCUTS_STORAGE_KEY = '404canvas:flashcards:special-key-shortcuts';

/** The digit that types the button at each position: 1–9, then 0 for the tenth. */
const SHORTCUT_DIGITS = '1234567890';

/**
 * Buttons that type characters the keyboard may not have into a controlled
 * text input, at the caret or over the selection.
 *
 * The switch at the end of the row hands the number keys to the first ten
 * buttons. It is off until asked for, and stays a switch rather than a
 * fixture, because while it is on the input cannot take a digit of its own.
 */
export function SpecialKeys({
  chars,
  value,
  onChange,
  inputRef,
}: {
  chars: string[];
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [shortcuts, setShortcuts] = useShortcutsSetting();

  function insert(char: string) {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + char + value.slice(end));
    // The re-render moves the caret to the end; put it back after the new character.
    setTimeout(() => {
      // preventScroll: if the input wasn't focused yet, opening the keyboard
      // must not also scroll the page.
      el.focus({ preventScroll: true });
      el.setSelectionRange(start + char.length, start + char.length);
    }, 0);
  }

  // The listener outlives a render; it reaches the current text through this.
  const insertRef = useRef(insert);
  insertRef.current = insert;

  useEffect(() => {
    const el = inputRef.current;
    if (!shortcuts || !el || chars.length === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target !== el &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const char = e.key.length === 1 ? chars[SHORTCUT_DIGITS.indexOf(e.key)] : undefined;
      if (char === undefined) return;
      e.preventDefault();
      insertRef.current(char);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts, chars, inputRef]);

  if (chars.length === 0) return null;

  return (
    <div className="fc-keyboard">
      {chars.map((char, i) => (
        <button
          key={char}
          type="button"
          className="fc-key"
          onMouseDown={keepFocus}
          onClick={() => insert(char)}
        >
          {/* A lone combining mark needs something to sit on. */}
          {/^\p{M}$/u.test(char) ? `◌${char}` : char}
          {shortcuts && i < SHORTCUT_DIGITS.length && (
            <span className="fc-key__digit" aria-hidden="true">
              {SHORTCUT_DIGITS[i]}
            </span>
          )}
        </button>
      ))}
      <button
        type="button"
        className={`fc-key fc-key--setting${shortcuts ? ' is-on' : ''}`}
        aria-pressed={shortcuts}
        title={
          shortcuts
            ? 'Number keys type these characters. Turn off to type digits.'
            : 'Type these characters with the number keys.'
        }
        onMouseDown={keepFocus}
        onClick={() => setShortcuts(!shortcuts)}
      >
        <span aria-hidden="true">⌨</span> 1–9 {shortcuts ? 'on' : 'off'}
      </button>
    </div>
  );
}

/** Whether the number keys type the special characters; remembered on this device. */
function useShortcutsSetting(): [boolean, (on: boolean) => void] {
  // Default to true so 1–9 shortcuts are immediately active and visible.
  const [on, setOn] = useState(true);

  // Read after mount, so the server's markup and the first render agree.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
      setOn(stored === null ? true : stored === 'on');
    } catch {
      // localStorage throws in Safari's private mode; the setting just stays on.
    }
  }, []);

  function set(next: boolean) {
    setOn(next);
    try {
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, next ? 'on' : 'off');
    } catch {
      // Not remembered, but it still works until the page is left.
    }
  }

  return [on, set];
}
