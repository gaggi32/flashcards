// Keeps each window on the app's own pages. Rust already refuses navigation to
// anything else (on_navigation in lib.rs); this catches links first, so an
// "openrouter.ai/keys" link opens in the default browser instead of silently
// doing nothing, and only for hosts the Rust side allows.

import { openLink } from './native';

export function installLinkGuard(): void {
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        void openLink(href).catch(() => {});
      } else if (a.target === '_blank') {
        e.preventDefault();
      }
    },
    true,
  );
  // A file dropped outside a drop zone would otherwise be opened by the
  // webview as a page. Drop zones have already handled the event by the time
  // it bubbles up here.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}
