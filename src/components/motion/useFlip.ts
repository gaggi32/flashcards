// Lists that move instead of jumping. When the items in a list change (one
// added, removed, moved, or a set filed into a folder), the items that stay
// glide from where they were to where they are now, rather than jumping.
// Items are told apart by `data-flip`, else their `href`. Nothing moves when
// only an item's contents change (typing in the editor), or with motion off.

import { useLayoutEffect, useRef, type RefObject } from 'react';

import { motionLevel } from '@/lib/app/theme';

function keyOf(el: Element, i: number): string {
  return (el as HTMLElement).dataset.flip ?? el.getAttribute('href') ?? `#${i}`;
}

export function useFlip(ref: RefObject<HTMLElement | null>): void {
  const last = useRef<{ box: HTMLElement; order: string; rects: Map<string, { x: number; y: number }> } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const items = Array.from(box.children);
    const keys = items.map(keyOf);
    const order = keys.join('\n');
    // Measured from the list's own corner, so scrolling the page in between
    // moves nothing.
    const origin = box.getBoundingClientRect();
    const rects = new Map(
      items.map((el, i) => {
        const r = el.getBoundingClientRect();
        return [keys[i], { x: r.left - origin.left, y: r.top - origin.top }];
      }),
    );
    const prev = last.current;
    last.current = { box, order, rects };
    if (!prev || prev.box !== box || prev.order === order || motionLevel() === 'off') return;
    items.forEach((el, i) => {
      const before = prev.rects.get(keys[i]);
      const now = rects.get(keys[i]);
      if (!before || !now) return;
      const dx = before.x - now.x;
      const dy = before.y - now.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      (el as HTMLElement).animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
        duration: 380,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });
    });
  });
}
