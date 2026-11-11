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
