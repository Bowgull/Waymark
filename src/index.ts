/**
 * Cloudflare Worker entry (Wrangler `main` in wrangler.jsonc).
 * The React app uses `main.tsx`; this file is only bundled by Wrangler.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'waymark-worker' })
    }
    return new Response('Waymark Worker', {
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    })
  },
}
