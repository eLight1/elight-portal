import type { APIRoute } from 'astro';

import {
  createCodeChallenge,
  createRandomString,
  getGoogleCallbackUrl,
  getAuthEnv,
  OAUTH_RETURN_TO_KEY,
  OAUTH_STATE_KEY,
  OAUTH_STATE_TTL,
  OAUTH_VERIFIER_KEY,
  safeReturnTo
} from '../../../lib/auth';

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const { GOOGLE_CLIENT_ID: clientId } = getAuthEnv();

  if (!clientId) {
    return context.redirect('/login?error=config', 303);
  }

  const state = createRandomString(32);
  const verifier = createRandomString(48);
  const challenge = await createCodeChallenge(verifier);
  const returnTo = safeReturnTo(context.url.searchParams.get('next'));
  const callbackUrl = getGoogleCallbackUrl(context.request);

  context.session?.set(OAUTH_STATE_KEY, state, { ttl: OAUTH_STATE_TTL });
  context.session?.set(OAUTH_VERIFIER_KEY, verifier, { ttl: OAUTH_STATE_TTL });
  context.session?.set(OAUTH_RETURN_TO_KEY, returnTo, { ttl: OAUTH_STATE_TTL });

  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  }).toString();

  return context.redirect(authorizationUrl.toString(), 302);
};
