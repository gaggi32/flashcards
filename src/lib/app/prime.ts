// Data read just before a move to another screen, so that screen's first
// render already has it. The move between screens is a view transition: it
// pictures the new screen as it first renders, so a screen that first shows
// a loading skeleton would slide in as a skeleton and then jump to its
// content, and a set's title would have nothing to travel to.
//
// Link starts the read and waits for it briefly (local data takes a few
// milliseconds); the screen takes what is there on its first render and
// reads afresh anyway, so a stale or missing entry costs nothing.

import { fetchFolders, fetchSet, fetchSets } from '@/lib/flashcards/client';
import type { SetDTO, SetSummaryDTO } from '@/lib/flashcards/types';

type Primed = { sets: { sets: SetSummaryDTO[]; folders: string[] } } & Record<`set:${number}`, SetDTO>;

const store = new Map<string, unknown>();

export function primed<K extends keyof Primed>(key: K): Primed[K] | null {
  return (store.get(key) as Primed[K] | undefined) ?? null;
}

export function forget(key: keyof Primed): void {
  store.delete(key);
}

/** Reads what the screen at `path` will need, at most `waitMs` long. */
export async function primeFor(path: string, waitMs = 250): Promise<void> {
  const route = path.split(/[?#]/)[0];
  let read: Promise<void> | null = null;
  if (route === '/flashcards') {
    read = Promise.all([fetchSets(), fetchFolders()]).then(([s, f]) => {
      store.set('sets', { sets: s.sets, folders: f.folders });
    });
  } else {
    const m = /^\/flashcards\/(\d{1,15})(\/(cards|write|learn|test))?$/.exec(route);
    if (m) {
      const id = Number(m[1]);
      read = fetchSet(id).then((res) => {
        store.set(`set:${id}`, res.set);
      });
    }
  }
  if (!read) return;
  await Promise.race([read.catch(() => {}), new Promise((r) => setTimeout(r, waitMs))]);
}
