// Light / dark / system, plus eye comfort and how much things move — the
// app's look, chosen in Settings and shared by both windows. The CSS keys off
// data-theme, data-eye and data-motion on <html> (styles/tokens.css,
// styles/motion.css).
//
// The CSP allows no inline script, so there is no head script: main.tsx and
// overlay.tsx call applyCachedTheme() before React renders, from a copy of the
// last choice kept in localStorage, and the real settings confirm it a moment
// later.

import type { MotionChoice, ThemeChoice } from './native';

const CACHE = 'flashcards:theme';
const DARK = '(prefers-color-scheme: dark)';

type Look = { theme: ThemeChoice; eye: boolean; motion: MotionChoice };
let current: Look = { theme: 'system', eye: false, motion: 'full' };
let watching = false;

function stamp() {
  const resolved =
    current.theme === 'system' ? (window.matchMedia(DARK).matches ? 'dark' : 'light') : current.theme;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  if (current.eye) root.setAttribute('data-eye', 'on');
  else root.removeAttribute('data-eye');
  if (current.motion === 'full') root.removeAttribute('data-motion');
  else root.setAttribute('data-motion', current.motion);
}

export function applyTheme(theme: ThemeChoice, eye: boolean, motion: MotionChoice = 'full'): void {
  current = { theme, eye, motion };
  stamp();
  try {
    localStorage.setItem(CACHE, JSON.stringify(current));
  } catch {
    /* storage unavailable: the settings call repaints anyway */
  }
  if (!watching) {
    watching = true;
    window.matchMedia(DARK).addEventListener('change', () => current.theme === 'system' && stamp());
  }
}

export function applyCachedTheme(): void {
  try {
    const raw = localStorage.getItem(CACHE);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Look>;
      applyTheme(
        v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system',
        v.eye === true,
        v.motion === 'calm' || v.motion === 'off' ? v.motion : 'full',
      );
      return;
    }
  } catch {
    /* fall through */
  }
  applyTheme('system', false);
}

/** The motion lab's preview: this window only, nothing saved or cached. */
export function previewMotion(motion: MotionChoice): void {
  current = { ...current, motion };
  stamp();
}

/** What the screens may animate right now: the setting, and the system's
 * "reduce motion" on top of it (which counts as off). */
export function motionLevel(): MotionChoice {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'off';
  return current.motion;
}
