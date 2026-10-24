import type { Locator, Page } from '@playwright/test'

import { test, expect } from './fixtures'
import { gotoToday, todayISO } from './support/helpers'

/**
 * Page 81, the hidden interval timer. Settings shows nothing of it; holding
 * the crest about 1 s opens the window (the command window over a dimmed
 * Settings): ROUNDS, WORK and REST on the bag builder's − value + steppers, a
 * value tapped opens the number pad (1 3 0 is 1:30), a plain total line, one
 * START. Running is the grass timer: GET READY, then WORK and REST, read from
 * the lock card's state the web keeps in window.__wmActivity. Holding the
 * grass 3 s just ends it, back to Settings; nothing is logged anywhere.
 */

interface Activity { phase: string; label: string; round?: number; roundTotal?: number; glowTone?: string; glowSeq?: number; isPaused: boolean }
const activity = (page: Page) => page.evaluate(() => (window as unknown as { __wmActivity?: Activity }).__wmActivity ?? null)

async function openSettings(page: Page) {
  // The last numbers start fresh for every test.
  await page.addInitScript(() => { try { localStorage.removeItem('wm.intervalTimer.last') } catch { /* private */ } })
  await gotoToday(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).tap()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('img', { name: 'SETTINGS' })).toBeVisible()
}

/** Press and hold for `ms` (a thumb on the glass). */
async function hold(page: Page, el: Locator, ms: number, at: { x: number; y: number } = { x: 0.5, y: 0.5 }) {
  const box = (await el.boundingBox())!
  await page.mouse.move(box.x + box.width * at.x, box.y + box.height * at.y)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

const crest = (page: Page) => page.locator('.st-brand')
const win = (page: Page) => page.getByRole('dialog', { name: 'Interval timer' })
const step = (page: Page, key: 'rounds' | 'work' | 'rest') => win(page).locator(`.it-step[data-k="${key}"]`)

async function openWindow(page: Page) {
  await hold(page, crest(page), 1300, { x: 0.2, y: 0.5 })
  await expect(win(page)).toBeVisible()
}

test('Nothing on Settings points to it; a short press on the crest does not open it', async ({ page }) => {
  await openSettings(page)
  await expect(page.getByText(/interval/i)).toHaveCount(0)
  await expect(crest(page)).toHaveAttribute('aria-label', 'Back')
  // let go early: no window (and the crest eases back)
  await hold(page, crest(page), 400, { x: 0.2, y: 0.5 })
  await expect(win(page)).toHaveCount(0)
  // the treadmill row lost its helper line
  await expect(page.getByText('Hard runs inside.')).toHaveCount(0)
  await expect(page.getByText('Treadmill speed')).toBeVisible()
})

test('Crest held 1 s: the window with steppers, the number pad, the total; tap outside closes it', async ({ page }) => {
  await openSettings(page)
  await openWindow(page)
  // opens on the defaults (nothing saved yet): 8 rounds, 0:30 work, 0:15 rest
  await expect(win(page).getByRole('img', { name: 'INTERVAL TIMER' })).toBeVisible()
  await expect(step(page, 'rounds').getByRole('img', { name: '8' })).toBeVisible()
  await expect(step(page, 'work').getByRole('img', { name: '0:30' })).toBeVisible()
  await expect(step(page, 'rest').getByRole('img', { name: '0:15' })).toBeVisible()
  await expect(win(page).getByText('8 rounds · 5:55 total')).toBeVisible()

  // − and +: rounds by 1, times by 5 s under a minute, 15 s above
  await win(page).getByRole('button', { name: 'Rounds: less' }).tap()
  await expect(step(page, 'rounds').getByRole('img', { name: '7' })).toBeVisible()
  await win(page).getByRole('button', { name: 'Work: more' }).tap()
  await expect(step(page, 'work').getByRole('img', { name: '0:35' })).toBeVisible()

  // tap the value: the pad. 1 3 0 is 1:30, DONE sets it
  await step(page, 'work').locator('.it-val').tap()
  const pad = page.getByRole('dialog', { name: 'Type work' })
  await expect(pad).toBeVisible()
  for (const d of ['1', '3', '0']) await pad.getByRole('button', { name: d, exact: true }).tap()
  await expect(pad.getByRole('img', { name: '1:30' })).toBeVisible()
  await pad.getByRole('button', { name: 'Done' }).tap()
  await expect(pad).toHaveCount(0)
  await expect(step(page, 'work').getByRole('img', { name: '1:30' })).toBeVisible()
  await expect(win(page).getByText('7 rounds · 12:10 total')).toBeVisible()

  // the limits: rounds no more than 30
  await step(page, 'rounds').locator('.it-val').tap()
  const rp = page.getByRole('dialog', { name: 'Type rounds' })
  for (const d of ['9', '9']) await rp.getByRole('button', { name: d, exact: true }).tap()
  await rp.getByRole('button', { name: 'Done' }).tap()
  await expect(step(page, 'rounds').getByRole('img', { name: '30' })).toBeVisible()
  await expect(win(page).getByRole('button', { name: 'Rounds: more' })).toBeDisabled()

  // a pad left by a tap outside keeps the number as it was
  await step(page, 'rest').locator('.it-val').tap()
  const restPad = page.getByRole('dialog', { name: 'Type rest' })
  await restPad.getByRole('button', { name: '4', exact: true }).tap()
  await page.mouse.click(20, 120)
  await expect(restPad).toHaveCount(0)
  await expect(step(page, 'rest').getByRole('img', { name: '0:15' })).toBeVisible()

  // CLOSE closes the window; Settings is as it was
  await win(page).getByRole('button', { name: 'Close' }).tap()
  await expect(win(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings$/)
})

test('START: get ready, work, rest from the lock card state; hold the grass 3 s ends it; nothing logged', async ({ page, api }) => {
  const before = await api.get<Array<{ id: string; status: string }>>(`/api/sessions/today?date=${todayISO()}`)
  await openSettings(page)
  await openWindow(page)
  // 2 rounds of 0:20 work, 0:10 rest
  await step(page, 'rounds').locator('.it-val').tap()
  const rp = page.getByRole('dialog', { name: 'Type rounds' })
  await rp.getByRole('button', { name: '2', exact: true }).tap()
  await rp.getByRole('button', { name: 'Done' }).tap()
  await step(page, 'work').locator('.it-val').tap()
  const wp = page.getByRole('dialog', { name: 'Type work' })
  for (const d of ['2', '0']) await wp.getByRole('button', { name: d, exact: true }).tap()
  await wp.getByRole('button', { name: 'Done' }).tap()
  await step(page, 'rest').locator('.it-val').tap()
  const sp = page.getByRole('dialog', { name: 'Type rest' })
  for (const d of ['1', '0']) await sp.getByRole('button', { name: d, exact: true }).tap()
  await sp.getByRole('button', { name: 'Done' }).tap()
  await expect(win(page).getByText('2 rounds · 1:00 total')).toBeVisible()
  await win(page).getByRole('button', { name: 'START' }).tap()

  // the grass timer: INTERVAL TIMER, GET READY first (teal)
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.getByRole('img', { name: 'INTERVAL TIMER' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'GET READY' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'ROUND 1 OF 2' })).toBeVisible()
  await expect.poll(async () => (await activity(page))?.label).toBe('GET READY')
  expect((await activity(page))?.glowTone).toBe('teal')

  // the last 5 s of get ready: orange (the colour only, the counter stays)
  await page.clock.fastForward(6_000)
  await expect.poll(async () => (await activity(page))?.glowTone).toBe('orange')
  expect((await activity(page))?.glowSeq).toBe(1)

  // work (gold), round 1 of 2
  await page.clock.fastForward(5_000)
  await expect.poll(async () => (await activity(page))?.label).toBe('WORK')
  expect(await activity(page)).toMatchObject({ phase: 'active', round: 1, roundTotal: 2, glowTone: 'gold', glowSeq: 2 })
  await expect(page.getByRole('img', { name: 'WORK' })).toBeVisible()

  // rest (teal)
  await page.clock.fastForward(20_000)
  await expect.poll(async () => (await activity(page))?.label).toBe('REST')
  expect(await activity(page)).toMatchObject({ phase: 'rest', glowTone: 'teal', glowSeq: 3 })

  // tap the grass: paused
  const grass = page.getByRole('button', { name: /^Timer\. Tap to pause\. Hold for 3 seconds to end\.$/ })
  await grass.tap()
  await expect.poll(async () => (await activity(page))?.isPaused).toBe(true)
  await expect(page.getByRole('img', { name: 'PAUSED' })).toBeVisible()
  await page.getByRole('button', { name: /^Timer paused\./ }).tap()
  await expect.poll(async () => (await activity(page))?.isPaused).toBe(false)

  // hold the grass 3 s: it just ends (no END AND LOG, no DISCARD), back to Settings
  await hold(page, page.getByRole('button', { name: /Hold for 3 seconds to end\.$/ }), 3400, { x: 0.5, y: 0.7 })
  await expect(page.getByRole('button', { name: 'END AND LOG' })).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'SETTINGS' })).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('timer')).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings$/)

  // nothing logged: today's sessions are exactly as they were
  const after = await api.get<Array<{ id: string; status: string }>>(`/api/sessions/today?date=${todayISO()}`)
  expect(after.map(r => `${r.id}:${r.status}`).sort()).toEqual(before.map(r => `${r.id}:${r.status}`).sort())

  // it opens on the last numbers started with
  await openWindow(page)
  await expect(step(page, 'rounds').getByRole('img', { name: '2' })).toBeVisible()
  await expect(step(page, 'work').getByRole('img', { name: '0:20' })).toBeVisible()
  await expect(step(page, 'rest').getByRole('img', { name: '0:10' })).toBeVisible()
})
