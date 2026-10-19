import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { enterFromToday, insertSession } from './support/helpers'
import { serveBundle } from './support/bundle'
import type { Api } from './fixtures'

/**
 * Offline mid-session. On the phone the app's files come from its bundle
 * (capacitor://localhost) and only the API needs the network: serveBundle
 * serves the built dist the same way, and context.setOffline cuts the rest.
 */

interface Workout { exercises: Array<{ sets: Array<{ completedAt: number | null }> }> }
const loggedSets = async (api: Api, id: string) =>
  (await api.get<Workout>(`/api/sessions/${id}/workout`)).exercises.flatMap(e => e.sets).filter(s => s.completedAt != null).length
const offlinePill = (page: Page) => page.getByRole('status').getByRole('img', { name: /^OFFLINE/ })

async function midSession(page: Page, api: Api) {
  const s = await insertSession(api, 'strength')
  await enterFromToday(page, s.id)
  await page.getByRole('button', { name: 'LOG SET', exact: true }).tap()
  await expect.poll(() => loggedSets(api, s.id)).toBe(1)
  await page.getByRole('button', { name: 'NEXT SET', exact: true }).tap()
  await expect(page.getByText(/^Warmup 2 of \d+/)).toBeVisible()
  return s
}

test.beforeEach(async ({ context, baseURL }) => {
  await serveBundle(context, new URL(baseURL!).origin)
})

test('Offline mid-session: the set logs to the outbox, then syncs on reconnect', async ({ page, context, api }) => {
  const s = await midSession(page, api)

  await context.setOffline(true)
  await expect(offlinePill(page)).toBeVisible()
  await page.getByRole('button', { name: 'LOG SET', exact: true }).tap()
  await expect(page.getByRole('status').getByRole('img', { name: 'OFFLINE · 1 SAVED' })).toBeVisible()
  await expect(page).toHaveScreenshot('offline-one-saved.png', { mask: [page.getByRole('timer')] })
  expect(await loggedSets(api, s.id)).toBe(1)

  await context.setOffline(false)
  await expect.poll(() => loggedSets(api, s.id), { timeout: 20_000 }).toBe(2)
  await expect(offlinePill(page)).toHaveCount(0)
})

test('Offline reload mid-session: the same set comes back', async ({ page, context, api }) => {
  // Known bug: after a reload on /session/<id> the bundle's scripts resolve to
  // /session/assets/... (vite.config.ts base './' with BrowserRouter paths), which
  // isn't in the bundle: a blank screen. Capacitor reloads the WebView in place
  // (e.g. after iOS kills its content process). Remove once it comes back.
  test.fail(true, 'reload on /session/:id loads ./assets from /session/assets/ (vite.config.ts base: "./")')
  const s = await midSession(page, api)

  await context.setOffline(true)
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/session/${s.id}`))
  await expect(page.getByText(/^Warmup 2 of \d+/)).toBeVisible({ timeout: 15_000 })
  await expect(offlinePill(page)).toBeVisible()
})

test('Reopened offline mid-session: straight back into it', async ({ page, context, api }) => {
  // Known gap: Today's auto-resume runs only after its API reads succeed
  // (src/features/today/TodayPage.tsx, load()), so reopened offline it shows
  // TODAY DIDN'T LOAD instead of the session that is saved on the phone.
  test.fail(true, 'Today auto-resume needs the API (TodayPage.tsx load())')
  const s = await midSession(page, api)

  await context.setOffline(true)
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(`/session/${s.id}`), { timeout: 15_000 })
  await expect(page.getByText(/^Warmup 2 of \d+/)).toBeVisible()
})
