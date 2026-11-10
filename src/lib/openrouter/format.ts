/**
 * Money, at the scale these features actually spend it. A single photo lands
 * around a twentieth of a cent, so the usual two decimals would render every
 * call as "$0.00" — the digits are chosen to keep a real number visible
 * however small, while a balance of a few dollars still reads normally.
 */
export function formatUsd(value: number): string {
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
