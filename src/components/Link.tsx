// A link with an `href` that routes inside the app's hash router.
//
// The move runs as a React transition tagged with its direction, so the
// screens' <ViewTransition>s (App.tsx) can slide the new screen in from the
// side it lies on: deeper into a set comes from the right, back out from the
// left. A modified click (new window and the like) is left alone.

import { addTransitionType, startTransition, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';

import { primeFor } from '@/lib/app/prime';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  children?: ReactNode;
  prefetch?: boolean;
};

/** How deep a route sits: /flashcards < /flashcards/3 < /flashcards/3/cards. Settings sits beside the sets. */
function depth(path: string): number {
  const p = path.split(/[?#]/)[0];
  return p.split('/').filter(Boolean).length;
}

export function navDirection(from: string, to: string): 'nav-forward' | 'nav-back' {
  return depth(to) > depth(from) ? 'nav-forward' : 'nav-back';
}

export default function Link({ href, prefetch: _prefetch, onClick, ...rest }: Props) {
  const navigate = useNavigate();
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== '_self') return;
    e.preventDefault();
    const type = navDirection(window.location.hash.slice(1) || '/', href);
    // The next screen's data first (a few ms), so it slides in whole.
    void primeFor(href).then(() =>
      startTransition(() => {
        addTransitionType(type);
        navigate(href);
      }),
    );
  };
  return <RouterLink to={href} onClick={go} {...rest} />;
}
