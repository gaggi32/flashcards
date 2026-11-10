// Turning key presses into Tauri accelerators ("CommandOrControl+Alt+F") for
// the Settings recorder, and accelerators back into something readable.

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

function keyOf(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] ?? null;
}

export type Chord = { accelerator: string; complete: boolean; hasModifier: boolean };

/**
 * A keydown → accelerator. Uses `code`, not `key`, so a Swiss or German
 * layout records the physical key Tauri will listen for.
 */
export function eventToChord(
  e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code'>,
  isMac: boolean,
): Chord {
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (isMac && e.ctrlKey) mods.push('Control');
  if (!isMac && e.metaKey) mods.push('Super');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const key = keyOf(e.code);
  return {
    accelerator: [...mods, ...(key ? [key] : [])].join('+'),
    complete: key !== null,
    hasModifier: mods.length > 0,
  };
}

/** "CommandOrControl+Alt+F" → "Ctrl + Alt + F", or "⌘ ⌥ F" on macOS. */
export function formatHotkey(accelerator: string, isMac: boolean): string {
  const names: Record<string, string> = isMac
    ? { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘' }
    : { CommandOrControl: 'Ctrl', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win' };
  return accelerator
    .split('+')
    .map((p) => names[p] ?? p)
    .join(isMac ? ' ' : ' + ');
}

export const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);
