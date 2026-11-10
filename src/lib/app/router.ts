// next/navigation's useRouter, as far as the ported screens use it.

import { useNavigate } from 'react-router';

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (to: string) => navigate(to),
    replace: (to: string) => navigate(to, { replace: true }),
    back: () => navigate(-1),
  };
}
