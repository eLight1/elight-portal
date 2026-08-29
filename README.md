# E Light Services client portal

A server-rendered Astro portal for E Light Services, styled with Tailwind CSS and deployed to Cloudflare Workers.

## Commands

| Command | Action |
| --- | --- |
| `npm run dev` | Start the local Astro development server |
| `npm run build` | Build the Cloudflare Worker and static assets |
| `npm run preview` | Preview the built Worker locally |
| `npm run generate-types` | Regenerate Wrangler environment types |

## Google sign-in setup

The portal uses a small, server-side Google OAuth flow with PKCE. Google access tokens are used only to verify the profile and are not stored. The authenticated user profile is stored in an Astro server session backed by Cloudflare Workers KV.

### 1. Create a Google OAuth client

In Google Cloud Console, create an OAuth client with application type **Web application**. Add these authorized redirect URIs:

```text
http://localhost:4321/api/auth/google/callback
https://<your-worker-domain>/api/auth/google/callback
```

Use the exact deployed origin in `AUTH_ORIGIN` when the Worker is behind a custom domain or proxy.

### 2. Configure local development

Copy the example file and add the credentials from Google Cloud Console:

```sh
cp .dev.vars.example .dev.vars
```

`.dev.vars` is ignored by Git. It should contain:

```text
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
AUTH_ORIGIN="http://localhost:4321"
```

Then run:

```sh
npm run dev
```

Open [http://localhost:4321/login](http://localhost:4321/login) and choose **Sign in with Google**.

### 3. Configure production secrets

Set the values as Worker secrets rather than committing them to `wrangler.jsonc`:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put AUTH_ORIGIN
```

`AUTH_ORIGIN` should be the public origin, for example `https://portal.example.com`. If it is omitted, the callback URL is derived from the incoming request origin.

Deploy with:

```sh
npm run build
npx wrangler deploy
```

The Cloudflare adapter provisions the default `SESSION` Workers KV binding for Astro sessions. If your Cloudflare project requires an explicit binding, add the namespace ID to `wrangler.jsonc` using the `SESSION` binding name.

## Google Sheets service tickets

The protected `/dashboard` route loads active tickets on the server after the session guard has confirmed the signed-in user. The browser never receives Google credentials, service-account keys, or an unfiltered spreadsheet response. Rows are filtered by the authenticated user's email before ticket data is passed to the dashboard component. Authentication uses the `googleapis` library's `google.auth.JWT` client with the service-account values read from server-side environment variables.

### 1. Prepare the spreadsheet

Create or use a Google Sheet, add a tab named `Service_Tickets`, and share the spreadsheet with the service-account email as a **Viewer**. The first row must contain these columns:

- `Ticket_ID`
- `Service_Name`
- `Status_Step` — `1`, `2`, or `3`
- One email column: `Client_Email`, `Customer_Email`, `Contact_Email`, `User_Email`, or `Email`

Optional columns include `Status`, `Description`, and `Updated_At`. Rows with a status of `closed`, `cancelled`, `complete`, or `resolved` are excluded. The dashboard uses the first active row for the authenticated email and maps `Status_Step` to the progress bar and timeline.

### 2. Configure the Sheets service account

Enable the Google Sheets API in the same Google Cloud project as the service account. Add these values to `.dev.vars` for local development:

```text
GOOGLE_SHEET_ID="your-spreadsheet-id"
GOOGLE_SHEET_TAB="Service_Tickets"
GCP_SERVICE_ACCOUNT_EMAIL="sheets-reader@your-project.iam.gserviceaccount.com"
GCP_PRIVATE_KEY="your-full-service-account-private-key"
```

The private key is a server-only secret. Keep the complete PEM value in `.dev.vars` locally and in Cloudflare's encrypted Environment Variables in production; do not place it in `src/`, browser code, `public/`, or `wrangler.jsonc`. The server reads `process.env.GCP_PRIVATE_KEY` and accepts the escaped-newline format used by Cloudflare environment variables.

For production, add the same values as Worker secrets:

```sh
npx wrangler secret put GOOGLE_SHEET_ID
npx wrangler secret put GOOGLE_SHEET_TAB
npx wrangler secret put GCP_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GCP_PRIVATE_KEY
```

`GOOGLE_SHEET_TAB` defaults to `Service_Tickets` when omitted. If the account is not configured or the Sheets request fails, the dashboard safely renders the no-active-ticket Welcome state and logs only a generic server-side error.

## Connect GitHub to Cloudflare

This repository is an Astro SSR application: Google OAuth, protected `/dashboard`, sessions, and Google Sheets reads all execute on the server. The current `@astrojs/cloudflare` adapter targets Cloudflare Workers; current Astro releases no longer support deploying this SSR adapter as a Cloudflare Pages project. In Cloudflare's combined **Workers & Pages** dashboard, choose **Workers** / **Workers Builds** for this repository rather than the Pages-only option.

### Recommended GitHub deployment with Workers Builds

1. Push this branch or merge the pull request into the production branch on GitHub.
2. In the Cloudflare dashboard, open **Workers & Pages → Create application → Import a repository**.
3. Connect GitHub, authorize access to `eLight1/elight-portal`, and select the production branch.
4. Use these build settings:

   ```text
   Root directory: /
   Build command: npm run build
   Deploy command: npx wrangler deploy
   ```

5. Add the following in the Worker's **Settings → Variables and Secrets**. Mark credentials and private keys as encrypted secrets:

   ```text
   GOOGLE_CLIENT_ID
   GOOGLE_CLIENT_SECRET
   AUTH_ORIGIN
   GOOGLE_SHEET_ID
   GOOGLE_SHEET_TAB=Service_Tickets
   GCP_SERVICE_ACCOUNT_EMAIL
   GCP_PRIVATE_KEY
   ```

   `GCP_PRIVATE_KEY` is read server-side through `process.env.GCP_PRIVATE_KEY`; never add it to GitHub, `public/`, or client-side code. Keep the `\\n` sequences intact if Cloudflare stores the PEM as a single-line value. The `nodejs_compat` flag is already enabled in `wrangler.jsonc` for `process.env` and `googleapis`.

6. Save and deploy. After Cloudflare gives the Worker its public URL, set `AUTH_ORIGIN` to that exact origin and add this Google OAuth redirect URI in Google Cloud Console:

   ```text
   https://<your-worker-domain>/api/auth/google/callback
   ```

7. Share the Google Sheet with `GCP_SERVICE_ACCOUNT_EMAIL` as a Viewer. Confirm the `Service_Tickets` tab contains the required headers documented above.

For this SSR app, the Cloudflare dashboard's direct Pages Git integration is not the supported target. A Pages project is suitable for a separate static site, but it will not preserve this protected dashboard and server-side Google Sheets integration with the current Astro adapter.

## Authentication routes

- `/login` — public Google sign-in page
- `/api/auth/google` — creates a state and PKCE challenge, then redirects to Google
- `/api/auth/google/callback` — validates state, exchanges the code, verifies the Google profile, and creates the server session
- `/api/auth/logout` — destroys the current session
- `/dashboard` — protected route; unauthenticated requests redirect to `/login`
- `/dashboard-preview` — public sample dashboard using fixture data; no live client data is exposed

The route guard is implemented in `src/middleware.ts`, with a second session check in `src/pages/dashboard.astro` as defense in depth.
