// Everything the screens read and write, against the local database. This is
// what the web app's /api/sets, /api/cards and /api/folders routes did, minus
// accounts: there is one owner, and nothing is public.

import { z } from 'zod';

import { applyReview, type Quality } from '@/lib/flashcards/sm2';
import {
  LIMITS,
  type CardDTO,
  type LearnCardDTO,
  type LearnStatsDTO,
  type LearnStatus,
  type ProgressDTO,
  type SetDTO,
  type SetSummaryDTO,
} from '@/lib/flashcards/types';
import { db, type Param, type Stmt } from './db';
import { conflict, invalid, notFound } from './errors';
import {
  dayField,
  descriptionField,
  folderField,
  idField,
  parse,
  positionField,
  qualityField,
  sideField,
  titleField,
} from './validate';

// --- rows -----------------------------------------------------------------------

type SetRow = {
  id: number;
  folder: string | null;
  title: string;
  description: string | null;
  in_overlay: number;
  created_at: string;
  card_count: number;
};

type CardRow = { id: number; term: string; definition: string; position: number };

type ProgressRow = {
  card_id: number;
  repetition_number: number;
  ease_factor: number;
  interval_days: number;
  next_review_date: string;
  last_reviewed_at: string | null;
};

export type SetSummary = SetSummaryDTO & { inOverlay: boolean };

const SET_COLUMNS = `s.id, s.folder, s.title, s.description, s.in_overlay, s.created_at,
  (SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id) AS card_count`;

function toSummary(row: SetRow): SetSummary {
  return {
    id: row.id,
    folder: row.folder,
    isPublic: false,
    isOwner: true,
    authorName: null,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    cardCount: Number(row.card_count),
    inOverlay: Boolean(row.in_overlay),
  };
}

function toCard(row: CardRow): CardDTO {
  return { id: row.id, term: row.term, definition: row.definition, position: row.position };
}

function toProgress(row: ProgressRow): ProgressDTO {
  return {
    cardId: row.card_id,
    repetitionNumber: row.repetition_number,
    easeFactor: row.ease_factor,
    intervalDays: row.interval_days,
    nextReviewDate: row.next_review_date,
    lastReviewedAt: row.last_reviewed_at,
  };
}

const now = () => new Date().toISOString();

// --- sets -----------------------------------------------------------------------

export async function listSets(): Promise<SetSummary[]> {
  const rows = await db().select<SetRow>(
    `SELECT ${SET_COLUMNS} FROM sets s ORDER BY s.created_at DESC, s.id DESC`,
  );
  return rows.map(toSummary);
}

async function summary(id: number): Promise<SetSummary> {
  const [row] = await db().select<SetRow>(`SELECT ${SET_COLUMNS} FROM sets s WHERE s.id = ?`, [id]);
  if (!row) throw notFound('set');
  return toSummary(row);
}

export async function getSet(id: number): Promise<SetDTO & { inOverlay: boolean }> {
  const set = await summary(parse(idField, id));
  const cards = await db().select<CardRow>(
    'SELECT id, term, definition, position FROM cards WHERE set_id = ? ORDER BY position, id',
    [set.id],
  );
  return { ...set, cards: cards.map(toCard) };
}

const metaSchema = z.object({
  title: titleField,
  description: descriptionField.optional(),
  folder: folderField.optional(),
});

export async function createSet(meta: unknown): Promise<SetSummary> {
  const data = parse(metaSchema.passthrough(), meta);
  const [{ n }] = await db().select<{ n: number }>('SELECT COUNT(*) AS n FROM sets');
  if (n >= LIMITS.setsPerUser) throw conflict(`That is the ${LIMITS.setsPerUser}-set limit. Delete one first.`);
  const t = now();
  const [res] = await db().batch([
    {
      sql: 'INSERT INTO sets (folder, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      params: [data.folder ?? null, data.title, data.description ?? null, t, t],
    },
  ]);
  return summary(res.lastInsertId);
}

const updateSchema = z
  .object({
    title: titleField.optional(),
    description: descriptionField.optional(),
    folder: folderField.optional(),
    inOverlay: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });

export async function updateSet(id: number, changes: unknown): Promise<SetSummary> {
  parse(idField, id);
  // `isPublic` may still arrive from a ported screen; there is no library here.
  const { isPublic: _ignored, ...rest } = (changes ?? {}) as Record<string, unknown>;
  const data = parse(updateSchema, rest);
  const sets: string[] = [];
  const params: Param[] = [];
  if (data.title !== undefined) (sets.push('title = ?'), params.push(data.title));
  if (data.description !== undefined) (sets.push('description = ?'), params.push(data.description));
  if (data.folder !== undefined) (sets.push('folder = ?'), params.push(data.folder));
  if (data.inOverlay !== undefined) (sets.push('in_overlay = ?'), params.push(data.inOverlay ? 1 : 0));
  sets.push('updated_at = ?');
  params.push(now(), id);
  const [res] = await db().batch([{ sql: `UPDATE sets SET ${sets.join(', ')} WHERE id = ?`, params }]);
  if (res.rowsAffected === 0) throw notFound('set');
  return summary(id);
}

export async function deleteSet(id: number): Promise<void> {
  const [res] = await db().batch([{ sql: 'DELETE FROM sets WHERE id = ?', params: [parse(idField, id)] }]);
  if (res.rowsAffected === 0) throw notFound('set');
}

// --- folders --------------------------------------------------------------------

export async function listFolders(): Promise<string[]> {
  const rows = await db().select<{ folder: string }>(
    'SELECT DISTINCT folder FROM sets WHERE folder IS NOT NULL ORDER BY folder COLLATE NOCASE',
  );
  return rows.map((r) => r.folder);
}

const renameSchema = z.object({
  from: z.string().trim().min(1).max(LIMITS.folderNameLength),
  to: folderField,
});

/** Rename a folder, or take every set out of it with `to: null`. */
export async function renameFolder(from: string, to: string | null): Promise<number> {
  const data = parse(renameSchema, { from, to });
  const [res] = await db().batch([
    { sql: 'UPDATE sets SET folder = ?, updated_at = ? WHERE folder = ?', params: [data.to, now(), data.from] },
  ]);
  return res.rowsAffected;
}

// --- cards ----------------------------------------------------------------------

const newCardSchema = z.object({
  term: sideField,
  definition: sideField,
  position: positionField.optional(),
});
const newCardsSchema = z.array(newCardSchema).min(1, 'No cards to add').max(LIMITS.cardsPerRequest);

/** Rows per INSERT: six parameters each, well inside SQLite's limit. */
const INSERT_CHUNK = 500;

/** Returns the created cards in the order they were sent. All or nothing. */
export async function addCards(setId: number, cards: unknown): Promise<CardDTO[]> {
  parse(idField, setId);
  const list = parse(newCardsSchema, cards);

  const [counts] = await db().select<{ here: number; total: number; maxpos: number | null; found: number }>(
    `SELECT (SELECT COUNT(*) FROM cards WHERE set_id = ?) AS here,
            (SELECT COUNT(*) FROM cards) AS total,
            (SELECT MAX(position) FROM cards WHERE set_id = ?) AS maxpos,
            (SELECT COUNT(*) FROM sets WHERE id = ?) AS found`,
    [setId, setId, setId],
  );
  if (!counts.found) throw notFound('set');
  const here = Number(counts.here);
  if (here + list.length > LIMITS.cardsPerSet) {
    throw conflict(`A set holds at most ${LIMITS.cardsPerSet} cards — this one has ${here}.`);
  }
  if (Number(counts.total) + list.length > LIMITS.cardsPerUser) {
    throw conflict(`This app holds at most ${LIMITS.cardsPerUser.toLocaleString('en')} cards in all.`);
  }

  let next = (counts.maxpos ?? -1) + 1;
  const t = now();
  const rows = list.map((c) => ({ ...c, position: c.position ?? next++ }));
  const statements: Stmt[] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    statements.push({
      sql: `INSERT INTO cards (set_id, term, definition, position, created_at, updated_at) VALUES ${chunk
        .map(() => '(?, ?, ?, ?, ?, ?)')
        .join(', ')}`,
      params: chunk.flatMap((c) => [setId, c.term, c.definition, c.position, t, t]),
    });
  }
  statements.push({ sql: 'UPDATE sets SET updated_at = ? WHERE id = ?', params: [t, setId] });
  const results = await db().batch(statements);

  // One INSERT hands out consecutive row ids (one writer, AUTOINCREMENT), so
  // each chunk's ids run up to its lastInsertId.
  const created: CardDTO[] = [];
  results.slice(0, -1).forEach((res, k) => {
    const chunk = rows.slice(k * INSERT_CHUNK, (k + 1) * INSERT_CHUNK);
    const first = res.lastInsertId - chunk.length + 1;
    chunk.forEach((c, j) =>
      created.push({ id: first + j, term: c.term, definition: c.definition, position: c.position }),
    );
  });
  return created;
}

const cardChangeSchema = z
  .object({
    id: idField,
    term: sideField.optional(),
    definition: sideField.optional(),
    position: positionField.optional(),
  })
  .refine((c) => c.term !== undefined || c.definition !== undefined || c.position !== undefined, {
    message: 'Nothing to update',
  });

const patchSchema = z
  .object({
    remove: z.array(idField).max(LIMITS.cardsPerSet).default([]),
    update: z.array(cardChangeSchema).max(LIMITS.cardsPerSet).default([]),
  })
  .refine((v) => v.remove.length > 0 || v.update.length > 0, { message: 'Nothing to change' });

function cardUpdate(c: z.infer<typeof cardChangeSchema>, t: string, where: string, extra: Param[]): Stmt {
  const cols: string[] = [];
  const params: Param[] = [];
  if (c.term !== undefined) (cols.push('term = ?'), params.push(c.term));
  if (c.definition !== undefined) (cols.push('definition = ?'), params.push(c.definition));
  if (c.position !== undefined) (cols.push('position = ?'), params.push(c.position));
  cols.push('updated_at = ?');
  params.push(t, c.id, ...extra);
  return { sql: `UPDATE cards SET ${cols.join(', ')} WHERE id = ?${where}`, params };
}

/** The editor's save for existing cards: one transaction. Unknown ids are skipped. */
export async function patchCards(
  setId: number,
  changes: unknown,
): Promise<{ removed: number; updated: number }> {
  parse(idField, setId);
  const { remove, update } = parse(patchSchema, changes);
  const [found] = await db().select<{ n: number }>('SELECT COUNT(*) AS n FROM sets WHERE id = ?', [setId]);
  if (!found.n) throw notFound('set');

  const t = now();
  const statements: Stmt[] = [];
  for (let i = 0; i < remove.length; i += INSERT_CHUNK) {
    const ids = remove.slice(i, i + INSERT_CHUNK);
    statements.push({
      sql: `DELETE FROM cards WHERE set_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      params: [setId, ...ids],
    });
  }
  const removeCount = statements.length;
  for (const c of update) statements.push(cardUpdate(c, t, ' AND set_id = ?', [setId]));
  statements.push({ sql: 'UPDATE sets SET updated_at = ? WHERE id = ?', params: [t, setId] });

  const results = await db().batch(statements);
  const sum = (rs: typeof results) => rs.reduce((n, r) => n + r.rowsAffected, 0);
  return {
    removed: sum(results.slice(0, removeCount)),
    updated: sum(results.slice(removeCount, -1)),
  };
}

export async function updateCard(id: number, changes: unknown): Promise<CardDTO> {
  const c = parse(cardChangeSchema, { ...(changes as object), id });
  const [res] = await db().batch([cardUpdate(c, now(), '', [])]);
  if (res.rowsAffected === 0) throw notFound('card');
  const [row] = await db().select<CardRow>('SELECT id, term, definition, position FROM cards WHERE id = ?', [id]);
  return toCard(row);
}

export async function deleteCard(id: number): Promise<void> {
  const [res] = await db().batch([{ sql: 'DELETE FROM cards WHERE id = ?', params: [parse(idField, id)] }]);
  if (res.rowsAffected === 0) throw notFound('card');
}

// --- learning -------------------------------------------------------------------

/** "Learned" once a card has been answered right this many times in a row. */
export const LEARNED_REPETITIONS = 2;

export function learnStatus(progress: ProgressDTO | null): LearnStatus {
  if (!progress) return 'new';
  return progress.repetitionNumber >= LEARNED_REPETITIONS ? 'learned' : 'learning';
}

const STATUS_ORDER: Record<LearnStatus, number> = { new: 0, learning: 1, learned: 2 };

type CardWithProgress = CardRow & Partial<ProgressRow> & { has_progress: number };

const CARD_WITH_PROGRESS = `c.id, c.term, c.definition, c.position,
  p.card_id IS NOT NULL AS has_progress, p.card_id, p.repetition_number, p.ease_factor,
  p.interval_days, p.next_review_date, p.last_reviewed_at`;

function toLearnCard(row: CardWithProgress): LearnCardDTO {
  const progress = row.has_progress ? toProgress(row as ProgressRow) : null;
  return { ...toCard(row), status: learnStatus(progress), progress };
}

/**
 * Learn mode's queue for one set: new cards first, then the ones still being
 * learned (shortest streak first), then the learned ones; set order within
 * each group. No card is held back until a review date.
 */
export async function learnQueue(setId: number): Promise<LearnCardDTO[]> {
  await summary(parse(idField, setId));
  const rows = await db().select<CardWithProgress>(
    `SELECT ${CARD_WITH_PROGRESS} FROM cards c LEFT JOIN progress p ON p.card_id = c.id
     WHERE c.set_id = ? ORDER BY c.position, c.id`,
    [setId],
  );
  return rows
    .map(toLearnCard)
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.progress?.repetitionNumber ?? 0) - (b.progress?.repetitionNumber ?? 0),
    );
}

export async function learnStats(setId: number): Promise<LearnStatsDTO> {
  await summary(parse(idField, setId));
  const [row] = await db().select<LearnStatsDTO>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(p.card_id IS NULL), 0) AS new,
            COALESCE(SUM(p.repetition_number < ${LEARNED_REPETITIONS}), 0) AS learning,
            COALESCE(SUM(p.repetition_number >= ${LEARNED_REPETITIONS}), 0) AS learned
     FROM cards c LEFT JOIN progress p ON p.card_id = c.id WHERE c.set_id = ?`,
    [setId],
  );
  return {
    total: Number(row.total),
    new: Number(row.new),
    learning: Number(row.learning),
    learned: Number(row.learned),
  };
}

type ReviewOutcome = { progress: ProgressDTO | null; rescheduled: boolean };

function progressStatements(cardId: number, next: NonNullable<ReturnType<typeof applyReview>>, quality: Quality, today: string): Stmt[] {
  const reviewedAt = next.lastReviewedAt.toISOString();
  return [
    {
      sql: `INSERT INTO progress (card_id, repetition_number, ease_factor, interval_days, next_review_date, last_reviewed_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(card_id) DO UPDATE SET repetition_number = excluded.repetition_number,
              ease_factor = excluded.ease_factor, interval_days = excluded.interval_days,
              next_review_date = excluded.next_review_date, last_reviewed_at = excluded.last_reviewed_at`,
      params: [cardId, next.repetitionNumber, next.easeFactor, next.intervalDays, next.nextReviewDate, reviewedAt],
    },
    {
      sql: 'INSERT INTO reviews (card_id, quality, day, reviewed_at) VALUES (?, ?, ?, ?)',
      params: [cardId, quality, today, reviewedAt],
    },
  ];
}

async function storedProgress(cardIds: number[]): Promise<Map<number, ProgressDTO | null>> {
  const out = new Map<number, ProgressDTO | null>();
  if (cardIds.length === 0) return out;
  const rows = await db().select<{ id: number } & Partial<ProgressRow> & { has_progress: number }>(
    `SELECT c.id, p.card_id IS NOT NULL AS has_progress, p.card_id, p.repetition_number, p.ease_factor,
            p.interval_days, p.next_review_date, p.last_reviewed_at
     FROM cards c LEFT JOIN progress p ON p.card_id = c.id
     WHERE c.id IN (${cardIds.map(() => '?').join(', ')})`,
    cardIds,
  );
  for (const r of rows) out.set(r.id, r.has_progress ? toProgress(r as ProgressRow) : null);
  return out;
}

/**
 * One SM-2 step for one answer. `seen` is the streak the screen saw before
 * answering (null for a new card); if the stored one differs, the answer was
 * already counted and nothing changes.
 */
export async function reviewCard(
  cardId: number,
  quality: Quality,
  today: string,
  seen?: number | null,
): Promise<ReviewOutcome> {
  parse(idField, cardId);
  parse(qualityField, quality);
  parse(dayField, today);
  const stored = (await storedProgress([cardId])).get(cardId);
  if (stored === undefined) throw notFound('card');
  const next = applyReview(stored, quality, today, new Date(), seen);
  if (next === null) return { progress: stored, rescheduled: false };
  await db().batch(progressStatements(cardId, next, quality, today));
  return { progress: (await storedProgress([cardId])).get(cardId) ?? null, rescheduled: true };
}

const batchSchema = z
  .array(z.object({ cardId: idField, quality: qualityField }))
  .min(1)
  .max(500);

export async function reviewBatch(
  reviews: { cardId: number; quality: Quality }[],
  today: string,
): Promise<Record<number, ReviewOutcome>> {
  const list = parse(batchSchema, reviews);
  parse(dayField, today);
  const latest = new Map<number, Quality>();
  for (const r of list) latest.set(r.cardId, r.quality as Quality);
  const stored = await storedProgress([...latest.keys()]);
  const at = new Date();
  const statements: Stmt[] = [];
  const results: Record<number, ReviewOutcome> = {};
  for (const [cardId, quality] of latest) {
    if (!stored.has(cardId)) continue;
    const next = applyReview(stored.get(cardId) ?? null, quality, today, at);
    if (!next) continue;
    statements.push(...progressStatements(cardId, next, quality, today));
  }
  if (statements.length) await db().batch(statements);
  const after = await storedProgress([...latest.keys()]);
  for (const [cardId, p] of after) results[cardId] = { progress: p, rescheduled: true };
  return results;
}

// --- overlay and daily numbers ------------------------------------------------------

export type OverlayCard = LearnCardDTO & { setId: number; setTitle: string; due: boolean };

/**
 * The overlay's round: cards whose review date has come (oldest first), then
 * up to `newCards` never-studied ones, from sets that are in the overlay.
 */
export async function overlayRound(today: string, size: number, newCards: number): Promise<OverlayCard[]> {
  parse(dayField, today);
  const due = await db().select<CardWithProgress & { set_id: number; set_title: string }>(
    `SELECT ${CARD_WITH_PROGRESS}, s.id AS set_id, s.title AS set_title
     FROM progress p JOIN cards c ON c.id = p.card_id JOIN sets s ON s.id = c.set_id
     WHERE s.in_overlay = 1 AND p.next_review_date <= ?
     ORDER BY p.next_review_date, p.last_reviewed_at LIMIT ?`,
    [today, size],
  );
  const room = Math.min(newCards, size - due.length);
  const fresh =
    room > 0
      ? await db().select<CardWithProgress & { set_id: number; set_title: string }>(
          `SELECT ${CARD_WITH_PROGRESS}, s.id AS set_id, s.title AS set_title
           FROM cards c JOIN sets s ON s.id = c.set_id LEFT JOIN progress p ON p.card_id = c.id
           WHERE s.in_overlay = 1 AND p.card_id IS NULL
           ORDER BY s.created_at, c.position, c.id LIMIT ?`,
          [room],
        )
      : [];
  return [...due, ...fresh].map((r) => ({
    ...toLearnCard(r),
    setId: r.set_id,
    setTitle: r.set_title,
    due: Boolean(r.has_progress),
  }));
}

export type Today = {
  /** Cards whose review date has come, in overlay sets. */
  due: number;
  /** Never-studied cards in overlay sets. */
  fresh: number;
  /** Answers given today. */
  reviewed: number;
  /** Days in a row, ending today or yesterday, with at least one answer. */
  streak: number;
};

export async function todayNumbers(today: string): Promise<Today> {
  parse(dayField, today);
  const [row] = await db().select<{ due: number; fresh: number; reviewed: number }>(
    `SELECT
       (SELECT COUNT(*) FROM progress p JOIN cards c ON c.id = p.card_id JOIN sets s ON s.id = c.set_id
          WHERE s.in_overlay = 1 AND p.next_review_date <= ?) AS due,
       (SELECT COUNT(*) FROM cards c JOIN sets s ON s.id = c.set_id LEFT JOIN progress p ON p.card_id = c.id
          WHERE s.in_overlay = 1 AND p.card_id IS NULL) AS fresh,
       (SELECT COUNT(*) FROM reviews WHERE day = ?) AS reviewed`,
    [today, today],
  );
  const days = await db().select<{ day: string }>(
    'SELECT DISTINCT day FROM reviews WHERE day <= ? ORDER BY day DESC LIMIT 400',
    [today],
  );
  return {
    due: Number(row.due),
    fresh: Number(row.fresh),
    reviewed: Number(row.reviewed),
    streak: streakFrom(days.map((d) => d.day), today),
  };
}

/** Consecutive days ending today (or yesterday, if today has none yet). */
export function streakFrom(daysDesc: string[], today: string): number {
  const step = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 10);
  };
  let expect = daysDesc[0] === today ? today : step(today);
  let n = 0;
  for (const d of daysDesc) {
    if (d === today && expect !== today) continue;
    if (d !== expect) break;
    n++;
    expect = step(expect);
  }
  return n;
}

// --- quick add (overlay) ------------------------------------------------------------

export async function lastUsedSetId(): Promise<number | null> {
  const [row] = await db().select<{ id: number }>('SELECT id FROM sets ORDER BY updated_at DESC, id DESC LIMIT 1');
  return row?.id ?? null;
}

export { invalid };
