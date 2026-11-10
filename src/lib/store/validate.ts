// Input checks for every write, moved over from the web app's route handlers
// (lib/flashcards/http.ts there). Same limits, same messages.

import { z } from 'zod';

import { LIMITS } from '@/lib/flashcards/types';
import { DAY_RE, dayKeyFromDate } from '@/lib/nutrition/day';
import { invalid } from './errors';

export const titleField = z.string().trim().min(1, 'Title is required').max(LIMITS.titleLength);

/** Empty and null both mean "no description". */
export const descriptionField = z
  .string()
  .trim()
  .max(LIMITS.descriptionLength)
  .nullable()
  .transform((v) => (v ? v : null));

export const sideField = z.string().trim().min(1).max(LIMITS.sideLength);

export const positionField = z.number().int().min(0).max(1_000_000);

/** Empty and null both mean "no folder". */
export const folderField = z
  .string()
  .trim()
  .max(LIMITS.folderNameLength)
  .nullable()
  .transform((v) => (v ? v : null));

export const idField = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** A real calendar day as YYYY-MM-DD — "2026-02-31" matches the pattern, but is not one. */
export function isDayKey(value: string): boolean {
  return DAY_RE.test(value) && dayKeyFromDate(new Date(`${value}T00:00:00.000Z`)) === value;
}

export const dayField = z.string().refine(isDayKey, 'today must be a date in YYYY-MM-DD form');

export const qualityField = z.number().int().min(0).max(5);

/** Parse or throw a 400 naming the first problem, as the routes did. */
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  throw invalid(issue ? `${where}${issue.message}` : 'Invalid input');
}
