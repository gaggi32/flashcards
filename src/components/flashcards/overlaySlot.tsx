// The overlay is small and meant for a few quick answers, so the screens it
// borrows keep only what you need to answer on show. Their other controls
// (shuffle, which side first, answer with the other side, reset) move into
// the overlay's "⋯" menu: wrapped in <MoreControls>, they render in place in
// the main window and, in the overlay, in that menu instead.

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const OverlayContext = createContext<{ menu: HTMLElement | null } | null>(null);

/** True inside the hotkey overlay. */
export function useInOverlay(): boolean {
  return useContext(OverlayContext) !== null;
}

/** Secondary controls: in place in the main window, in the "⋯" menu in the overlay. */
export function MoreControls({ children }: { children: ReactNode }) {
  const overlay = useContext(OverlayContext);
  if (!overlay) return <>{children}</>;
  return overlay.menu ? createPortal(children, overlay.menu) : null;
}
