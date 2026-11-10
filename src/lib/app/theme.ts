// Light / dark / system, plus eye comfort — the website's palettes, chosen in
// Settings and shared by both windows. The CSS keys off data-theme and
// data-eye on <html> (styles/retro.css).
//
// The CSP allows no inline script, so there is no head script: main.tsx and
// overlay.tsx call applyCachedTheme() before React renders, from a copy of the
// last choice kept in localStorage, and the real settings confirm it a moment
// later.

import type { ThemeChoice } from './native';

const CACHE = 'flashcards:theme';
const DARK = '(prefers-color-scheme: dark)';

let current: { theme: ThemeChoice; eye: boolean } = { theme: 'system', eye: false };
let watching = false;

function stamp() {
  const resolved =
    current.theme === 'system' ? (window.matchMedia(DARK).matches ? 'dark' : 'light') : current.theme;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  if (current.eye) root.setAttribute('data-eye', 'on');
  else root.removeAttribute('data-eye');
}

export function applyTheme(theme: ThemeChoice, eye: boolean): void {
  current = { theme, eye };
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
      const v = JSON.parse(raw) as { theme?: ThemeChoice; eye?: boolean };
      applyTheme(v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system', v.eye === true);
      return;
    }
  } catch {
    /* fall through */
  }
  applyTheme('system', false);
}
