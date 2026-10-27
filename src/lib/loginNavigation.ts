type LoginOrigin = { pathname: string; search: string; hash: string };

export const loginHref = ({ pathname, search, hash }: LoginOrigin) =>
  `/login?${new URLSearchParams({ returnTo: `${pathname}${search}${hash}` })}`;

export const loginReturnTo = (search: string): string => {
  const value = new URLSearchParams(search).get('returnTo');
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/u.test(value)) return '/account';
  try {
    const target = new URL(value, 'https://return.invalid');
    if (target.origin !== 'https://return.invalid' || target.pathname.replace(/\/+$/u, '') === '/login') return '/account';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/account';
  }
};
