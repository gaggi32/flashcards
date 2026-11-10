import { formatUsd } from '@/lib/openrouter/format';
import type { AiUsage, KeySource } from '@/lib/openrouter/types';

/**
 * Which model answered, what that answer cost, and whose credit paid for it.
 *
 * Every number comes back from OpenRouter with the answer; nothing is priced
 * here, so swapping OPENROUTER_FLASHCARDS_MODEL changes this line by itself.
 */
export function AiReceipt({
  model,
  usage,
  billedTo,
}: {
  model: string | null;
  usage: AiUsage | null;
  billedTo: KeySource | null;
}) {
  const parts: string[] = [];
  if (model) parts.push(model);

  if (usage?.isByok) {
    // Ran on the user's own upstream provider key — OpenRouter charged
    // nothing, and "$0" would read as free rather than billed elsewhere.
    parts.push('billed on your own provider key');
  } else if (usage?.costUsd !== null && usage?.costUsd !== undefined) {
    parts.push(formatUsd(usage.costUsd));
  } else {
    parts.push('cost not reported');
  }

  if (usage?.promptTokens !== null && usage?.promptTokens !== undefined) {
    const out = usage.completionTokens;
    parts.push(
      out !== null && out !== undefined
        ? `${usage.promptTokens.toLocaleString('en')} in / ${out.toLocaleString('en')} out`
        : `${usage.promptTokens.toLocaleString('en')} tokens in`,
    );
  }

  if (billedTo === 'user') parts.push('your key');
  else if (billedTo === 'server') parts.push('site key');

  return <div className="fc-receipt">{parts.join(' · ')}</div>;
}
