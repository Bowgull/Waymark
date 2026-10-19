/**
 * Builds the web client for the e2e run and serves it on a free port.
 *
 * The Worker's CORS allows only a fixed origin list (src/server/app.ts), and a
 * free port isn't on it. Rather than touching CORS, the preview server proxies
 * /api to the test Worker, so the app calls its own origin (no CORS at all):
 * VITE_API_URL is the preview origin, VITE_API_KEY the test key.
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, preview, type PreviewServer } from 'vite'
import { freePort } from './backend'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export interface Client {
  url: string
  outDir: string
  stop: () => Promise<void>
}

export async function startClient(opts: { apiTarget: string; apiKey: string; outDir: string }): Promise<Client> {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`

  // Vite reads VITE_* from process.env ahead of any .env file.
  process.env.VITE_API_URL = url
  process.env.VITE_API_KEY = opts.apiKey

  console.log(`[e2e-client] vite build -> ${opts.outDir} (VITE_API_URL=${url})`)
  await build({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir: opts.outDir, emptyOutDir: true },
  })

  const server: PreviewServer = await preview({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.ts'),
    logLevel: 'warn',
    build: { outDir: opts.outDir },
    preview: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      proxy: { '/api': { target: opts.apiTarget, changeOrigin: true } },
    },
  })
  console.log(`[e2e-client] serving ${url}`)
  return {
    url,
    outDir: opts.outDir,
    stop: () => server.close(),
  }
}
