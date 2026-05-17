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

export function resolveApiBaseUrl(raw: string | undefined, isNative: boolean): string {
  const cleaned = typeof raw === 'string' && raw.trim() !== ''
    ? raw.trim().replace(/\/$/, '')
    : ''

  if (isNative) {
    if (!cleaned || isLoopbackOrigin(cleaned)) return PROD_DEFAULT
    return cleaned
  }

  return cleaned || DEV_DEFAULT
}

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl(import.meta.env.VITE_API_URL, Capacitor.isNativePlatform())
}
