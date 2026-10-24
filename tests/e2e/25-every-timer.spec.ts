import { test, expect } from './fixtures'
import { enterFromToday, grass, grassToStart, insertSession, swipeDownGrass, swipeUpGrass, timerSeconds } from './support/helpers'

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

// ─── Page 85: swipe back on the hold and rest timers ─────────────

test('Strength rest, swipe down: restarts the rest only, every time; never back to the set', async ({ page, api }) => {
  const s = await insertSession(api, 'strength')
  await enterFromToday(page, s.id)
  await page.getByRole('button', { name: 'LOG SET', exact: true }).tap()
  await expect(page.getByText('RESTING AFTER')).toBeVisible()
  const full = await timerSeconds(page)
  await page.clock.fastForward(20_000)
  expect(await timerSeconds(page)).toBeLessThanOrEqual(full - 19)
  await swipeDownGrass(page)
  await expect.poll(() => timerSeconds(page)).toBeGreaterThanOrEqual(full - 1)
  await expect(page.getByText('RESTING AFTER')).toBeVisible()
  // again within 3 s: still the rest (the saved set stays saved; no LOG SET board)
  await page.clock.fastForward(5_000)
  await swipeDownGrass(page)
  await swipeDownGrass(page)
  await expect(page.getByText('RESTING AFTER')).toBeVisible()
  await expect(page.getByRole('button', { name: 'LOG SET', exact: true })).toHaveCount(0)
  await expect.poll(() => timerSeconds(page)).toBeGreaterThanOrEqual(full - 1)
})

test('Active Recovery, swipe down: restarts the hip hold; again within 3 s, back to the walk', async ({ page, api }) => {
  const s = await insertSession(api, 'active_recovery', 'pm')
  await enterFromToday(page, s.id)
  await page.getByRole('button', { name: 'Begin' }).tap()
  await grassToStart(page).tap()
  await swipeUpGrass(page)
  await expect(page.getByText('NEXT · HIP MOBILITY')).toHaveCount(0)
  await grassToStart(page).tap()
  await expect(page.getByRole('img', { name: 'HOLD', exact: true })).toBeVisible()
  const full = await timerSeconds(page)
  await page.clock.fastForward(10_000)
  expect(await timerSeconds(page)).toBeLessThanOrEqual(full - 9)
  await swipeDownGrass(page)
  await expect.poll(() => timerSeconds(page)).toBeGreaterThanOrEqual(full - 1)
  await expect(page.getByRole('img', { name: 'HOLD', exact: true })).toBeVisible()
  await swipeDownGrass(page)
  // the first hip hold: the one before is the walk, from its full time and still running
  await expect(page.getByRole('img', { name: 'WALK OR BIKE', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'MOVING', exact: true })).toBeVisible()
})

test('Foundation hold, swipe down: restarts the hold; again within 3 s, the step before', async ({ page, api }) => {
  const s = await insertSession(api, 'mobility', 'pm')
  await enterFromToday(page, s.id)
  const done = page.getByRole('button', { name: 'DONE', exact: true })
  const breathe = page.getByRole('status', { name: /^Breathe/ })
  const note = () => page.evaluate(() => document.querySelector('.wm-board .tm-note')?.textContent ?? '')
  // On to the first timed move made of several holds (a rep or a side each): counted moves are DONE,
  // a single hold is started and swiped on.
  for (let i = 0; i < 40 && !/Rep 1 of|side/i.test(await note()); i++) {
    if (await breathe.isVisible()) { await page.clock.fastForward(3500); continue }
    if (await done.isVisible()) { await page.waitForTimeout(400); await done.tap(); continue }
    if (await grassToStart(page).isVisible()) { await grassToStart(page).tap(); await swipeUpGrass(page); continue }
    await page.waitForTimeout(250)
  }
  const first = await note()
  expect(first, 'a timed move with several holds').toMatch(/Rep 1 of|side/i)
  // Step 1 running, then on to step 2 and start it.
  await grassToStart(page).tap()
  await swipeUpGrass(page)
  await expect.poll(note).not.toBe(first)
  if (await grassToStart(page).isVisible()) await grassToStart(page).tap()
  await expect(grass(page)).toBeVisible()
  const full = await timerSeconds(page)
  await page.clock.fastForward(3_000)
  expect(await timerSeconds(page)).toBeLessThan(full)
  // Down: this hold from its full time, still running.
  await swipeDownGrass(page)
  await expect.poll(() => timerSeconds(page)).toBeGreaterThanOrEqual(full - 1)
  await expect(grass(page)).toBeVisible()
  // Down again within 3 s: the step before, from its full time, still running.
  await swipeDownGrass(page)
  await expect.poll(note).toBe(first)
  await expect(grass(page)).toBeVisible()
})
