import type { APIRoute } from 'astro';

import {
  getAuthEnv,
  getGoogleCallbackUrl,
  OAUTH_RETURN_TO_KEY,
  OAUTH_STATE_KEY,
  OAUTH_VERIFIER_KEY,
  safeReturnTo,
  USER_SESSION_KEY,
  USER_SESSION_TTL,
  type PortalUser
} from '../../../../lib/auth';

export const prerender = false;

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleUserInfo {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
  email_verified?: boolean;
}

function redirectToLogin(context: Parameters<NonNullable<APIRoute>>[0], error: string) {
  return context.redirect(`/login?error=${error}`, 303);
}

function clearOAuthState(context: Parameters<NonNullable<APIRoute>>[0]) {
  context.session?.delete(OAUTH_STATE_KEY);
  context.session?.delete(OAUTH_VERIFIER_KEY);
  context.session?.delete(OAUTH_RETURN_TO_KEY);
}

export const GET: APIRoute = async (context) => {
  const oauthError = context.url.searchParams.get('error');
  if (oauthError) {
    clearOAuthState(context);
    return redirectToLogin(context, oauthError === 'access_denied' ? 'denied' : 'oauth');
  }

  const code = context.url.searchParams.get('code');
  const returnedState = context.url.searchParams.get('state');
  const session = context.session;
  const storedState = await session?.get<string>(OAUTH_STATE_KEY);
  const verifier = await session?.get<string>(OAUTH_VERIFIER_KEY);
  const returnTo = safeReturnTo(await session?.get<string>(OAUTH_RETURN_TO_KEY));

  if (!session || !code || !returnedState || !storedState || returnedState !== storedState || !verifier) {
    clearOAuthState(context);
    return redirectToLogin(context, 'state');
  }

  clearOAuthState(context);

  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = getAuthEnv();
  if (!clientId || !clientSecret) {
    return redirectToLogin(context, 'config');
  }

  let tokenData: GoogleTokenResponse;
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: getGoogleCallbackUrl(context.request)
      })
    });

    tokenData = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!tokenResponse.ok || !tokenData.access_token) {
      return redirectToLogin(context, 'oauth');
    }
  } catch {
    return redirectToLogin(context, 'network');
  }

  let profile: GoogleUserInfo;
  try {
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${tokenData.access_token}`
      }
    });

    profile = (await profileResponse.json()) as GoogleUserInfo;
    if (!profileResponse.ok || !profile.sub || !profile.email || profile.email_verified !== true) {
      return redirectToLogin(context, 'profile');
    }
  } catch {
    return redirectToLogin(context, 'network');
  }

  const user: PortalUser = {
    id: profile.sub,
    name: profile.name?.trim() || profile.email.split('@')[0],
    email: profile.email,
    ...(profile.picture ? { image: profile.picture } : {})
  };

  // Rotate the server-side session ID after OAuth validation to prevent session fixation.
  await session.regenerate();
  session.set(USER_SESSION_KEY, user, { ttl: USER_SESSION_TTL });

  return context.redirect(returnTo, 303);
};
