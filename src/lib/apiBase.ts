import { Capacitor } from '@capacitor/core'

/**
 * Worker API origin (no trailing slash). Set `VITE_API_URL` in `.env` (see `.env.example`).
 * Local dev default matches running `npx wrangler dev` on port 8787.
 */
const DEV_DEFAULT = 'http://localhost:8787'
const PROD_DEFAULT = 'https://waymark.bocas-joshua.workers.dev'

function isLoopbackOrigin(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)
}

/**
 * `allowNativeLoopback`: test builds only (VITE_E2E_ALLOW_NATIVE_LOOPBACK=1, set by
 * .github/workflows/ios-sim-test.yml) let the Simulator app call a Worker on the
 * runner's localhost. Unset in every real build, so a phone never does.
 */
export function resolveApiBaseUrl(raw: string | undefined, isNative: boolean, allowNativeLoopback = false): string {
  const cleaned = typeof raw === 'string' && raw.trim() !== ''
    ? raw.trim().replace(/\/$/, '')
    : ''

  if (isNative) {
    if (!cleaned || (isLoopbackOrigin(cleaned) && !allowNativeLoopback)) return PROD_DEFAULT
    return cleaned
  }

  return cleaned || DEV_DEFAULT
}

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl(import.meta.env.VITE_API_URL, Capacitor.isNativePlatform(), import.meta.env.VITE_E2E_ALLOW_NATIVE_LOOPBACK === '1')
}
