// Data read just before a move to another screen, so that screen's first
// render already has it. The move between screens is a view transition: it
// pictures the new screen as it first renders, so a screen that first shows
// a loading skeleton would slide in as a skeleton and then jump to its
// content, and a set's title would have nothing to travel to.
//
// Link starts the read and waits for it briefly (local data takes a few
// milliseconds); the screen takes what is there on its first render
// instead of reading it again, and reads it itself when nothing is there.

import { fetchFolders, fetchSet, fetchSets, loadDeck } from '@/lib/flashcards/client';
import type { Deck } from '@/lib/flashcards/deck';
import type { SetDTO, SetSummaryDTO } from '@/lib/flashcards/types';

type Primed = { sets: { sets: SetSummaryDTO[]; folders: string[] } } & Record<`set:${number}`, SetDTO> &
  Record<`deck:${number}`, { deck: Deck | null }>;

/** An entry is only for the move that read it: older than this, it is not used. */
const FRESH_MS = 2000;
const store = new Map<string, { at: number; value: unknown }>();

export function primed<K extends keyof Primed>(key: K): Primed[K] | null {
  const hit = store.get(key);
  if (!hit || performance.now() - hit.at > FRESH_MS) return null;
  return hit.value as Primed[K];
}

function put(key: keyof Primed, value: unknown): void {
  store.set(key, { at: performance.now(), value });
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
      put('sets', { sets: s.sets, folders: f.folders });
    });
  } else {
    const m = /^\/flashcards\/(\d{1,15})(\/(cards|write|learn|test))?$/.exec(route);
    if (m) {
      const id = Number(m[1]);
      read = fetchSet(id).then(async (res) => {
        put(`set:${id}`, res.set);
        // Flashcards also picks up its saved round before it shows.
        if (m[3] === 'cards') {
          const deck = await loadDeck(id, res.set.cards.map((card) => card.id));
          put(`deck:${id}`, { deck });
        }
      });
    }
  }
  if (!read) return;
  await Promise.race([read.catch(() => {}), new Promise((r) => setTimeout(r, waitMs))]);
}
