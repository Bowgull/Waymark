/**
 * Test backend for the e2e layers: `wrangler dev` on a scratch local D1.
 *
 * - Everything lives in a fresh temp folder: the D1 persist dir, a generated
 *   wrangler config and a dummy .dev.vars (empty Anthropic key, a test API key).
 *   The repo's own .dev.vars and .wrangler state are never read: wrangler looks
 *   for .dev.vars next to the config it is given, which is the temp one.
 * - The D1 is local only (no `remote` binding, no account), so production is
 *   never touched. With ANTHROPIC_API_KEY empty, lib/anthropic.ts refuses before
 *   any fetch, so no AI call is made.
 * - Migrations: every drizzle/*.sql through the latest, then src/db/seed.sql
 *   (exercise + combo library, training maxes) and the demo seed
 *   (src/db/demoSeed.ts, invented data generated relative to today).
 *
 * Used by tests/e2e/global-setup.ts (Playwright) and scripts/e2e-backend.mts
 * (the iOS Simulator workflow).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateDemoSql } from '../../../src/db/demoSeed'

export const E2E_API_KEY = 'e2e-test-key-not-a-secret'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

export interface Backend {
  url: string
  port: number
  dir: string
  stop: () => Promise<void>
}

export async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', fail)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => ok(port))
    })
  })
}

function log(msg: string) {
  console.log(`[e2e-backend] ${msg}`)
}

/** Env for wrangler: no account, no telemetry, never interactive. */
function wranglerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' }
  // A stray Cloudflare token in the shell must not matter: nothing here is remote.
  delete env.CLOUDFLARE_API_TOKEN
  delete env.CLOUDFLARE_ACCOUNT_ID
  delete env.CF_API_TOKEN
  return env
}

function wranglerSync(args: string[]) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, env: wranglerEnv(), encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`)
  }
  return r.stdout
}

function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  }
}

async function waitForHealth(url: string, child: ChildProcess, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited early (${child.exitCode})`)
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`wrangler dev not healthy at ${url} after ${timeoutMs} ms`)
}

export interface BackendOptions {
  port?: number
  /** Listen address. The Simulator reaches the runner's 127.0.0.1. */
  ip?: string
  /** Keep the temp folder after stop (for debugging). */
  keep?: boolean
}

export async function startBackend(opts: BackendOptions = {}): Promise<Backend> {
  const dir = mkdtempSync(join(tmpdir(), 'waymark-e2e-'))
  const persist = join(dir, 'state')
  mkdirSync(persist)
  log(`scratch dir ${dir}`)

  // Dummy secrets: empty Anthropic key (no AI calls), a test-only API key.
  writeFileSync(join(dir, '.dev.vars'), [
    'ANTHROPIC_API_KEY=""',
    `WAYMARK_API_KEY="${E2E_API_KEY}"`,
    'STRAVA_CLIENT_ID=""',
    'STRAVA_CLIENT_SECRET=""',
    'STRAVA_WEBHOOK_VERIFY_TOKEN=""',
    '',
  ].join('\n'))

  // A throwaway config in the temp folder, so .dev.vars resolves there.
  const config = {
    name: 'waymark-e2e',
    main: join(ROOT, 'src', 'index.ts'),
    compatibility_date: '2024-12-01',
    d1_databases: [{
      binding: 'DB',
      database_name: 'waymark-db',
      database_id: '00000000-0000-0000-0000-000000000000',
      migrations_dir: join(ROOT, 'drizzle'),
    }],
  }
  const configPath = join(dir, 'wrangler.jsonc')
  writeFileSync(configPath, JSON.stringify(config, null, 2))
  const common = ['--config', configPath, '--local', '--persist-to', persist]

  const migrations = readdirSync(join(ROOT, 'drizzle')).filter(f => f.endsWith('.sql')).sort()
  log(`applying ${migrations.length} migrations (latest ${migrations.at(-1)})`)
  wranglerSync(['d1', 'migrations', 'apply', 'waymark-db', ...common])

  log('seeding src/db/seed.sql + demo seed')
  wranglerSync(['d1', 'execute', 'waymark-db', ...common, '--file', join(ROOT, 'src', 'db', 'seed.sql')])
  const demoPath = join(dir, 'demoSeed.sql')
  writeFileSync(demoPath, generateDemoSql().join('\n') + '\n')
  wranglerSync(['d1', 'execute', 'waymark-db', ...common, '--file', demoPath])

  const port = opts.port ?? await freePort()
  const inspector = await freePort()
  const ip = opts.ip ?? '127.0.0.1'
  const url = `http://${ip}:${port}`
  log(`starting wrangler dev on ${url}`)
  const child = spawn(process.execPath, [
    WRANGLER, 'dev',
    '--config', configPath,
    '--persist-to', persist,
    '--ip', ip,
    '--port', String(port),
    '--inspector-port', String(inspector),
    '--show-interactive-dev-session=false',
    '--log-level', 'warn',
  ], { cwd: ROOT, env: wranglerEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  const out: string[] = []
  child.stdout?.on('data', d => out.push(String(d)))
  child.stderr?.on('data', d => out.push(String(d)))

  try {
    await waitForHealth(url, child, 90_000)
  } catch (e) {
    killTree(child)
    throw new Error(`${(e as Error).message}\n${out.join('').slice(-4000)}`)
  }
  log(`healthy at ${url}`)

  return {
    url,
    port,
    dir,
    stop: async () => {
      killTree(child)
      await new Promise(r => setTimeout(r, 300))
      if (!opts.keep) {
        try { rmSync(dir, { recursive: true, force: true }) } catch { /* workerd may still hold a file on Windows */ }
      }
    },
  }
}
