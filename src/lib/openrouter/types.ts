// OpenRouter shapes shared by every feature that spends a user's key — the
// food log's photo estimates and the flashcards generator. Types only, so the
// client bundle can import them freely.

export type KeySource = 'user' | 'server' | 'none';

/** OpenRouter balance, as far as their API will tell us. Every field optional. */
export type AccountStatus = {
  remaining: number | null;
  totalCredits: number | null;
  totalUsage: number | null;
  limit: number | null;
  limitRemaining: number | null;
  label: string | null;
  isFreeTier: boolean | null;
};

export type AiKeyStatus = {
  source: KeySource;
  /** Last four characters, and only for a key the user supplied themselves. */
  hint: string | null;
  account: AccountStatus | null;
};

/**
 * What one model call cost, straight from OpenRouter's own accounting.
 *
 * Reported rather than calculated: prices move, models get swapped through
 * env vars, and a rate table living in this repo would quietly start lying.
 * Every field is nullable because the provider may omit any of them, and a
 * missing number should hide a line, not break the screen.
 */
export type AiUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  /** Credits OpenRouter charged for this call. 1 credit = 1 USD. */
  costUsd: number | null;
  /** True when it ran on the user's own upstream provider key, so cost is 0. */
  isByok: boolean | null;
};
