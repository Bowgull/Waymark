import { test, expect } from './fixtures'
import { enterFromToday, grass, grassToStart, insertSession, swipeUpGrass } from './support/helpers'

/**
 * Page 84, every timer the new way: the phase word over the hero clock, the
 * count under it in the bag round's language (ROUND / NEXT, the number, OF 4),
 * a small NEXT line; nothing on the grass, and no button that copies the grass
 * (a swipe up moves on). Strength's rest and Active Recovery's walk, which
 * used to be a ring timer in rounded cards.
 */

test('Strength rest: RESTING AFTER the lift, REST over the clock, NEXT n OF m under it; no NEXT SET, the swipe moves on', async ({ page, api }) => {
  const s = await insertSession(api, 'strength')
  await enterFromToday(page, s.id)
  await page.getByRole('button', { name: 'LOG SET', exact: true }).tap()
  await expect(page.getByText('RESTING AFTER')).toBeVisible()
  await expect(page.getByRole('img', { name: 'REST', exact: true })).toBeVisible()
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Next \d+ of \d+$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'NEXT SET' })).toHaveCount(0)
  // the count left the top bar
  await expect(page.locator('.tm-stop').getByRole('img', { name: /^\d+\/\d+$/ })).toHaveCount(0)
  // nothing sits on the grass: the column ends above it
  const col = await page.locator('.tm-gx-in').boundingBox()
  const g = await grass(page).boundingBox()
  expect(col!.y + col!.height).toBeLessThanOrEqual(g!.y + 1)
  await swipeUpGrass(page)
  await expect(page.getByText('RESTING AFTER')).toHaveCount(0)
})

test('Active Recovery walk: a grass timer (no ring, no rounded cards): READY, the grass starts it, MOVING, NEXT · HIP MOBILITY', async ({ page, api }) => {
  const s = await insertSession(api, 'active_recovery', 'pm')
  await enterFromToday(page, s.id)
  await page.getByRole('button', { name: 'Begin' }).tap()
  await expect(page.getByRole('img', { name: 'WALK OR BIKE', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'READY', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Timer' })).toHaveCount(0)
  await grassToStart(page).tap()
  await expect(page.getByRole('img', { name: 'MOVING', exact: true })).toBeVisible()
  await expect(page.getByText('NEXT · HIP MOBILITY')).toBeVisible()
  // the old Pause / Skip buttons are gone (the grass itself is labelled "Tap to pause…")
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0)
  // a swipe up moves on to the hips
  await swipeUpGrass(page)
  await expect(page.getByText('NEXT · HIP MOBILITY')).toHaveCount(0)
})
