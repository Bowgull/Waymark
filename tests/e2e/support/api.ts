import type { APIRequestContext } from '@playwright/test'
import type { Api } from '../fixtures'

/** The same API helper for hooks that only have `request` (beforeAll). */
export function makeApiFor(request: APIRequestContext): Api {
  const root = process.env.E2E_API_URL!
  const headers = { Authorization: `Bearer ${process.env.E2E_API_KEY}`, 'Content-Type': 'application/json' }
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await request.fetch(`${root}${path}`, { method, headers, data: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${text.slice(0, 500)}`)
    return (text ? JSON.parse(text) : null) as T
  }
  return { get: p => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b ?? {}) }
}
