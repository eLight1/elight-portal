import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  context.session?.destroy();
  return context.redirect('/login?logged_out=1', 303);
};
