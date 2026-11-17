import { describe, expect, it } from 'vitest';

import { groupByFolder } from './folders';

const set = (id: number, title: string, folder: string | null = null) => ({ id, title, folder });

describe('groupByFolder', () => {
  it('lists folders by name, each with its sets by title, then the sets in no folder', () => {
    const groups = groupByFolder([
      set(1, 'Zebra'),
      set(2, 'Verbs', 'Spanish'),
      set(3, 'Bones', 'biology'),
      set(4, 'Apple'),
      set(5, 'Nouns', 'Spanish'),
      set(6, 'Cells', 'biology'),
    ]);
    expect(groups.map((g) => [g.folder, g.sets.map((s) => s.id)])).toEqual([
      ['biology', [3, 6]],
      ['Spanish', [5, 2]],
      [null, [4, 1]],
    ]);
  });

  it('gives one unnamed group when no set is in a folder', () => {
    expect(groupByFolder([set(1, 'b'), set(2, 'a')])).toEqual([{ folder: null, sets: [set(2, 'a'), set(1, 'b')] }]);
  });

  it('leaves out the unnamed group when every set is in a folder', () => {
    expect(groupByFolder([set(1, 'a', 'x')]).map((g) => g.folder)).toEqual(['x']);
  });

  it('gives nothing for no sets', () => {
    expect(groupByFolder([])).toEqual([]);
  });
});
