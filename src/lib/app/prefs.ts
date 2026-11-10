// Study choices the overlay and the main window share: which set the overlay
// studies, which side faces up, and the overlay's mode. Both windows load
// from the same origin, so localStorage is shared and its `storage` event
// tells the other window; a custom event tells this one. These are per-device
// conveniences — losing them only resets the choice.

import { useEffect, useState } from 'react';

export type OverlaySet = 'all' | number;
export type Front = 'term' | 'definition' | 'mixed';
export type OverlayMode = 'cards' | 'write' | 'learn';

type Prefs = { overlaySet: OverlaySet; front: Front | null; overlayMode: OverlayMode };

const KEYS: Record<keyof Prefs, string> = {
  overlaySet: 'flashcards.overlay-set',
  front: 'flashcards.front',
  overlayMode: 'flashcards.overlay-mode',
};
const CHANGED = 'flashcards-prefs-changed';

function parse<K extends keyof Prefs>(key: K, raw: string | null): Prefs[K] {
  switch (key) {
    case 'overlaySet': {
      const n = Number(raw);
      return (raw && raw !== 'all' && Number.isInteger(n) && n > 0 ? n : 'all') as Prefs[K];
    }
    case 'front':
      return (raw === 'term' || raw === 'definition' || raw === 'mixed' ? raw : null) as Prefs[K];
    default:
      return (raw === 'write' || raw === 'learn' ? raw : 'cards') as Prefs[K];
  }
}

export function getPref<K extends keyof Prefs>(key: K): Prefs[K] {
  try {
    return parse(key, localStorage.getItem(KEYS[key]));
  } catch {
    return parse(key, null);
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  try {
    if (value === null) localStorage.removeItem(KEYS[key]);
    else localStorage.setItem(KEYS[key], String(value));
  } catch {
    /* not remembered, still applied below */
  }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: key }));
}

/** A shared preference, kept in step across both windows. */
export function usePref<K extends keyof Prefs>(key: K): [Prefs[K], (v: Prefs[K]) => void] {
  const [value, setValue] = useState<Prefs[K]>(() => getPref(key));
  useEffect(() => {
    const reread = () => setValue(getPref(key));
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEYS[key]) reread();
    };
    const onLocal = (e: Event) => {
      if ((e as CustomEvent).detail === key) reread();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGED, onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGED, onLocal);
    };
  }, [key]);
  return [value, (v) => setPref(key, v)];
}
