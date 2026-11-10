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
