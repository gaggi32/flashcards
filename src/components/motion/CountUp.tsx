// A number that counts to its value instead of jumping there: from the last
// value shown, or on first appearance from `from` (a result screen counts up
// from 0). Shows the value at once when motion is off.

import { useEffect, useRef, useState } from 'react';

import { motionLevel } from '@/lib/app/theme';

export function CountUp({ value, from, ms = 700, delay = 0 }: { value: number; from?: number; ms?: number; delay?: number }) {
  const [shown, setShown] = useState(from ?? value);
  const last = useRef(from ?? value);
  useEffect(() => {
    const start = last.current;
    if (start === value || motionLevel() === 'off') {
      last.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now() + delay;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - t0) / ms));
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else last.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = value;
    };
  }, [value, ms, delay]);
  return <>{shown}</>;
}
