/* Line glyphs for the flashcards app, drawn the way the food log's are: one
   24px grid, one stroke weight, round caps and joins, in currentColor so each
   takes the colour of the text it sits beside. */

function Frame({
  size,
  children,
}: {
  size: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** One card in front of another — the app, and the flip-through mode. */
export function IconCards({ size = 20 }: { size?: number }) {
  return (
    <Frame size={size}>
      <rect x="4" y="8" width="12" height="12" rx="2" />
      <path d="M8 4h10a2 2 0 0 1 2 2v10" />
    </Frame>
  );
}

/** Pencil — typing the answers out. */
export function IconWrite({ size = 20 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
      <path d="M14.5 5.5l3 3" />
    </Frame>
  );
}

/** Two arrows chasing each other — cards that come back on a schedule. */
export function IconLearn({ size = 20 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="m17 3 3 3-3 3" />
      <path d="M4 11V9a3 3 0 0 1 3-3h13" />
      <path d="m7 21-3-3 3-3" />
      <path d="M20 13v2a3 3 0 0 1-3 3H4" />
    </Frame>
  );
}

/** Four-point star — made by the model. */
export function IconGenerate({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M12 3.5 13.9 9a2 2 0 0 0 1.1 1.1l5.5 1.9-5.5 1.9a2 2 0 0 0-1.1 1.1L12 20.5 10.1 15A2 2 0 0 0 9 13.9L3.5 12 9 10.1A2 2 0 0 0 10.1 9z" />
    </Frame>
  );
}

/** Arrow into a tray — pasting cards in from elsewhere. */
export function IconImport({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" />
    </Frame>
  );
}

export function IconShuffle({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
      <path d="m18 2 4 4-4 4" />
      <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
      <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
      <path d="m18 14 4 4-4 4" />
    </Frame>
  );
}

/** The return key — "enter does this". */
export function IconEnter({ size = 14 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M20 5v6a3 3 0 0 1-3 3H5" />
      <path d="m9 10-4 4 4 4" />
    </Frame>
  );
}

export function IconCheck({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Frame>
  );
}

export function IconClose({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Frame>
  );
}

export function IconPlus({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M12 5v14M5 12h14" />
    </Frame>
  );
}

export function IconTrash({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </Frame>
  );
}

export function IconChevronLeft({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="m15 5-7 7 7 7" />
    </Frame>
  );
}

export function IconChevronRight({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="m9 5 7 7-7 7" />
    </Frame>
  );
}

export function IconArrowLeft({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Frame>
  );
}

export function IconArrowRight({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Frame>
  );
}

export function IconArrowUp({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Frame>
  );
}

export function IconArrowDown({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Frame>
  );
}

export function IconFolder({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Frame>
  );
}

export function IconGlobe({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8" />
      <path d="M12 3a14 14 0 0 0 0 18M12 3a14 14 0 0 1 0 18" />
    </Frame>
  );
}

export function IconLock({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Frame>
  );
}

export function IconSearch({ size = 16 }: { size?: number }) {
  return (
    <Frame size={size}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Frame>
  );
}
