import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { enterFromToday, gotoToday, grass, grassPaused, grassToStart, insertSession, todayRow } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * Page 71 (approved 2026-10-21, all five items): the grass starts and pauses a
 * timed step (no START button; TAP THE GRASS TO START boxed mid-grass the first
 * time on this phone, then the quiet TAP TO START line; TAP · PAUSE; PAUSED ·
 * TAP TO GO ON); rep steps keep DONE and have no grass; the × still only ends
 * on a hold. A running session shows once: as the live strip, not a row on
 * Today (the first row still to do opens instead), and on Program's day board
 * it reads "under way" with no RESUME. Done, it is back in Today's list with ✓.
 */

test.beforeAll(async ({ request }) => {
  await setMorning(makeApiFor(request))
})
test.describe.configure({ mode: 'serial' })

const hint = (page: Page) => page.locator('.tm-ghint')

/** Into a Foundation session, up to its first timed hold or counted step. */
async function toFirstStep(page: Page) {
  const done = page.getByRole('button', { name: 'DONE', exact: true })
  await expect(grassToStart(page).or(done).first()).toBeVisible({ timeout: 20_000 })
}

test('Item 1-3: a hold starts on the grass (boxed hint the first time), pauses and goes on; no START button; × still holds to end', async ({ page, api }) => {
  const s = await insertSession(api, 'mobility', 'pm')
  await enterFromToday(page, s.id)
  await toFirstStep(page)

  // Counted steps first, if the session opens on one: DONE, and no grass to tap (item 2).
  const done = page.getByRole('button', { name: 'DONE', exact: true })
  for (let i = 0; i < 20 && !(await grassToStart(page).isVisible()); i++) {
    if (await done.isVisible()) {
      await expect(page.getByRole('button', { name: /^Timer/ })).toHaveCount(0)
      await done.tap()
    }
    if (await page.getByRole('status', { name: /^Breathe/ }).isVisible()) await page.clock.fastForward(3500)
    await page.waitForTimeout(250)
  }

  // Ready: READY on the phase flap, no START button, the boxed first-time hint mid-grass.
  await expect(grassToStart(page)).toBeVisible()
  await expect(page.getByRole('img', { name: 'READY', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^START/ })).toHaveCount(0)
  await expect(hint(page)).toHaveText('TAP THE GRASS TO START')
  await expect(hint(page)).toHaveClass(/is-mid/)
  // The clock stays where it is; END EARLY only once it runs.
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'END EARLY' })).toHaveCount(0)

  // Tap: it runs. The quiet TAP · PAUSE at the foot; END EARLY appears.
  await grassToStart(page).tap()
  await expect(grass(page)).toBeVisible()
  await expect(page.getByRole('img', { name: 'HOLD', exact: true })).toBeVisible()
  await expect(hint(page)).toHaveText('TAP · PAUSE')
  await expect(hint(page)).not.toHaveClass(/is-mid/)
  await expect(page.getByRole('button', { name: 'END EARLY' })).toBeVisible()

  // Tap: paused, PAUSED · TAP TO GO ON. The clock stands still.
  await grass(page).tap()
  await expect(grassPaused(page)).toBeVisible()
  await expect(hint(page)).toHaveText('PAUSED · TAP TO GO ON')
  const stood = await page.getByRole('timer').getAttribute('aria-label')
  await page.clock.fastForward(3000)
  await expect(page.getByRole('timer')).toHaveAttribute('aria-label', stood!)

  // The keyboard works the grass too (Enter / Space): on again.
  await grassPaused(page).focus()
  await page.keyboard.press('Enter')
  await expect(grass(page)).toBeVisible()
  await expect(hint(page)).toHaveText('TAP · PAUSE')

  // Ending is never one tap on the grass: still the session, the × only ends on a hold (item 3).
  await expect(page).toHaveURL(new RegExp(`/session/${s.id}`))
  await expect(page.getByRole('button', { name: 'End. Hold for 1.5 seconds.' })).toBeVisible()

  // Remembered on this phone: after a reload the next timed step waits with the quiet foot line.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('wm.grassStartTaught'))).toBe('1')
})

test('Item 1: once taught, a timer that waits says TAP TO START at the foot (no box)', async ({ page, api }) => {
  const s = await insertSession(api, 'mobility', 'pm')
  await page.addInitScript(() => { try { localStorage.setItem('wm.grassStartTaught', '1') } catch { /* blocked */ } })
  await enterFromToday(page, s.id)
  await toFirstStep(page)
  const done = page.getByRole('button', { name: 'DONE', exact: true })
  for (let i = 0; i < 20 && !(await grassToStart(page).isVisible()); i++) {
    if (await done.isVisible()) await done.tap()
    if (await page.getByRole('status', { name: /^Breathe/ }).isVisible()) await page.clock.fastForward(3500)
    await page.waitForTimeout(250)
  }
  await expect(hint(page)).toHaveText('TAP TO START')
  await expect(hint(page)).not.toHaveClass(/is-mid/)
  // Space starts it, as a button.
  await grassToStart(page).focus()
  await page.keyboard.press(' ')
  await expect(grass(page)).toBeVisible()
})

/** Into a bag round, working (the warm-up and the round both start on the grass). */
async function intoRound(page: Page, id: string) {
  await enterFromToday(page, id)
  const begin = page.getByRole('button', { name: /^(BEGIN SESSION|BEGIN|START BAG WORK|SKIP WARM UP)$/ })
  const round1 = page.getByRole('img', { name: /^Round 1 of \d+$/ })
  const warmUp = page.getByRole('img', { name: 'SKIP ROPE', exact: true })
  for (let i = 0; i < 8 && !(await round1.isVisible()); i++) {
    if (await begin.first().isVisible()) await begin.first().tap()
    else if (await warmUp.isVisible() && await grassToStart(page).isVisible()) await grassToStart(page).tap()
    else await page.waitForTimeout(500)
  }
  await grassToStart(page).tap()
  await expect(page.getByRole('img', { name: 'FIGHT', exact: true })).toBeVisible()
}

test('Items 4-5: a running session is only the strip; Today opens the next to-do; Program says under way, no RESUME; done, back with ✓', async ({ page, api }) => {
  const other = await insertSession(api, 'active_recovery', 'pm')
  const bag = await insertSession(api, 'bag_work', 'pm')
  await intoRound(page, bag.id)

  // Out to Today: the strip, and no row for the running session.
  await page.getByRole('button', { name: '‹ TODAY' }).tap()
  await expect(page).toHaveURL(/\/today/)
  const strip = page.locator('button.wm-live')
  await expect(strip).toBeVisible()
  await expect(todayRow(page, bag.id)).toHaveCount(0)
  await expect(todayRow(page, other.id)).toBeVisible()
  // The open row moved on from the running one to the first row still to do.
  const firstToDo = page.locator('.td-row:not(.is-done):not(.is-skip)').first()
  await expect(firstToDo.locator('.td-rowhit')).toHaveAttribute('aria-expanded', 'true')

  // A fresh Today (a new open, no auto-resume) opens the first row still to do, never the running one.
  await gotoToday(page)
  await expect(strip).toBeVisible()
  await expect(todayRow(page, bag.id)).toHaveCount(0)
  await expect(page.locator('.td-row:not(.is-done):not(.is-skip)').first().locator('.td-rowhit')).toHaveAttribute('aria-expanded', 'true')

  // Program's day board: the running session reads "under way", and its summary has no RESUME.
  await page.getByRole('link', { name: 'program' }).tap()
  await expect(page.getByRole('group', { name: 'Weeks of the block' })).toBeVisible({ timeout: 20_000 })
  const prow = page.locator(`[data-sid="${bag.id}"] .db-row`)
  await expect(prow).toBeVisible()
  await expect(prow.locator('.db-det')).toContainText('under way')
  await prow.locator('.db-face').tap()
  await expect(prow).toHaveClass(/is-open/)
  await expect(prow.getByRole('button', { name: 'RESUME' })).toHaveCount(0)
  await expect(prow.getByRole('button', { name: 'ENTER' })).toHaveCount(0)
  // Still in Program: opening the row never jumped into the session.
  await expect(page).toHaveURL(/\/program/)

  // The strip is the way back in. End it (hold ×), close it: back in Today's list with ✓.
  await strip.tap()
  await expect(page).toHaveURL(new RegExp(`/session/${bag.id}`))
  const x = page.getByRole('button', { name: 'End. Hold for 1.5 seconds.' })
  await x.focus()
  await page.keyboard.press('Enter')
  const close = page.getByRole('button', { name: 'CLOSE SESSION' })
  await expect(close).toBeVisible({ timeout: 10_000 })
  await expect(async () => {
    if (await close.isVisible()) await close.tap()
    await expect(page).toHaveURL(/\/today/, { timeout: 3000 })
  }).toPass({ timeout: 30_000 })
  await expect(strip).toHaveCount(0, { timeout: 15_000 })
  const row = todayRow(page, bag.id)
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row).toHaveClass(/is-done/)
})

test.describe('Item 6: the row and the strip move into each other (motion on)', () => {
  test('‹ TODAY: the row flies into the strip and leaves the list; finished, it lands back with ✓; nothing jumps', async ({ page, api }) => {
    const bag = await insertSession(api, 'bag_work', 'pm')
    await intoRound(page, bag.id)
    // the way in with Reduce Motion (steady taps), then motion on for the handoff itself
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.getByRole('button', { name: '‹ TODAY' }).tap()
    await expect(page).toHaveURL(/\/today/)
    const strip = page.locator('button.wm-live')
    const tabs = page.locator('nav.wm-tabs')
    await expect(strip).toBeAttached()
    const tabsAt = await tabs.boundingBox()
    // While the row flies the strip keeps its place, unseen; then it shows and the copy is gone.
    const stripAt = await strip.boundingBox()
    // the flight happens: a copy of the row is in the air while the strip waits unseen
    await expect(page.locator('.td-ghost')).toHaveCount(1, { timeout: 5000 })
    await expect(strip).not.toHaveClass(/is-awaiting/, { timeout: 8000 })
    await expect(page.locator('.td-ghost')).toHaveCount(0, { timeout: 3000 })
    await expect.poll(() => strip.evaluate(el => getComputedStyle(el).opacity)).toBe('1')
    await expect(todayRow(page, bag.id)).toHaveCount(0)
    // No jump: the strip and the tab bar stood still through it.
    expect(await strip.boundingBox()).toEqual(stripAt)
    expect(await tabs.boundingBox()).toEqual(tabsAt)

    // Finished: back on Today, the row lands in the list, done, with its ✓; no strip, no copy left.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await strip.tap()
    await expect(page).toHaveURL(new RegExp(`/session/${bag.id}`))
    const x = page.getByRole('button', { name: 'End. Hold for 1.5 seconds.' })
    await x.focus()
    await page.keyboard.press('Enter')
    const close = page.getByRole('button', { name: 'CLOSE SESSION' })
    await expect(close).toBeVisible({ timeout: 10_000 })
    // motion on again for the landing (the moment, then Today)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(async () => {
      if (await close.isVisible()) await close.tap({ force: true })
      await expect(page).toHaveURL(/\/today/, { timeout: 3000 })
    }).toPass({ timeout: 30_000 })
    const row = todayRow(page, bag.id)
    // the moment plays first (motion on); a tap goes on, as a thumb would
    const moment = page.getByRole('button', { name: /Tap to go on\.$/ })
    await expect(async () => {
      if (await moment.isVisible()) await moment.tap({ force: true })
      await expect(row).toBeAttached({ timeout: 2000 })
    }).toPass({ timeout: 30_000 })
    await expect(row).toHaveClass(/is-done/)
    // (the landing's copy flies within the first second; it is gone once the row shows)
    await expect(page.locator('.td-ghost')).toHaveCount(0, { timeout: 5000 })
    await expect.poll(() => row.evaluate(el => getComputedStyle(el).visibility)).toBe('visible')
    await expect(strip).toHaveCount(0)
  })
})
