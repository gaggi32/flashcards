// What the screens call: sets, cards and study progress, read from and written
// to the local store (lib/store).

import { announceDataChange } from '@/lib/app/events';
import { aiClearKey, aiKeyStatus, aiRequest, aiSetKey, getSettings } from '@/lib/app/native';
import { fetchAccountStatus } from '@/lib/openrouter/account';
import type { AiKeyStatus } from '@/lib/openrouter/types';
import { ApiError, asApiError, errorMessage } from '@/lib/store/errors';
import * as repo from '@/lib/store/repo';
import { generateCards as runGenerate } from './generate';
import type { Quality } from './sm2';
import type {
  CardDTO,
  GenerateCount,
  GenerateResult,
  LearnCardDTO,
  LearnStatsDTO,
  ProgressDTO,
  SetDTO,
  SetSummaryDTO,
} from './types';

export { ApiError, errorMessage };

async function read<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw asApiError(err);
  }
}

async function write<T>(fn: () => Promise<T>): Promise<T> {
  const out = await read(fn);
  announceDataChange();
  return out;
}

// --- sets ---

export function fetchSets(): Promise<{ sets: SetSummaryDTO[] }> {
  return read(async () => ({ sets: await repo.listSets() }));
}

export function fetchSet(id: number): Promise<{ set: SetDTO }> {
  return read(async () => ({ set: await repo.getSet(id) }));
}

export type SetMeta = {
  title: string;
  description: string | null;
  folder?: string | null;
  isPublic?: boolean;
  inOverlay?: boolean;
};

export function createSet(meta: SetMeta): Promise<{ set: SetSummaryDTO }> {
  return write(async () => ({ set: await repo.createSet(meta) }));
}

export function updateSet(id: number, meta: Partial<SetMeta>): Promise<{ set: SetSummaryDTO }> {
  return write(async () => ({ set: await repo.updateSet(id, meta) }));
}

/**
 * Start the set over: no progress, and no half-done round in any mode. The
 * keys are the ones FlashcardsClient, WriteClient and LearnClient save under
 * (LearnClient's older ones had a date on the end).
 */
export function resetSet(id: number): Promise<{ ok: true; reset: number }> {
  return write(async () => {
    const reset = await repo.resetProgress(id);
    try {
      const keys = [`fc-deck-session-${id}`, `fc-write-session-${id}`, `fc-session-${id}`];
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (keys.includes(key) || key.startsWith(`fc-session-${id}-`))) localStorage.removeItem(key);
      }
    } catch {
      /* no storage: nothing saved to forget */
    }
    return { ok: true as const, reset };
  });
}

// --- folders ---

export function fetchFolders(): Promise<{ folders: string[] }> {
  return read(async () => ({ folders: await repo.listFolders() }));
}

/** Rename a folder, or take every set out of it with `to: null`. */
export function renameFolder(from: string, to: string | null): Promise<{ ok: true; moved: number }> {
  return write(async () => ({ ok: true as const, moved: await repo.renameFolder(from, to) }));
}

export function deleteSet(id: number): Promise<{ ok: true }> {
  return write(async () => {
    await repo.deleteSet(id);
    return { ok: true as const };
  });
}

// --- cards ---

export type NewCard = { term: string; definition: string; position?: number };

/** Returns the created cards in the order they were sent. */
export function addCards(setId: number, cards: NewCard[]): Promise<{ cards: CardDTO[] }> {
  return write(async () => ({ cards: await repo.addCards(setId, cards) }));
}

export type CardChange = { id: number } & Partial<Omit<CardDTO, 'id'>>;

/** Edit and delete existing cards in one transaction (the editor's save). */
export function patchCards(
  setId: number,
  changes: { remove: number[]; update: CardChange[] },
): Promise<{ ok: true; removed: number; updated: number }> {
  return write(async () => ({ ok: true as const, ...(await repo.patchCards(setId, changes)) }));
}

export function updateCard(id: number, changes: Partial<Omit<CardDTO, 'id'>>): Promise<{ card: CardDTO }> {
  return write(async () => ({ card: await repo.updateCard(id, changes) }));
}

export function deleteCard(id: number): Promise<{ ok: true }> {
  return write(async () => {
    await repo.deleteCard(id);
    return { ok: true as const };
  });
}

// --- learn mode ---

export function fetchLearnQueue(setId: number): Promise<{ cards: LearnCardDTO[] }> {
  return read(async () => ({ cards: await repo.learnQueue(setId) }));
}

export function fetchLearnStats(setId: number): Promise<{ stats: LearnStatsDTO }> {
  return read(async () => ({ stats: await repo.learnStats(setId) }));
}

/**
 * `seen`: the card's streak (repetitionNumber) before this answer, null if it
 * was never reviewed — so a repeated call is not counted twice.
 */
export function reviewCard(
  cardId: number,
  quality: Quality,
  today: string,
  seen: number | null,
): Promise<{ progress: ProgressDTO; rescheduled: boolean }> {
  return write(async () => {
    const res = await repo.reviewCard(cardId, quality, today, seen);
    return { progress: res.progress as ProgressDTO, rescheduled: res.rescheduled };
  });
}

type ReviewResults = Record<number, { progress: ProgressDTO; rescheduled: boolean }>;

export function reviewBatch(
  reviews: { cardId: number; quality: Quality }[],
  today: string,
): Promise<{ ok: true; results: ReviewResults }> {
  return write(async () => ({
    ok: true as const,
    results: (await repo.reviewBatch(reviews, today)) as ReviewResults,
  }));
}

// --- AI: generating cards, and the OpenRouter key that pays for it ---

export type GenerateRequest = {
  images: Blob[];
  text: string;
  focus: string;
  count: GenerateCount;
};

export async function generateCards(input: GenerateRequest): Promise<GenerateResult> {
  const { aiModel } = await getSettings();
  return runGenerate(input, aiModel);
}

// The key goes to the OS credential store through Rust and never comes back:
// `hint` (the last four characters) is all the UI ever sees.

async function keyStatus(): Promise<AiKeyStatus> {
  const s = await aiKeyStatus();
  if (!s.present) return { source: 'none', hint: null, account: null };
  return { source: 'user', hint: s.hint, account: await fetchAccountStatus() };
}

export function fetchAiKeyStatus(): Promise<AiKeyStatus> {
  return read(keyStatus);
}

export function saveAiKey(apiKey: string): Promise<AiKeyStatus> {
  return read(async () => {
    await aiSetKey(apiKey);
    // Catch a typo now rather than at the first generation. Only 401/403 count
    // against the key; a network blip or a 5xx is not the key's fault.
    const check = await aiRequest('credits').catch(() => null);
    if (check && (check.status === 401 || check.status === 403)) {
      await aiClearKey();
      throw new ApiError('OpenRouter did not accept that key.', 400);
    }
    return keyStatus();
  });
}

export function deleteAiKey(): Promise<AiKeyStatus> {
  return read(async () => {
    await aiClearKey();
    return { source: 'none' as const, hint: null, account: null };
  });
}
