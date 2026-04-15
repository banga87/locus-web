'use server';

import { cookies } from 'next/headers';

const COOKIE = 'locus-theme';
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setThemeCookie(theme: 'light' | 'dark'): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, theme, {
    path: '/',
    maxAge: ONE_YEAR,
    sameSite: 'lax',
    httpOnly: false,
  });
}
