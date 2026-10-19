/**
 * Starts the e2e test backend (wrangler dev on a scratch local D1, dummy
 * .dev.vars, test API key) and keeps it running until killed.
 * See tests/e2e/support/backend.ts. Used by .github/workflows/ios-sim-test.yml.
 *
 *   npx tsx scripts/e2e-backend.mts --port 8787 [--keep]
 */
import { startBackend } from '../tests/e2e/support/backend'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const backend = await startBackend({
  port: arg('--port') ? Number(arg('--port')) : undefined,
  ip: arg('--ip'),
  keep: process.argv.includes('--keep'),
})
console.log(`E2E_BACKEND_URL=${backend.url}`)
console.log(`E2E_BACKEND_DIR=${backend.dir}`)

const shutdown = async () => {
  await backend.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
setInterval(() => {}, 1 << 30)
