import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { enterFromToday, grass, insertSession, swipeUpGrass } from './support/helpers'
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
  // page 84: no NEXT SET button on the rest; a swipe up the grass moves on
  await expect(grass(page)).toBeVisible()
  await swipeUpGrass(page)
  await expect(page.getByText(/^Warmup 2 of \d+/)).toBeVisible()
  return s
}

/** BACK IN YOUR SESSION (page 61, 3E): what is saved, then RESUME. */
async function backIn(page: Page) {
  await expect(page.getByRole('img', { name: 'BACK IN YOUR SESSION' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('SAVED ON THE PHONE')).toBeVisible()
  await page.getByRole('button', { name: 'RESUME', exact: true }).tap()
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
  // Capacitor reloads the WebView in place (e.g. after iOS kills its content
  // process): the bundle's /assets/... must still resolve from /session/<id>.
  const s = await midSession(page, api)

  await context.setOffline(true)
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`/session/${s.id}`))
  // Page 61, 3E: a reload lands on BACK IN YOUR SESSION, paused where it was.
  await backIn(page)
  await expect(page.getByText(/^Warmup 2 of \d+/)).toBeVisible({ timeout: 15_000 })
  await expect(offlinePill(page)).toBeVisible()
})

test('Reopened offline mid-session: straight back into it', async ({ page, context, api }) => {
  // Today can't reach the API: it reopens the session saved on the phone.
  const s = await midSession(page, api)

  await context.setOffline(true)
  await page.goto('/')
  await expect(page).toHaveURL(new RegExp(`/session/${s.id}`), { timeout: 15_000 })
  await backIn(page)
  await expect(page.getByText(/^Warmup 2 of \d+/)).toBeVisible()
})
