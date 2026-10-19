/**
 * Starts the Playwright e2e servers (scratch backend + built client) and keeps
 * them up, for iterating on specs without a rebuild each run:
 *
 *   npx tsx scripts/e2e-serve.mts
 *   # then, in another shell, with the printed env:
 *   E2E_BASE_URL=... E2E_API_URL=... npx playwright test
 */
import { join } from 'node:path'
import { E2E_API_KEY, startBackend } from '../tests/e2e/support/backend'
import { startClient } from '../tests/e2e/support/client'

const backend = await startBackend()
const client = await startClient({ apiTarget: backend.url, apiKey: E2E_API_KEY, outDir: join(backend.dir, 'dist') })
console.log(`E2E_BASE_URL=${client.url} E2E_API_URL=${backend.url} E2E_DIST_DIR=${client.outDir}`)
const shutdown = async () => { await client.stop(); await backend.stop(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
setInterval(() => {}, 1 << 30)
