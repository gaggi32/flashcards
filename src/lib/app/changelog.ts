// CHANGELOG.md, read for "What's new": the card after an update, and the
// notes of a version about to be installed (the release job writes the same
// section as the release's notes).

export type ChangeGroup = { heading: string; items: string[] };
export type ChangeEntry = { version: string; date: string; groups: ChangeGroup[] };

type Version = [number, number, number];

export function parseVersion(v: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when a is older than b, 0 when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** "### Added" headings and their "- " items, from one version's section or a release's notes. */
export function parseGroups(text: string): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  let current: ChangeGroup | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      current = { heading: heading[1].trim(), items: [] };
      groups.push(current);
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item) {
      if (!current) {
        current = { heading: 'Changes', items: [] };
        groups.push(current);
      }
      current.items.push(item[1].trim());
    }
  }
  return groups.filter((g) => g.items.length > 0);
}

/** Every "## [x.y.z] — date" section, newest first as the file has them. */
export function parseChangelog(text: string): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const parts = text.split(/^## /m).slice(1);
  for (const part of parts) {
    const head = /^\[(\d+\.\d+\.\d+)\](?:\s*[—–-]\s*(\S+))?/.exec(part);
    if (!head) continue; // [Unreleased], or anything else
    const body = part.slice(part.indexOf('\n') + 1);
    entries.push({ version: head[1], date: head[2] ?? '', groups: parseGroups(body) });
  }
  return entries;
}

/** The entries after `seen`, up to and including `running`, newest first. */
export function changesSince(entries: ChangeEntry[], seen: string, running: string): ChangeEntry[] {
  return entries
    .filter((e) => compareVersions(e.version, seen) > 0 && compareVersions(e.version, running) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** **bold** and `code` in a changelog line, as plain text for the UI. */
export function plainLine(line: string): string {
  return line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}
