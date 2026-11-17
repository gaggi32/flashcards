// Sets grouped the way the sets screen shows them: each folder by name with
// its sets by title, then the sets in no folder (folder: null), last.

export type FolderGroup<S> = { folder: string | null; sets: S[] };

export function groupByFolder<S extends { title: string; folder: string | null }>(sets: S[]): FolderGroup<S>[] {
  const byTitle = [...sets].sort((a, b) => a.title.localeCompare(b.title));
  const byFolder = new Map<string, S[]>();
  const loose: S[] = [];
  for (const s of byTitle) {
    if (s.folder === null) loose.push(s);
    else byFolder.set(s.folder, [...(byFolder.get(s.folder) ?? []), s]);
  }
  const groups: FolderGroup<S>[] = [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, list]) => ({ folder, sets: list }));
  if (loose.length > 0) groups.push({ folder: null, sets: loose });
  return groups;
}
