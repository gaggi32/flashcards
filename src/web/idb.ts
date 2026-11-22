// The web version's one place on disk: an IndexedDB database in this browser,
// holding the SQLite file as bytes, its version counter, the settings and the
// OpenRouter key. Several keys can be written in one transaction, so the
// database file and its version never disagree.

const NAME = 'flashcards-web';
const STORE = 'kv';

let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      // Another tab with a newer version of this code wants to upgrade.
      db.onversionchange = () => {
        db.close();
        opened = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is not available'));
    req.onblocked = () => reject(new Error('Close the other Flashcards tabs and reload.'));
  }).catch((err: unknown) => {
    opened = null;
    throw err;
  });
  return opened;
}

const failed = (err: unknown) =>
  err instanceof DOMException && err.name === 'QuotaExceededError'
    ? 'This browser has no room left to save your sets.'
    : 'This browser would not let Flashcards save (private browsing, or storage turned off).';

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(failed(req.error));
  });
}

/** Writes every entry in one transaction; `undefined` deletes the key. */
export async function idbPut(entries: Record<string, unknown>): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await open();
  } catch (err) {
    throw failed(err);
  }
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) store.delete(key);
      else store.put(value, key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failed(tx.error));
    tx.onabort = () => reject(failed(tx.error));
  });
}
