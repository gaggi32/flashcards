// The balance on the user's OpenRouter key, read through the Rust proxy (the
// key itself never reaches this side). Every field is optional on purpose:
// OpenRouter's response shape is theirs to change, and a missing number should
// blank one row of the panel rather than break it.

import { aiRequest } from '@/lib/app/native';
import type { AccountStatus } from './types';

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function get(endpoint: 'key' | 'credits'): Promise<Record<string, unknown>> {
  try {
    const res = await aiRequest(endpoint);
    if (res.status < 200 || res.status >= 300) return {};
    const json = JSON.parse(res.body) as { data?: Record<string, unknown> };
    return json?.data && typeof json.data === 'object' ? json.data : {};
  } catch {
    return {};
  }
}

export async function fetchAccountStatus(): Promise<AccountStatus | null> {
  const [credits, keyInfo] = await Promise.all([get('credits'), get('key')]);
  if (Object.keys(credits).length === 0 && Object.keys(keyInfo).length === 0) return null;

  const totalCredits = num(credits.total_credits);
  const totalUsage = num(credits.total_usage) ?? num(keyInfo.usage);
  const limit = num(keyInfo.limit);
  const keyUsage = num(keyInfo.usage);

  return {
    totalCredits,
    totalUsage,
    remaining:
      totalCredits !== null && totalUsage !== null
        ? Math.round((totalCredits - totalUsage) * 1e6) / 1e6
        : null,
    limit,
    limitRemaining: limit !== null && keyUsage !== null ? Math.round((limit - keyUsage) * 1e6) / 1e6 : null,
    label: typeof keyInfo.label === 'string' ? keyInfo.label : null,
    isFreeTier: typeof keyInfo.is_free_tier === 'boolean' ? keyInfo.is_free_tier : null,
  };
}
