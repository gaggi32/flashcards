// A set row being dragged. The drag is a real OS file drag (drag_set_out in
// lib.rs), so it can leave the window and land on the desktop as the set's
// file. Inside the window it arrives like any dropped file, so the folder rows
// and the file drop (SetFileDrop) ask here whether it is one of ours: a folder
// takes it as a move, and nothing imports it as a new set.
//
// The drop can reach the page a moment after the OS says the drag ended, so
// the set stays "ours" for a short while after.

import { dragSetOut } from '@/lib/app/native';
import { exportSet, setFileName } from '@/lib/store/transfer';

const GRACE_MS = 1500;

let active: { setId: number; until: number } | null = null;

/** The set being dragged out of this window, or null when the drag is not ours. */
export function ownDraggedSet(): number | null {
  if (!active) return null;
  if (Date.now() > active.until) {
    active = null;
    return null;
  }
  return active.setId;
}

/** A drop inside the window has taken the set; later file drops are not ours. */
export function clearOwnDrag(): void {
  active = null;
}

/** The set's file, read when the pointer goes down so the drag can start at once. */
export async function prepareSetFile(setId: number, title: string): Promise<{ contents: string; name: string }> {
  const file = await exportSet(setId);
  return { contents: JSON.stringify(file, null, 1), name: setFileName(title) };
}

/** Start the OS drag of a prepared set file. Resolves when the drag is over. */
export async function dragSetFile(setId: number, file: { contents: string; name: string }): Promise<boolean> {
  active = { setId, until: Number.POSITIVE_INFINITY };
  try {
    return await dragSetOut(file.contents, file.name);
  } finally {
    if (active?.setId === setId) active.until = Date.now() + GRACE_MS;
  }
}
