import { describe, expect, it } from 'vitest';

import { eventToChord, formatHotkey } from './hotkey';

const key = (code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  code,
  ...mods,
});

describe('hotkeys', () => {
  it('records the physical key with its modifiers', () => {
    expect(eventToChord(key('KeyF', { ctrlKey: true, altKey: true }), false)).toEqual({
      accelerator: 'CommandOrControl+Alt+F',
      complete: true,
      hasModifier: true,
    });
    expect(eventToChord(key('KeyF', { metaKey: true, altKey: true }), true).accelerator).toBe(
      'CommandOrControl+Alt+F',
    );
  });

  it('is incomplete while only modifiers are held', () => {
    expect(eventToChord(key('ControlLeft', { ctrlKey: true }), false).complete).toBe(false);
  });

  it('reads back per platform', () => {
    expect(formatHotkey('CommandOrControl+Alt+F', false)).toBe('Ctrl + Alt + F');
    expect(formatHotkey('CommandOrControl+Alt+F', true)).toBe('⌘ ⌥ F');
  });
});
