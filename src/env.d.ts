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
      GOOGLE_SHEET_ID?: string;
      GOOGLE_SHEET_TAB?: string;
      GCP_SERVICE_ACCOUNT_EMAIL?: string;
      GCP_PRIVATE_KEY?: string;
    }
  }
}

export {};
