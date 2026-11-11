// Shapes shared by the local store (lib/store) and the screens.

import type { AiUsage, KeySource } from '@/lib/openrouter/types';

export type CardDTO = {
  id: number;
  term: string;
  definition: string;
  position: number;
};

export type SetSummaryDTO = {
  id: number;
  /**
   * The owner's folder for this set, or null. A folder is nothing but this
   * label: it exists while at least one set carries it. Never sent for
   * someone else's public set — their filing is theirs.
   */
  folder: string | null;
  /** Always false: sets are never shared. */
  isPublic: boolean;
  isOwner: boolean;
  /** The owner's name, sent only for someone else's public set. */
  authorName: string | null;
  title: string;
  description: string | null;
  createdAt: string;
  cardCount: number;
  /** Whether the hotkey overlay draws cards from this set. */
  inOverlay?: boolean;
};

export type SetDTO = SetSummaryDTO & { cards: CardDTO[] };

// --- learn mode ---

/** One card's SM-2 schedule for the signed-in user. Days are YYYY-MM-DD. */
export type ProgressDTO = {
  cardId: number;
  repetitionNumber: number;
  easeFactor: number;
  intervalDays: number;
  nextReviewDate: string;
  lastReviewedAt: string | null;
};

/**
 * How well a card is known: never studied, studied but not yet answered right
 * twice in a row, or learned. The learn queue is in that order.
 */
export type LearnStatus = 'new' | 'learning' | 'learned';

export type LearnCardDTO = CardDTO & {
  status: LearnStatus;
  /** Null until the card's first review. */
  progress: ProgressDTO | null;
};

export type LearnStatsDTO = {
  total: number;
  /** Never reviewed. */
  new: number;
  /** Reviewed, but not yet answered right twice in a row. */
  learning: number;
  /** repetitionNumber >= 2. */
  learned: number;
};

/**
 * Caps on what one database holds, checked before every write and mirrored in
 * the editor so it can say so before a save fails. Generous for studying: they
 * only stop a runaway paste from making the app crawl.
 */
export const LIMITS = {
  folderNameLength: 60,
  setsPerUser: 1000,
  cardsPerSet: 5000,
  cardsPerUser: 200_000,
  cardsPerRequest: 5000,
  titleLength: 200,
  descriptionLength: 2000,
  sideLength: 2000,
} as const;

// --- AI generation ---

/** How many cards to ask for. "auto" lets the material decide, up to the cap. */
export const GENERATE_COUNTS = ['auto', '10', '20', '40'] as const;
export type GenerateCount = (typeof GENERATE_COUNTS)[number];

/**
 * Caps on one generate request, enforced by the API and mirrored in the panel.
 * Everything here is billed by the token, and Vercel refuses a request body
 * much past 4.5 MB however it is split between screenshots.
 */
export const AI_LIMITS = {
  images: 4,
  totalImageBytes: 4 * 1024 * 1024,
  textLength: 30_000,
  focusLength: 300,
  cards: 100,
} as const;

export type GeneratedCard = { term: string; definition: string };

export type GenerateResult = {
  /** A suggested set title, or null when the model had none. */
  title: string | null;
  cards: GeneratedCard[];
  model: string;
  billedTo: Exclude<KeySource, 'none'>;
  usage: AiUsage | null;
};
