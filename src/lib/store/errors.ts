/**
 * The error every data call throws. It keeps the web app's shape (a message
 * and an HTTP-like status) so the screens that were ported from it read
 * `err.status === 404` and `errorMessage(err, …)` unchanged.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Extra detail — a failed generation still carries its cost. */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export const notFound = (what: 'set' | 'card') => new ApiError(`No such ${what}`, 404);
export const invalid = (message: string) => new ApiError(message, 400);
export const conflict = (message: string) => new ApiError(message, 409);

/** Anything thrown by invoke() is a plain string; give it the same shape. */
export function asApiError(err: unknown, fallback = 'Something went wrong.'): ApiError {
  if (err instanceof ApiError) return err;
  if (typeof err === 'string') return new ApiError(err, 500);
  if (err instanceof Error) return new ApiError(err.message || fallback, 500);
  return new ApiError(fallback, 500);
}
