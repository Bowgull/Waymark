import { test as base, expect } from '@playwright/test'
import { makeApiFor } from './support/api'
import { installShims } from './support/helpers'

/** API helper bound to the scratch Worker, with the test key (setup and checks only). */
export interface Api {
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
  patch<T = unknown>(path: string, body?: unknown): Promise<T>
}

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//

export const test = base.extend<{ api: Api; guard: void }>({
  baseURL: async ({}, use) => { await use(process.env.E2E_BASE_URL) },
  api: async ({ request }, use) => { await use(makeApiFor(request)) },
  // Every test: the environment shims, and nothing leaves the machine (Strava,
  // YouTube, fonts...): any request to a non-local host is aborted.
  guard: [async ({ page, context }, use) => {
    await installShims(page)
    await context.route(url => !LOCAL.test(url.toString()) && /^https?:/.test(url.toString()), route => route.abort('blockedbyclient'))
    page.on('pageerror', e => console.log(`[pageerror] ${e.message}`))
    await use()
  }, { auto: true }],
})

export { expect }
