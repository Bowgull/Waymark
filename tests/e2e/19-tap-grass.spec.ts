import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { enterFromToday, epochOf, gotoToday, grass, grassPaused, grassToStart, insertSession, openDay, todayISO, todayRow, swipeUpGrass } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * Page 71 (approved 2026-10-21, all five items): the grass starts and pauses a
 * timed step (no START button; TAP THE GRASS TO START boxed mid-grass the first
 * time on this phone, then the quiet TAP TO START line; TAP · PAUSE; PAUSED ·
 * TAP TO GO ON); rep steps keep DONE and have no grass; the × still only ends
 * on a hold. A running session shows once: as the live strip, not a row on
 * Today (the first row still to do opens instead), and on Program its row
 * opens to its lines with no RESUME (page 73). Today opens nothing by itself (page 98). Done, it is back in Today's list with ✓.
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
  // The clock stays where it is. Page 84: no END EARLY, ever (a swipe up the grass moves on).
  await expect(page.getByRole('timer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'END EARLY' })).toHaveCount(0)

  // Tap: it runs. The quiet TAP · PAUSE at the foot; still no END EARLY.
  await grassToStart(page).tap()
  await expect(grass(page)).toBeVisible()
  await expect(page.getByRole('img', { name: 'HOLD', exact: true })).toBeVisible()
  await expect(hint(page)).toHaveText('TAP · PAUSE')
  await expect(hint(page)).not.toHaveClass(/is-mid/)
  await expect(page.getByRole('button', { name: 'END EARLY' })).toHaveCount(0)

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
  await expect(page.getByRole('button', { name: 'End. Hold for 3 seconds.' })).toBeVisible()

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

/** Page 74: hold the × (a press held past its 3 s, as a thumb would), then let go. */
async function holdX(page: Page) {
  const box = (await page.getByRole('button', { name: 'End. Hold for 3 seconds.' }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(3300)
  await page.mouse.up()
}

/** Into a bag round, working (the warm-up and the round both start on the grass). */
async function intoRound(page: Page, id: string) {
  await enterFromToday(page, id)
  const begin = page.getByRole('button', { name: /^(BEGIN SESSION|BEGIN|START BAG WORK)$/ })
  const round1 = page.getByRole('img', { name: /^Round 1 of \d+$/ })
  const warmUp = page.getByRole('img', { name: 'SKIP ROPE', exact: true })
  for (let i = 0; i < 8 && !(await round1.isVisible()); i++) {
    if (await begin.first().isVisible()) await begin.first().tap()
    else if (await warmUp.isVisible() && await grassToStart(page).isVisible()) await grassToStart(page).tap()
    // page 84: no SKIP WARM UP button; a swipe up the grass moves on
    else if (await warmUp.isVisible() && await grass(page).isVisible()) await swipeUpGrass(page)
    else await page.waitForTimeout(500)
  }
  await grassToStart(page).tap()
  await expect(page.getByRole('img', { name: 'FIGHT', exact: true })).toBeVisible()
}

test('Items 4-5: a running session is only the strip; Today opens nothing by itself; Program opens its lines, no RESUME; done, back with ✓', async ({ page, api }) => {
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
  // Page 98: Today loads clean, nothing opens by itself.
  const firstToDo = page.locator('.td-row:not(.is-done):not(.is-skip):not(.is-missed)').first()
  await expect(firstToDo.locator('.td-rowhit')).toHaveAttribute('aria-expanded', 'false')

  // A fresh Today (a new open, no auto-resume): still nothing open, and no row for the running one.
  await gotoToday(page)
  await expect(strip).toBeVisible()
  await expect(todayRow(page, bag.id)).toHaveCount(0)
  await expect(page.locator('.td-row .td-rowhit[aria-expanded="true"]')).toHaveCount(0)

  // Program (page 73): today's day opens; the running session's row opens to its lines, with no RESUME or ENTER.
  await page.getByRole('link', { name: 'program' }).tap()
  await expect(page.getByRole('tablist', { name: 'Weeks' })).toBeVisible({ timeout: 20_000 })
  await openDay(page, epochOf(todayISO()))
  const prow = page.locator(`.pl-row[data-sid="${bag.id}"]`)
  await expect(prow).toBeVisible()
  await prow.locator('.pl-hit').tap()
  await expect(prow.locator('.pl-hit')).toHaveAttribute('aria-expanded', 'true')
  await expect(prow.locator('.pl-ol, .pl-lg').first()).toBeVisible()
  await expect(prow.getByRole('button', { name: /RESUME|ENTER/ })).toHaveCount(0)
  // Still in Program: opening the row never jumped into the session.
  await expect(page).toHaveURL(/\/program/)

  // The strip is the way back in. End it (hold × 3 s, END AND LOG), close it: back in Today's list with ✓.
  await strip.tap()
  await expect(page).toHaveURL(new RegExp(`/session/${bag.id}`))
  const x = page.getByRole('button', { name: 'End. Hold for 3 seconds.' })
  const closeWin = page.getByRole('dialog', { name: /: end$/ })
  // Page 74: a tap on the × does nothing; it only opens on a 3 s hold.
  await x.tap()
  await page.waitForTimeout(400)
  await expect(closeWin).toHaveCount(0)
  // Held 3 s: the close window, END AND LOG and DISCARD. A tap outside: back in the session as it was.
  await holdX(page)
  await expect(closeWin).toBeVisible()
  await expect(closeWin.getByRole('button', { name: 'END AND LOG', exact: true })).toBeVisible()
  await expect(closeWin.getByRole('button', { name: 'DISCARD', exact: true })).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(closeWin).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/session/${bag.id}`))
  // Held again: END AND LOG goes to the close.
  await holdX(page)
  await closeWin.getByRole('button', { name: 'END AND LOG', exact: true }).tap()
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
    // motion on, on the runner's software WebGL: the session, the moment and Today each take their time
    test.slow()
    const bag = await insertSession(api, 'bag_work', 'pm')
    await intoRound(page, bag.id)
    // the way in with Reduce Motion (steady taps), then motion on for the handoff itself
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    // the copy flies for about a second: watch for it rather than poll for it
    await page.evaluate(() => {
      const w = window as unknown as { __ghostSeen: boolean }
      w.__ghostSeen = false
      new MutationObserver((ms, obs) => {
        if (ms.some(m => [...m.addedNodes].some(n => n instanceof Element && n.classList.contains('td-ghost')))) { w.__ghostSeen = true; obs.disconnect() }
      }).observe(document.body, { childList: true })
    })
    await page.getByRole('button', { name: '‹ TODAY' }).tap()
    await expect(page).toHaveURL(/\/today/)
    const strip = page.locator('button.wm-live')
    const tabs = page.locator('nav.wm-tabs')
    await expect(strip).toBeAttached()
    const tabsAt = await tabs.boundingBox()
    // While the row flies the strip keeps its place, unseen; then it shows and the copy is gone.
    const stripAt = await strip.boundingBox()
    // the flight happens: a copy of the row is in the air while the strip waits unseen
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ghostSeen: boolean }).__ghostSeen), { timeout: 15_000 }).toBe(true)
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
    // page 74: hold the × 3 s, then END AND LOG in the close window
    await holdX(page)
    await page.getByRole('dialog', { name: /: end$/ }).getByRole('button', { name: 'END AND LOG', exact: true }).tap()
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
