/**
 * Worker API origin (no trailing slash). Set `VITE_API_URL` in `.env` (see `.env.example`).
 * Local dev default matches running `npx wrangler dev` on port 8787.
 */
const DEV_DEFAULT = 'http://localhost:8787'

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.replace(/\/$/, '')
  }
  return DEV_DEFAULT
}
