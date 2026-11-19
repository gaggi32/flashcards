// A burst of paper confetti for the few moments that earn one: a set known
// or mastered all the way through, a test with every answer right. Small
// squares and strips in the theme's own inks shoot up from the middle of the
// panel and fall away. Nothing in calm or no motion, nor in eye comfort,
// which keeps the screen still.

import { useMemo, type CSSProperties } from 'react';

import { motionLevel } from '@/lib/app/theme';

/** Repeatable "random" numbers, so a re-render does not reshuffle the pieces. */
function rnd(k: number): number {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const INKS = ['var(--fc-accent)', 'var(--rt-teal)', 'var(--rt-gold)', 'var(--rt-rust)', 'var(--card-red)'];

export function Confetti({ size = 'big', seed = 1 }: { size?: 'big' | 'small'; seed?: number }) {
  const pieces = useMemo(() => {
    const count = size === 'big' ? 80 : 30;
    const spread = size === 'big' ? 760 : 500;
    const rise = size === 'big' ? 300 : 200;
    return Array.from({ length: count }, (_, k) => {
      const a = rnd(seed * 101 + k * 7.1);
      const b = rnd(seed * 101 + k * 3.7);
      const c = rnd(seed * 101 + k * 5.3);
      const d = rnd(seed * 101 + k * 9.9);
      const strip = c > 0.55;
      return {
        width: strip ? 4 : 7,
        height: strip ? 12 : 7,
        background: INKS[Math.floor(d * INKS.length)],
        '--dx': `${Math.round((a - 0.5) * spread)}px`,
        '--dy': `${Math.round(-80 - b * rise)}px`,
        '--r': `${Math.round((c - 0.5) * 1440)}deg`,
        animationDelay: `${Math.round(d * 140)}ms`,
        animationDuration: `${Math.round(1500 + b * 700)}ms`,
      } as CSSProperties;
    });
  }, [size, seed]);

  if (motionLevel() !== 'full' || document.documentElement.getAttribute('data-eye') === 'on') return null;
  return (
    <span className="fx-confetti fx-big" aria-hidden="true">
      {pieces.map((style, i) => (
        <span key={i} className="fx-confetti__bit" style={style} />
      ))}
    </span>
  );
}
