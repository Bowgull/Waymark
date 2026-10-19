import { join } from 'node:path'
import type { FullConfig } from '@playwright/test'
import { E2E_API_KEY, startBackend } from './support/backend'
import { startClient } from './support/client'

/**
 * Starts the scratch backend and the built client, exposes them to the
 * workers through env (E2E_BASE_URL, E2E_API_URL, E2E_API_KEY) and returns
 * the teardown.
 */
export default async function globalSetup(_config: FullConfig) {
  // Already running (E2E_BASE_URL + E2E_API_URL set, e.g. by `npx tsx scripts/e2e-serve.mts`): reuse them.
  if (process.env.E2E_BASE_URL && process.env.E2E_API_URL) {
    process.env.E2E_API_KEY ??= E2E_API_KEY
    console.log(`[e2e] using running servers ${process.env.E2E_BASE_URL} -> ${process.env.E2E_API_URL}`)
    return
  }
  const t0 = Date.now()
  const backend = await startBackend({ keep: process.env.E2E_KEEP === '1' })
  const client = await startClient({
    apiTarget: backend.url,
    apiKey: E2E_API_KEY,
    outDir: join(backend.dir, 'dist'),
  })
  process.env.E2E_BASE_URL = client.url
  process.env.E2E_API_URL = backend.url
  process.env.E2E_API_KEY = E2E_API_KEY
  process.env.E2E_DIST_DIR = client.outDir
  console.log(`[e2e] servers ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  return async () => {
    await client.stop()
    await backend.stop()
  }
}
