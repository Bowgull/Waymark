import { test as base, expect } from '@playwright/test'
import { makeApiFor } from './support/api'

/** API helper bound to the scratch Worker, with the test key (setup and checks only). */
export interface Api {
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
  patch<T = unknown>(path: string, body?: unknown): Promise<T>
}

/**
 * The browser's local time when each test starts: today (Toronto, see
 * playwright.config.ts) at 10:00, a morning with the day still open. Today
 * hides its board in the evening once the day is done (ALL DONE, page 43),
 * and past noon the Add Session board offers PM rows only, so a real clock
 * made the suite pass or fail by the hour it ran. The clock still runs from
 * there (specs move it on with page.clock.fastForward).
 */
export const TEST_HOUR = 10
export function testClockStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), TEST_HOUR, 0, 0)
}

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//

export const test = base.extend<{ api: Api; guard: void }>({
  baseURL: async ({}, use) => { await use(process.env.E2E_BASE_URL) },
  api: async ({ request }, use) => { await use(makeApiFor(request)) },
  // Every test: nothing leaves the machine (Strava, YouTube, fonts...): any
  // request to a non-local host is aborted. No Web Audio stand-in: Playwright's
  // Windows WebKit has none, and the app's bells (src/lib/sounds.ts) go quiet
  // without it rather than crash, so the suite runs that path for real.
  guard: [async ({ page, context }, use) => {
    await page.clock.install({ time: testClockStart() })
    await context.route(url => !LOCAL.test(url.toString()) && /^https?:/.test(url.toString()), route => route.abort('blockedbyclient'))
    page.on('pageerror', e => console.log(`[pageerror] ${e.message}`))
    await use()
  }, { auto: true }],
})

export { expect }
