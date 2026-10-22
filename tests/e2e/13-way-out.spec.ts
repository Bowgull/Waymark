import { test, expect } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { enterFromToday, gotoToday, grassToStart, insertSession, tapWaybookLine, todayRow } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'
import { mockWeather } from './support/weather'

/**
 * Page 61 (approved 2026-10-19, all items): one way out of every board (tap
 * outside, pull it down by its brass line, CLOSE, Escape, the edge swipe),
 * typed words kept as a draft, and stepping out of a session and back
 * (‹ TODAY, the live strip; a reload lands on BACK IN YOUR SESSION, paused
 * where it was). Page 71: the running session shows once, as the strip.
 */

// A morning already checked in: otherwise the check-in cards open first (they come back until all nine are in).
test.beforeAll(async ({ request }) => {
  await setMorning(makeApiFor(request))
})
test.describe.configure({ mode: 'serial' })

/** The weather board on Today (page 72): + add opens a command window now, so the board under test is this one. */
async function openWeather(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^Weather:/ }).tap()
  const board = page.getByRole('dialog', { name: 'The weather, the next hours' })
  await expect(board).toBeVisible()
  return board
}

/** The iOS edge swipe: a touch from the left edge, travelling right. */
async function edgeSwipe(page: Page) {
  await page.evaluate(() => {
    const ev = (type: string, x: number) => {
      const e = new Event(type, { bubbles: true }) as Event & { touches: unknown; changedTouches: unknown }
      const t = [{ clientX: x, clientY: 400 }]
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : t })
      Object.defineProperty(e, 'changedTouches', { value: t })
      window.dispatchEvent(e)
    }
    ev('touchstart', 6)
    ev('touchend', 140)
  })
}

test('Every board closes the same ways: CLOSE, tap outside, pull it down, Escape, the edge swipe', async ({ page, context }) => {
  await mockWeather(page, context)
  await gotoToday(page)
  await expect(page.getByRole('button', { name: /^Weather:/ })).toBeVisible({ timeout: 20_000 })

  // CLOSE: one gold word, top right. No Cancel.
  let board = await openWeather(page)
  await expect(board.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
  await board.getByRole('button', { name: 'CLOSE', exact: true }).tap()
  await expect(board).toBeHidden()

  // A tap on the dim forest around it.
  board = await openWeather(page)
  await page.mouse.click(8, 8)
  await expect(board).toBeHidden()

  // Pulled down, past 70 px: closed. Less: it settles back.
  board = await openWeather(page)
  const pull = async (dy: number) => {
    const b = (await board.locator('.nowr').boundingBox())!
    const x = b.x + b.width / 2
    const y = b.y + b.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + (dy * i) / 8)
    await page.mouse.up()
  }
  await pull(40)
  await expect(board).toBeVisible()
  await expect(board).not.toHaveAttribute('style', /translateY/)
  await pull(130)
  await expect(board).toBeHidden()

  // Escape on the web.
  board = await openWeather(page)
  await page.keyboard.press('Escape')
  await expect(board).toBeHidden()

  // The swipe in from the left edge.
  board = await openWeather(page)
  await edgeSwipe(page)
  await expect(board).toBeHidden()
})

test('A page you went into goes back with the edge swipe (a Library group)', async ({ page }) => {
  await page.goto('/library')
  await page.getByRole('button', { name: 'strength' }).tap()
  await expect(page).toHaveURL(/open=strength/)
  await expect(page.locator('.lib-bd.is-open')).toBeVisible()
  await page.waitForTimeout(300)
  await edgeSwipe(page)
  await expect(page).not.toHaveURL(/open=strength/)
  await expect(page.getByRole('button', { name: 'waybook' })).toBeVisible()
})

test('The Waybook box: CLOSE and tap outside fold it; the words are kept as a DRAFT, never shown on the line', async ({ page }) => {
  await gotoToday(page)
  const line = await tapWaybookLine(page)
  const box = page.getByRole('textbox', { name: 'Waybook entry' })
  await box.fill('Knee felt fine on the stairs today.')

  // A tap outside folds it; the line says DRAFT, not the words.
  await page.locator('.wm-scene-window').click()
  await expect(box).toBeHidden()
  await expect(line.getByRole('img', { name: 'DRAFT' })).toBeVisible()
  await expect(page.getByText('Knee felt fine on the stairs today.')).toHaveCount(0)

  // Back: the words are there. CLOSE folds it the same way.
  await tapWaybookLine(page)
  await expect(box).toHaveValue('Knee felt fine on the stairs today.')
  await page.locator('.td-wb').getByRole('button', { name: 'Close', exact: true }).tap()
  await expect(box).toBeHidden()

  // Even after the app is reloaded.
  await page.reload()
  await expect(page.locator('button.td-wline').getByRole('img', { name: 'DRAFT' })).toBeVisible({ timeout: 20_000 })
  await tapWaybookLine(page)
  await expect(page.getByRole('textbox', { name: 'Waybook entry' })).toHaveValue('Knee felt fine on the stairs today.')
  await page.getByRole('button', { name: 'SAVE', exact: true }).tap()
  await expect(page.getByText('Saved to the Waybook.')).toBeVisible()
  await page.locator('.wm-scene-window').click()
  await expect(page.locator('button.td-wline').getByRole('img', { name: 'DRAFT' })).toHaveCount(0)
})

/** Into a bag round, working. */
async function intoRound(page: Page, id: string) {
  await enterFromToday(page, id)
  const begin = page.getByRole('button', { name: /^(BEGIN SESSION|BEGIN|START BAG WORK|SKIP WARM UP)$/ })
  const round1 = page.getByRole('img', { name: /^Round 1 of \d+$/ })
  const warmUp = page.getByRole('img', { name: 'SKIP ROPE', exact: true })
  // the skip-rope warm-up and the round both start on the grass (page 71)
  for (let i = 0; i < 6 && !(await round1.isVisible()); i++) {
    if (await begin.first().isVisible()) await begin.first().tap()
    else if (await warmUp.isVisible() && await grassToStart(page).isVisible()) await grassToStart(page).tap()
    else await page.waitForTimeout(500)
  }
  await grassToStart(page).tap()
  await expect(page.getByRole('img', { name: 'FIGHT', exact: true })).toBeVisible()
}

test('Step out with ‹ TODAY: the live strip, not a row; Today never pulls you back; one tap back in', async ({ page, api }) => {
  const bag = await insertSession(api, 'bag_work')
  await intoRound(page, bag.id)
  // The bag preview's tap outside never leaves a session (checked by getting here).

  await page.getByRole('button', { name: '‹ TODAY' }).tap()
  await expect(page).toHaveURL(/\/today/)

  // The strip above the tabs: the session, its round and phase, the clock ticking in true time.
  const strip = page.locator('button.wm-live')
  await expect(strip).toBeVisible()
  await expect(strip).toHaveAttribute('aria-label', /^BAG WORK, Round 1 of \d+ · work, \d+:\d\d\. Back into the session\.$/)
  const before = await strip.getAttribute('aria-label')
  await page.clock.fastForward(5_000)
  await expect(strip).not.toHaveAttribute('aria-label', before!)

  // Page 71: the running session is not a row on Today; the strip is the way back.
  await expect(todayRow(page, bag.id)).toHaveCount(0)

  // Today stays put, minutes later too.
  await page.clock.fastForward(130_000)
  await expect(page).toHaveURL(/\/today/)

  // On every tab.
  await page.getByRole('link', { name: 'library' }).tap()
  await expect(strip).toBeVisible()

  // One tap: back in, still working, the clock moved on.
  await strip.tap()
  await expect(page).toHaveURL(new RegExp(`/session/${bag.id}`))
  await expect(page.getByRole('img', { name: /^(FIGHT|FINISH|REST|READY)$/ }).first()).toBeVisible()
})

test('Relaunch (a reload): BACK IN YOUR SESSION, paused where it was; RESUME, or END AND LOG IT', async ({ page, api }) => {
  const bag = await insertSession(api, 'bag_work')
  await intoRound(page, bag.id)

  await page.reload()
  const back = page.getByRole('img', { name: 'BACK IN YOUR SESSION' })
  await expect(back).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/^Waymark closed in round 1\. It's paused where you were\. Nothing is lost\.$/)).toBeVisible()
  await expect(page.getByText('SAVED ON THE PHONE')).toBeVisible()
  await expect(page.getByText(/^ROUND 1$/)).toBeVisible()
  await expect(page.getByText(/^\d+:\d\d LEFT$/)).toBeVisible()

  await page.getByRole('button', { name: 'RESUME', exact: true }).tap()
  await expect(back).toBeHidden()
  // paused where it was: the timer waits for a tap
  await expect(page.getByRole('status').getByRole('img', { name: 'PAUSED' })).toBeAttached()

  // Again, and this time end it: the close, never thrown away.
  await page.reload()
  await expect(back).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'END AND LOG IT', exact: true }).tap()
  await expect(page.getByRole('button', { name: 'CLOSE SESSION' })).toBeVisible()
})

test('Hold × only ends: to the close; ‹ TODAY top left steps out', async ({ page, api }) => {
  const bag = await insertSession(api, 'bag_work')
  await intoRound(page, bag.id)
  const x = page.getByRole('button', { name: 'End. Hold for 1.5 seconds.' })
  const back = page.getByRole('button', { name: '‹ TODAY' })
  const xb = (await x.boundingBox())!
  const bb = (await back.boundingBox())!
  expect(bb.x).toBeLessThan(xb.x)
  const vw = page.viewportSize()!.width
  expect(xb.x).toBeGreaterThan(vw / 2)
  await x.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'CLOSE SESSION' })).toBeVisible({ timeout: 10_000 })
})
