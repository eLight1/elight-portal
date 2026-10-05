import { env } from 'cloudflare:workers';

export const USER_SESSION_KEY = 'user' as const;
export const OAUTH_STATE_KEY = 'oauthState' as const;
export const OAUTH_VERIFIER_KEY = 'oauthCodeVerifier' as const;
export const OAUTH_RETURN_TO_KEY = 'oauthReturnTo' as const;

export const OAUTH_STATE_TTL = 10 * 60;
export const USER_SESSION_TTL = 60 * 60 * 24 * 30;

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  image?: string;
}

export interface AuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_ORIGIN?: string;
}

/**
 * Cloudflare exposes bindings and secrets through this request-scoped module.
 * Keeping this access here prevents OAuth secrets from being bundled into the client.
 */
export function getAuthEnv(): AuthEnv {
  return env as unknown as AuthEnv;
}

export function getGoogleCallbackUrl(request: Request): string {
  const configuredOrigin = getAuthEnv().AUTH_ORIGIN?.trim().replace(/\/+$/, '');
  const origin = configuredOrigin || new URL(request.url).origin;
  return new URL('/api/auth/google/callback', origin).toString();
}

export function createRandomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}
