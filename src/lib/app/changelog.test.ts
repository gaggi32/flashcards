import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { changesSince, compareVersions, parseChangelog, parseGroups, plainLine } from './changelog';

const SAMPLE = `# Changelog

Intro line.

## [Unreleased]
### Added
- Not out yet.

## [0.1.10] — 2026-11-12
### Added
- Reset a set's progress.
### Fixed
- Tab never leaves the overlay.

## [0.1.9] — 2026-11-12
### Changed
- Tab cycles through the study buttons.

## [0.1.8] — 2026-11-12
### Fixed
- A missing hyphen counts as wrong.
`;

describe('parseChangelog', () => {
  it('reads every released version, newest first, and skips Unreleased', () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries.map((e) => e.version)).toEqual(['0.1.10', '0.1.9', '0.1.8']);
    expect(entries[0]).toEqual({
      version: '0.1.10',
      date: '2026-11-12',
      groups: [
        { heading: 'Added', items: ["Reset a set's progress."] },
        { heading: 'Fixed', items: ['Tab never leaves the overlay.'] },
      ],
    });
  });

  it('reads the real CHANGELOG.md, with a section for the running version', () => {
    const text = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
    const entries = parseChangelog(text);
    const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
    expect(entries.length).toBeGreaterThan(10);
    expect(entries[0].version).toBe(version);
    expect(entries.every((e) => e.groups.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true);
  });
});

describe('changesSince', () => {
  const entries = parseChangelog(SAMPLE);

  it('is what came after the version seen, up to the running one', () => {
    expect(changesSince(entries, '0.1.8', '0.1.10').map((e) => e.version)).toEqual(['0.1.10', '0.1.9']);
    expect(changesSince(entries, '0.1.9', '0.1.9')).toEqual([]);
    // Compared as numbers: 0.1.10 is newer than 0.1.9.
    expect(changesSince(entries, '0.1.9', '0.1.10').map((e) => e.version)).toEqual(['0.1.10']);
  });

  it('never shows versions newer than the one running', () => {
    expect(changesSince(entries, '0.1.8', '0.1.9').map((e) => e.version)).toEqual(['0.1.9']);
  });
});

describe('release notes', () => {
  it('reads the groups of a release body, and loose items', () => {
    expect(parseGroups('### Fixed\n- One.\n- Two.\n')).toEqual([{ heading: 'Fixed', items: ['One.', 'Two.'] }]);
    expect(parseGroups('- Only an item')).toEqual([{ heading: 'Changes', items: ['Only an item'] }]);
    expect(parseGroups('')).toEqual([]);
  });

  it('shows markdown marks as plain text', () => {
    expect(plainLine('Kept in `settings.json`, **not** lost')).toBe('Kept in settings.json, not lost');
  });

  it('compares versions as numbers', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
  });
});
