// What the screens call: sets, cards and study progress, read from and written
// to the local store (lib/store).

import { announceDataChange } from '@/lib/app/events';
import { aiClearKey, aiKeyStatus, aiRequest, aiSetKey, getSettings, markSessionsCarriedOver } from '@/lib/app/native';
import { fetchAccountStatus } from '@/lib/openrouter/account';
import type { AiKeyStatus } from '@/lib/openrouter/types';
import { ApiError, asApiError, errorMessage } from '@/lib/store/errors';
import * as repo from '@/lib/store/repo';
import type { Deck } from './deck';
import { generateCards as runGenerate } from './generate';
import type { LearnSession } from './learn';
import {
  isLegacySessionKey,
  legacySnapshots,
  packDeck,
  packLearn,
  packWrite,
  unpackDeck,
  unpackLearn,
  unpackWrite,
  type StudyMode,
} from './saved';
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
import type { AnswerWith, StudyCard, WriteSession } from './write';

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
 * Start Learn over for one set: every card new again, and Learn's half-done
 * session dropped. Flashcards and Write rounds are left alone. In line with
 * this window's session saves, so one still on its way can't bring the
 * session back.
 */
export function resetLearnProgress(id: number): Promise<{ ok: true; reset: number }> {
  known.delete(sessionKey(id, 'learn'));
  return inOrder(() => write(async () => ({ ok: true as const, reset: await repo.resetProgress(id) })));
}

// --- folders ---

export function fetchFolders(): Promise<{ folders: string[] }> {
  return read(async () => ({ folders: await repo.listFolders() }));
}

/** Make an empty folder; returns its name as kept (trimmed). One that exists already is left as it is. */
export function createFolder(name: string): Promise<{ folder: string }> {
  return write(async () => ({ folder: await repo.createFolder(name) }));
}

/** Rename a folder, or remove it with `to: null` (its sets stay, outside any folder). */
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

// --- study sessions ---
//
// Each mode's unfinished round per set is kept in the database (saved.ts has
// the shapes), so it survives a restart and both windows carry on with the
// same one. A screen saves on every change without waiting for it. This
// window's session reads and writes run one after another, in the order they
// were made, so a load always sees this window's last save; the other window
// hears of each save through data-changed and reads the round afresh when it
// comes back to the front.

let pending: Promise<unknown> = Promise.resolve();

function inOrder<T>(fn: () => Promise<T>): Promise<T> {
  const run = pending.then(() => fn());
  pending = run.catch(() => {});
  return run;
}

/**
 * What this window last read or wrote per set and mode. A screen saves as it
 * mounts; when that is what was just loaded, nothing is written, so the
 * other window is not told of a change that never happened.
 */
const known = new Map<string, string>();
const sessionKey = (setId: number, mode: StudyMode) => `${setId}:${mode}`;

/** JSON with object keys sorted, so the same round always compares equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function saveSession(setId: number, mode: StudyMode, data: unknown): void {
  const key = sessionKey(setId, mode);
  const json = canonical(data);
  if (data !== null && known.get(key) === json) return;
  known.set(key, json);
  void inOrder(() => write(() => repo.saveSession(setId, mode, data))).catch(() => {
    // Not kept this time: the round goes on, and the next change saves it.
    if (known.get(key) === json) known.delete(key);
  });
}

function loadSession(setId: number, mode: StudyMode): Promise<unknown> {
  return inOrder(async () => {
    await carryOverSessions();
    const data = await read(() => repo.getSession(setId, mode));
    known.set(sessionKey(setId, mode), canonical(data));
    return data;
  });
}

/** Flashcards' saved round over the set's cards now, or null. */
export async function loadDeck(setId: number, cardIds: number[]): Promise<Deck | null> {
  return unpackDeck(await loadSession(setId, 'cards'), cardIds);
}

export function saveDeck(setId: number, deck: Deck): void {
  saveSession(setId, 'cards', deck.done ? null : packDeck(deck));
}

/** Write's saved round over the set's cards now (in set order), or null. */
export async function loadWrite(setId: number, cards: StudyCard[]): Promise<WriteSession | null> {
  return unpackWrite(await loadSession(setId, 'write'), cards);
}

export function saveWrite(setId: number, session: WriteSession): void {
  saveSession(setId, 'write', session.step.kind === 'summary' ? null : packWrite(session));
}

/** Learn's saved session over `queue` (learnQueue: the cards with their progress now), or null. */
export async function loadLearn(
  setId: number,
  queue: LearnCardDTO[],
  pool: StudyCard[],
): Promise<LearnSession | null> {
  return unpackLearn(await loadSession(setId, 'learn'), queue, pool);
}

export function saveLearn(setId: number, session: LearnSession): void {
  saveSession(setId, 'learn', session.step.kind === 'summary' ? null : packLearn(session));
}

export function clearSession(setId: number, mode: StudyMode): void {
  saveSession(setId, mode, null);
}

/** The side Write or Learn last asked for in this set: where a new round starts. */
export function loadSide(setId: number, mode: 'write' | 'learn'): Promise<AnswerWith | null> {
  return inOrder(() => read(() => repo.getSide(setId, mode)));
}

/** Remembers the side a round started on or was switched to, without waiting for it. */
export function rememberSide(setId: number, mode: 'write' | 'learn', side: AnswerWith): void {
  void inOrder(() => write(() => repo.saveSide(setId, mode, side))).catch(() => {
    // Only a convenience: the next round starts on the term side instead.
  });
}

let carried: Promise<void> | null = null;

/**
 * Moves the rounds versions up to 0.1.14 kept in localStorage into the
 * database, once: before this window's first session is read, so no screen
 * starts afresh over a round still waiting to come across.
 *
 * Once is kept by a flag in settings.json (sessionsCarriedOver), set only
 * after the rows are in. Removing the old keys is a localStorage write a
 * killed webview can lose, so keys still there once the flag is set are only
 * removed, never imported again: a round finished since stays finished.
 * Both windows may run it before the flag is set; a round goes in only where
 * the database has none for that set and mode, so that is harmless. A
 * snapshot that can't be read is left in localStorage as it was.
 */
export function carryOverSessions(): Promise<void> {
  carried ??= (async () => {
    let entries: [string, string][];
    try {
      entries = Object.keys(localStorage)
        .filter(isLegacySessionKey)
        .map((key) => [key, localStorage.getItem(key) ?? '']);
    } catch {
      return; // no storage: nothing to carry over
    }
    const found = legacySnapshots(entries);
    if (!(await getSettings()).sessionsCarriedOver) {
      const rounds = found.flatMap((s) => (s.data === null ? [] : [{ setId: s.setId, mode: s.mode, data: s.data }]));
      if ((await repo.importSessions(rounds)) > 0) announceDataChange();
      await markSessionsCarriedOver();
    }
    try {
      for (const s of found) for (const key of s.keys) localStorage.removeItem(key);
    } catch {
      /* removed next time; the rows are in, so nothing is taken twice */
    }
  })().catch((err: unknown) => {
    carried = null; // try again with the next load
    throw asApiError(err);
  });
  return carried;
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
