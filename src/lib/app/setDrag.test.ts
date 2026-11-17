import { afterEach, describe, expect, it, vi } from 'vitest';

const dragSetOut = vi.fn<(contents: string, name: string) => Promise<boolean>>();
vi.mock('@/lib/app/native', () => ({ dragSetOut: (c: string, n: string) => dragSetOut(c, n) }));
vi.mock('@/lib/store/transfer', () => ({
  exportSet: async (id: number) => ({ format: 'flashcards', sets: [{ id }] }),
  setFileName: (title: string) => `${title.toLowerCase()}.json`,
}));

const { clearOwnDrag, dragSetFile, ownDraggedSet, prepareSetFile } = await import('./setDrag');

afterEach(() => {
  vi.useRealTimers();
  clearOwnDrag();
  dragSetOut.mockReset();
});

describe('a set row dragged out of the window', () => {
  it('is ours while the drag runs and for a moment after, so its own drop is not imported', async () => {
    vi.useFakeTimers();
    let finish!: (dropped: boolean) => void;
    dragSetOut.mockReturnValue(new Promise((r) => (finish = r)));

    const file = await prepareSetFile(7, 'Verbs');
    expect(file.name).toBe('verbs.json');
    const drag = dragSetFile(7, file);
    expect(ownDraggedSet()).toBe(7);

    finish(true);
    await drag;
    expect(ownDraggedSet()).toBe(7);
    vi.advanceTimersByTime(2000);
    expect(ownDraggedSet()).toBeNull();
  });

  it('is no longer ours once a folder has taken it', async () => {
    dragSetOut.mockResolvedValue(true);
    await dragSetFile(3, { contents: '{}', name: 'x.json' });
    clearOwnDrag();
    expect(ownDraggedSet()).toBeNull();
  });

  it('a drag that failed to start leaves nothing behind for long', async () => {
    vi.useFakeTimers();
    dragSetOut.mockRejectedValue('Could not start the drag.');
    await expect(dragSetFile(4, { contents: '{}', name: 'x.json' })).rejects.toBe('Could not start the drag.');
    vi.advanceTimersByTime(2000);
    expect(ownDraggedSet()).toBeNull();
  });
});
