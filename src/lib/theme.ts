/* ---------------------------------------------------------------------------
   Theme: light (paper) / dark (night) / system, plus an independent
   "eye comfort" switch that warms whichever of light or dark is active.

   The palettes live in CSS — `:root` holds the light tokens,
   `:root[data-theme='dark']` overrides them, and `[data-eye='on']` on top of
   either selects its warm, low-blue variant. All this module does is decide
   what is active and stamp `data-theme` / `data-eye` on <html>.
   --------------------------------------------------------------------------- */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = '404canvas:theme';
export const EYE_STORAGE_KEY = '404canvas:eye';

/** Address-bar tint, kept in step with --rt-paper of each palette. */
export const THEME_COLORS = {
  light: '#e9dfc9',
  dark: '#16130f',
  lightEye: '#ece1c6',
  darkEye: '#1a1612',
} as const;

export function themeColor(theme: ResolvedTheme, eye: boolean): string {
  return THEME_COLORS[eye ? (theme === 'dark' ? 'darkEye' : 'lightEye') : theme];
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Runs in <head> before first paint, so the page never flashes the wrong
 * palette. Inlined as a string because it has to be synchronous and cannot
 * wait for React to hydrate.
 *
 * Also carries over the short-lived 'eye' theme value (eye comfort was a
 * fourth theme for a day) as light + eye comfort on.
 *
 * Kept deliberately small and wrapped in try/catch: localStorage throws in
 * Safari's private mode, and a theme is not worth a blank page.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var K=${JSON.stringify(THEME_STORAGE_KEY)},E=${JSON.stringify(EYE_STORAGE_KEY)},c=${JSON.stringify(THEME_COLORS)};
var s=localStorage.getItem(K),e=localStorage.getItem(E)==='1';
if(s==='eye'){s='light';e=true;localStorage.setItem(K,s);localStorage.setItem(E,'1');}
var t=s==='light'||s==='dark'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
var h=document.documentElement;
h.setAttribute('data-theme',t);
if(e)h.setAttribute('data-eye','on');else h.removeAttribute('data-eye');
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute('content',c[e?t+'Eye':t]);
}catch(x){}})()`;
