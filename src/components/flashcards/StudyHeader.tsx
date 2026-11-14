import { useEffect, useRef, type ReactNode } from 'react';

import Link from '@/components/Link';

import type { SetDTO } from '@/lib/flashcards/types';
import { IconChevronLeft } from './FlashcardIcons';

type Mode = 'cards' | 'write' | 'learn';

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'cards', label: 'flashcards' },
  { mode: 'write', label: 'write' },
  { mode: 'learn', label: 'learn' },
];

/** Back to the set, the set's name, and a switch between the study modes. */
export function StudyHeader({ set, mode }: { set: SetDTO; mode: Mode }) {
  return (
    <>
      <Link href={`/flashcards/${set.id}`} className="rt-backlink">
        <IconChevronLeft />
        Back to set
      </Link>
      <div className="fc-studyhead">
        <h1 className="fc-studyhead__title">{set.title}</h1>
        <nav className="fc-tabs" aria-label="Study mode">
          {MODES.map((m) => (
            <Link
              key={m.mode}
              href={`/flashcards/${set.id}/${m.mode}`}
              className={`fc-tab${m.mode === mode ? ' is-active' : ''}`}
              aria-current={m.mode === mode ? 'page' : undefined}
            >
              {m.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** What Tab can reach inside root, in order: shown, enabled, not taken out of the order. */
export function tabStops(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
}

/**
 * Whether Enter is for the focused control rather than the screen's own Enter
 * shortcut: a focused button or link does what it says ("I was correct",
 * "skip", "back to set"), not whatever Enter means on that step.
 */
export function enterIsForFocus(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches('button, a[href], select, textarea, summary');
}

/**
 * The study screen below the header. Tab goes round its buttons and the
 * answer box: past the last one it comes back to the first (Shift+Tab the
 * other way) instead of leaving for the back link and the mode tabs, or in
 * the overlay its mode switch. Focus that is already up there (clicked)
 * moves on as usual.
 */
export function StudyArea({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      const root = ref.current;
      if (!root) return;
      const active = document.activeElement;
      const nowhere = active === null || active === document.body || active === document.documentElement;
      if (!nowhere && !root.contains(active)) return;
      const stops = tabStops(root);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      let target: HTMLElement | null = null;
      if (nowhere || !stops.includes(active as HTMLElement)) {
        // Nothing focused (the button that had it went away): start in here.
        if (nowhere) target = e.shiftKey ? last : first;
      } else if (!e.shiftKey && active === last) {
        target = first;
      } else if (e.shiftKey && active === first) {
        target = last;
      }
      if (!target) return;
      e.preventDefault();
      target.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div ref={ref} className="fc-studyarea" style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
