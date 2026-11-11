// A link with an `href` that routes inside the app's hash router.

import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  children?: ReactNode;
  prefetch?: boolean;
};

export default function Link({ href, prefetch: _prefetch, ...rest }: Props) {
  return <RouterLink to={href} {...rest} />;
}
