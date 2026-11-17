// The <option>s of a set picker, grouped by folder like the sets screen:
// one <optgroup> per folder, then "not in a folder". With no folders at all,
// a plain list.

import { useMemo } from 'react';

import { groupByFolder } from '@/lib/flashcards/folders';
import type { SetSummaryDTO } from '@/lib/flashcards/types';

export function SetOptions({ sets }: { sets: SetSummaryDTO[] }) {
  const groups = useMemo(() => groupByFolder(sets), [sets]);
  const options = (list: SetSummaryDTO[]) =>
    list.map((s) => (
      <option key={s.id} value={s.id}>
        {s.title}
      </option>
    ));
  if (groups.length === 1 && groups[0].folder === null) return <>{options(groups[0].sets)}</>;
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.folder === null ? 'loose' : `f:${g.folder}`} label={g.folder ?? 'not in a folder'}>
          {options(g.sets)}
        </optgroup>
      ))}
    </>
  );
}
