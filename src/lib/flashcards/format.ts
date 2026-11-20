export function formatCreated(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** A smaller type size for long prompts, so they fit their box (same steps as the flip cards). */
export function promptSizeClass(text: string): string {
  if (text.length > 280) return ' fc-prompt__text--xs';
  if (text.length > 90) return ' fc-prompt__text--sm';
  return '';
}

/**
 * When a set was last studied, in words: "today", "yesterday", "3 days ago",
 * "2 weeks ago", then the date. Days are counted by the calendar, in local
 * time, not in 24-hour steps.
 */
export function studiedAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  const days = Math.max(0, Math.round(day(now) - day(then)));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
