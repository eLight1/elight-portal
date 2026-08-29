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

## Authentication routes

- `/login` — public Google sign-in page
- `/api/auth/google` — creates a state and PKCE challenge, then redirects to Google
- `/api/auth/google/callback` — validates state, exchanges the code, verifies the Google profile, and creates the server session
- `/api/auth/logout` — destroys the current session
- `/dashboard` — protected route; unauthenticated requests redirect to `/login`

The route guard is implemented in `src/middleware.ts`, with a second session check in `src/pages/dashboard.astro` as defense in depth.
