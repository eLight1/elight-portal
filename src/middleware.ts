import { defineMiddleware } from 'astro:middleware';

import { USER_SESSION_KEY } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname === '/dashboard' || context.url.pathname.startsWith('/dashboard/')) {
    const user = await context.session?.get(USER_SESSION_KEY);

    if (!user) {
      const nextPath = `${context.url.pathname}${context.url.search}`;
      return context.redirect(`/login?next=${encodeURIComponent(nextPath)}`, 303);
    }
  }

  return next();
});
