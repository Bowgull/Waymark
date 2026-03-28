/**
 * Cloudflare Worker entry (Wrangler `main` in wrangler.jsonc).
 * React uses `main.tsx`; this file is bundled only by Wrangler.
 */
import app from './server/app'

export default {
  fetch: app.fetch,
}
