// Export and import: the whole collection as one JSON file.
//
// An import always adds: each set arrives as a new set, so importing twice
// gives two copies rather than overwriting anything.

import { z } from 'zod';

import { LIMITS } from '@/lib/flashcards/types';
import { db, type Stmt } from './db';
import { invalid } from './errors';
import { isDayKey } from './validate';

export const FORMAT = 'flashcards';
/** The format name in exports made before 0.1.7; still read. */
const OLD_FORMAT = '404canvas-flashcards';
export const FORMAT_VERSION = 1;

const progressSchema = z.object({
  repetitionNumber: z.number().int().min(0).max(10_000),
  easeFactor: z.number().min(1.3).max(10),
  intervalDays: z.number().int().min(0).max(100_000),
  nextReviewDate: z.string().refine(isDayKey, 'nextReviewDate must be YYYY-MM-DD'),
  lastReviewedAt: z.string().datetime({ offset: true }).nullable(),
});

const cardSchema = z.object({
  term: z.string().trim().min(1).max(LIMITS.sideLength),
  definition: z.string().trim().min(1).max(LIMITS.sideLength),
  position: z.number().int().min(0).max(1_000_000).optional(),
  progress: progressSchema.nullable().optional(),
});

const setSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.titleLength),
  description: z.string().trim().max(LIMITS.descriptionLength).nullable().optional(),
  folder: z.string().trim().max(LIMITS.folderNameLength).nullable().optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  inOverlay: z.boolean().optional(),
  cards: z.array(cardSchema).max(LIMITS.cardsPerSet),
});

export const exportSchema = z.object({
  format: z.union([z.literal(FORMAT), z.literal(OLD_FORMAT)]),
  version: z.literal(FORMAT_VERSION),
  exportedAt: z.string().optional(),
  sets: z.array(setSchema).max(LIMITS.setsPerUser),
});

export type ExportFile = z.infer<typeof exportSchema>;

export async function exportAll(): Promise<ExportFile> {
  const sets = await db().select<{
    id: number;
    title: string;
    description: string | null;
    folder: string | null;
    created_at: string;
    in_overlay: number;
  }>('SELECT id, title, description, folder, created_at, in_overlay FROM sets ORDER BY created_at, id');
  const cards = await db().select<{
    set_id: number;
    term: string;
    definition: string;
    position: number;
    has_progress: number;
    repetition_number: number | null;
    ease_factor: number | null;
    interval_days: number | null;
    next_review_date: string | null;
    last_reviewed_at: string | null;
  }>(
    `SELECT c.set_id, c.term, c.definition, c.position, p.card_id IS NOT NULL AS has_progress,
            p.repetition_number, p.ease_factor, p.interval_days, p.next_review_date, p.last_reviewed_at
     FROM cards c LEFT JOIN progress p ON p.card_id = c.id ORDER BY c.set_id, c.position, c.id`,
  );
  const bySet = new Map<number, ExportFile['sets'][number]['cards']>();
  for (const c of cards) {
    const list = bySet.get(c.set_id) ?? [];
    list.push({
      term: c.term,
      definition: c.definition,
      position: c.position,
      progress: c.has_progress
        ? {
            repetitionNumber: c.repetition_number!,
            easeFactor: c.ease_factor!,
            intervalDays: c.interval_days!,
            nextReviewDate: c.next_review_date!,
            lastReviewedAt: c.last_reviewed_at,
          }
        : null,
    });
    bySet.set(c.set_id, list);
  }
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    sets: sets.map((s) => ({
      title: s.title,
      description: s.description,
      folder: s.folder,
      createdAt: s.created_at,
      inOverlay: Boolean(s.in_overlay),
      cards: bySet.get(s.id) ?? [],
    })),
  };
}

/** Text → validated export, or a 400 that says what is wrong. */
export function parseExport(text: string): ExportFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalid('That file is not JSON.');
  }
  const format = json && typeof json === 'object' ? (json as { format?: unknown }).format : undefined;
  if (format !== FORMAT && format !== OLD_FORMAT) {
    throw invalid('That is not a Flashcards export.');
  }
  const parsed = exportSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw invalid(`That export has a problem at ${issue.path.join('.') || 'the top'}: ${issue.message}`);
  }
  return parsed.data;
}

export type ImportResult = { sets: number; cards: number; withProgress: number };

/** Add every set in the file. Each set lands whole or not at all. */
export async function importAll(file: ExportFile): Promise<ImportResult> {
  const [{ sets: haveSets, cards: haveCards }] = await db().select<{ sets: number; cards: number }>(
    'SELECT (SELECT COUNT(*) FROM sets) AS sets, (SELECT COUNT(*) FROM cards) AS cards',
  );
  const incomingCards = file.sets.reduce((n, s) => n + s.cards.length, 0);
  if (haveSets + file.sets.length > LIMITS.setsPerUser) {
    throw invalid(`That would make more than ${LIMITS.setsPerUser} sets.`);
  }
  if (haveCards + incomingCards > LIMITS.cardsPerUser) {
    throw invalid(`That would make more than ${LIMITS.cardsPerUser.toLocaleString('en')} cards.`);
  }

  const result: ImportResult = { sets: 0, cards: 0, withProgress: 0 };
  const t = new Date().toISOString();
  for (const set of file.sets) {
    // Positions are renumbered 0..n-1 in the file's order, so each card's
    // progress can find its row by (set, position) inside the same batch.
    const cards = [...set.cards]
      .map((c, i) => ({ ...c, order: c.position ?? i, i }))
      .sort((a, b) => a.order - b.order || a.i - b.i);

    const statements: Stmt[] = [
      {
        sql: `INSERT INTO sets (folder, title, description, in_overlay, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        params: [
          set.folder || null,
          set.title,
          set.description || null,
          set.inOverlay === false ? 0 : 1,
          set.createdAt ?? t,
          t,
        ],
      },
    ];
    for (let i = 0; i < cards.length; i += 500) {
      const chunk = cards.slice(i, i + 500);
      statements.push({
        sql: `INSERT INTO cards (set_id, term, definition, position, created_at, updated_at) VALUES ${chunk
          .map(() => '(?, ?, ?, ?, ?, ?)')
          .join(', ')}`,
        params: chunk.flatMap((c, j) => [{ $lastId: 0 }, c.term, c.definition, i + j, t, t]),
      });
    }
    cards.forEach((c, position) => {
      if (!c.progress) return;
      const p = c.progress;
      statements.push({
        sql: `INSERT INTO progress (card_id, repetition_number, ease_factor, interval_days, next_review_date, last_reviewed_at)
              SELECT id, ?, ?, ?, ?, ? FROM cards WHERE set_id = ? AND position = ?`,
        params: [
          p.repetitionNumber,
          p.easeFactor,
          p.intervalDays,
          p.nextReviewDate,
          p.lastReviewedAt,
          { $lastId: 0 },
          position,
        ],
      });
      result.withProgress++;
    });
    await db().batch(statements);
    result.sets++;
    result.cards += cards.length;
  }
  return result;
}
