// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

import tailwindcss from '@tailwindcss/vite';

// https://docs.astro.build/en/guides/on-demand-rendering/
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  session: {
    // Keep the portal session server-side in Cloudflare KV for 30 days.
    ttl: 60 * 60 * 24 * 30
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Arena's preview proxy uses dynamic *.e2b.app hostnames.
      allowedHosts: ['.e2b.app']
    }
  }
});
