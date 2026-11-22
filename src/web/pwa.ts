// The web version as an installable app: the service worker (written by the
// build, see vite.config.ts) keeps it working offline, and persistent storage
// keeps the browser from clearing the sets when space runs low.

export function startWebApp(): void {
  document.documentElement.setAttribute('data-web', '');
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL; // "/flashcards/"
  const url = `${base}sw.js`;
  window.addEventListener('load', () => {
    // The page is /flashcards, outside /flashcards/: the site allows that
    // scope with a Service-Worker-Allowed header. Without it, the default scope.
    navigator.serviceWorker
      .register(url, { scope: base.replace(/\/$/, '') })
      .catch(() => navigator.serviceWorker.register(url))
      .catch(() => {});
  });
}

/** Whether the browser promised to keep this site's storage: null when it cannot say. */
export async function storageKept(): Promise<boolean | null> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

/** Asks for persistent storage (some browsers ask the user); resolves to the answer. */
export async function askToKeep(): Promise<boolean | null> {
  try {
    return navigator.storage?.persist ? await navigator.storage.persist() : null;
  } catch {
    return null;
  }
}
