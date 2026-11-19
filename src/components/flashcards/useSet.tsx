
import Link from '@/components/Link';
import { useEffect, useState } from 'react';

import { forget, primed } from '@/lib/app/prime';
import { ApiError, fetchSet } from '@/lib/flashcards/client';
import type { SetDTO } from '@/lib/flashcards/types';

/**
 * One set with its cards, fetched on mount. `set` stays null until it lands,
 * unless the link that led here read it already (lib/app/prime.ts).
 */
export function useSet(id: number) {
  const [set, setSet] = useState<SetDTO | null>(() => primed(`set:${id}`));
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let live = true;
    // Read a moment ago by the link that led here: nothing to read again
    // (and a second, equal set would restart the screens built on it).
    const had = primed(`set:${id}`);
    forget(`set:${id}`);
    if (had) return;
    setSet(null);
    setError(null);
    fetchSet(id)
      .then((res) => {
        if (live) setSet(res.set);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setError(err instanceof ApiError ? err : new ApiError('Could not load this set.', 0));
      });
    return () => {
      live = false;
    };
  }, [id]);

  return { set, error };
}

/** What a set screen shows before its set exists: a skeleton, or why not. */
export function SetLoadState({ error }: { error: ApiError | null }) {
  if (!error) {
    return (
      <div className="fc-loading" aria-busy="true" aria-label="Loading set">
        <div className="fc-skel" style={{ width: '40%', height: 26 }} />
        <div className="fc-skel" style={{ height: 180 }} />
      </div>
    );
  }

  return (
    <div className="rt-section">
      <div className="rt-note rt-note--err">
        <div className="rt-note__title">{error.status === 404 ? 'NOT FOUND' : 'COULD NOT LOAD'}</div>
        {error.status === 404
          ? 'This set does not exist, or it belongs to another account.'
          : error.message}
      </div>
      <div className="rt-btnrow" style={{ marginTop: 16 }}>
        <Link href="/flashcards" className="rt-btn">
          all sets
        </Link>
      </div>
    </div>
  );
}
