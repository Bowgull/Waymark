import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import type { BrowserContext } from '@playwright/test'

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon',
}

/**
 * Serve the page's own files from the built dist folder, the way the iOS app
 * gets them from its bundle (capacitor://localhost), so they load with the
 * network off. Same rule as Capacitor's iOS router (CapacitorRouter.route):
 * a path with no extension is index.html; a path with one is that file, or 404.
 */
export async function serveBundle(context: BrowserContext, origin: string, dist = process.env.E2E_DIST_DIR!) {
  await context.route(url => url.origin === origin && !url.pathname.startsWith('/api/'), async route => {
    const { pathname } = new URL(route.request().url())
    const ext = extname(pathname)
    const rel = ext ? normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, '') : 'index.html'
    try {
      const body = await readFile(join(dist, rel))
      await route.fulfill({ status: 200, body, contentType: TYPES[extname(rel)] ?? 'application/octet-stream' })
    } catch {
      await route.fulfill({ status: 404, body: 'not in the bundle', contentType: 'text/plain' })
    }
  })
}
