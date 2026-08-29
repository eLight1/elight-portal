import type { PortalUser } from './lib/auth';

declare global {
  namespace App {
    interface SessionData {
      user: PortalUser;
      oauthState: string;
      oauthCodeVerifier: string;
      oauthReturnTo: string;
    }
  }

  namespace Cloudflare {
    interface Env {
      GOOGLE_CLIENT_ID?: string;
      GOOGLE_CLIENT_SECRET?: string;
      AUTH_ORIGIN?: string;
    }
  }
}

export {};
