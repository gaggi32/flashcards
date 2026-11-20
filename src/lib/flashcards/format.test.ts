import { describe, expect, it } from 'vitest';

import { studiedAgo } from './format';

describe('studiedAgo', () => {
  const now = new Date(2026, 10, 20, 9, 0);
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

  it('counts calendar days, not 24-hour steps', () => {
    expect(studiedAgo(at(2026, 10, 20, 1), now)).toBe('today');
    expect(studiedAgo(at(2026, 10, 19, 23), now)).toBe('yesterday');
    expect(studiedAgo(at(2026, 10, 17), now)).toBe('3 days ago');
  });

  it('turns to weeks, then to the date', () => {
    expect(studiedAgo(at(2026, 10, 6), now)).toBe('2 weeks ago');
    expect(studiedAgo(at(2026, 7, 1), now)).not.toMatch(/ago|today|yesterday/);
  });

  it('never says a time in the future', () => {
    expect(studiedAgo(at(2026, 10, 22), now)).toBe('today');
  });
});
