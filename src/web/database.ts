// The browser's database: the engine (engine.ts) on IndexedDB, under a Web
// Lock shared by every tab, loaded on first use.

import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

import { TAB, emitLocal, onOtherTab, tellOtherTabs } from './bus';
import { createEngine, type Engine, type Persist } from './engine';
import { idbGet, idbPut } from './idb';

const FILE = 'flashcards.db';
const VERSION = 'flashcards.db.version';

const persist: Persist = {
  async load() {
    const bytes = await idbGet<Uint8Array>(FILE);
    if (!bytes) return null;
    return { bytes, version: (await idbGet<number>(VERSION)) ?? 0 };
  },
  async version() {
    return (await idbGet<number>(VERSION)) ?? 0;
  },
  save: (bytes, version) => idbPut({ [FILE]: bytes, [VERSION]: version }),
  exclusive(f) {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? (locks.request('flashcards-db', f) as ReturnType<typeof f>) : f();
  },
};

let engine: Promise<Engine> | null = null;

/** Another tab changed the data: read it again, then tell this tab's screens. */
async function catchUp(): Promise<void> {
  const e = await engine;
  if (e && (await e.refresh())) emitLocal('data-changed', { from: 'another-tab' });
}

export function database(): Promise<Engine> {
  // (The typings mark an unrelated option as required.)
  engine ??= initSqlJs({ locateFile: () => wasmUrl } as unknown as Parameters<typeof initSqlJs>[0])
    .then((SQL) => {
      onOtherTab((msg) => {
        if (msg.type === 'db') void catchUp().catch(() => {});
      });
      // A message can be missed (a tab asleep in the background): check on return.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void catchUp().catch(() => {});
      });
      return createEngine(SQL, persist, {
        saved: (version) => tellOtherTabs({ type: 'db', version, from: TAB }),
      });
    })
    .catch((err: unknown) => {
      engine = null;
      throw typeof err === 'string' ? err : 'Could not start the database in this browser.';
    });
  return engine;
}
