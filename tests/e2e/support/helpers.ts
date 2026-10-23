import { expect, type Page, type Locator } from '@playwright/test'
import type { Api } from '../fixtures'

/** The athlete's local day (Node and the browser both run in E2E_TIMEZONE, playwright.config.ts). */
export function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return todayISO(d)
}

/** Today, without the auto-resume into an in-progress session. */
export async function gotoToday(page: Page) {
  await page.goto('/today?resume=0')
  // The check-in cards come back on every open until all nine are in (approved 2026-10-19):
  // a spec run on its own may meet them first. Close them (they keep what was answered).
  const add = page.getByRole('button', { name: '+ add session' })
  const deck = page.getByRole('dialog', { name: 'Morning check-in' })
  await expect(add.or(deck).first()).toBeVisible({ timeout: 20_000 })
  if (await deck.isVisible()) await deck.getByRole('button', { name: 'Close', exact: true }).tap()
  await expect(add).toBeVisible({ timeout: 20_000 })
  // the splash lies over the app until it ends: a raw mouse press (a hold) would land on it, not on a row
  await expect(page.locator('.wm-splash')).toHaveCount(0, { timeout: 20_000 })
}

/** A row on Today's board by session id. */
export function todayRow(page: Page, id: string): Locator {
  return page.locator(`.td-row[data-sid="${id}"]`)
}

/** Opens a Today row (Today opens the first session to do by itself; a second tap would close it). */
export async function openRow(row: Locator) {
  const hit = row.locator('[role=button]').first()
  await expect(hit).toBeVisible()
  // Today may open it by itself a beat after the board draws, racing a tap: settle, then retry.
  await expect(async () => {
    if ((await hit.getAttribute('aria-expanded')) !== 'true') await hit.tap()
    await expect(hit).toHaveAttribute('aria-expanded', 'true', { timeout: 1500 })
  }).toPass({ timeout: 10_000 })
}

/**
 * Taps the Waybook line once Today has stopped moving. The line sits just above
 * SETTINGS; a board settling while the tap scrolls can drop the tap onto SETTINGS.
 */
export async function tapWaybookLine(page: Page) {
  const line = page.locator('button.td-wline')
  await line.evaluate(el => el.scrollIntoView({ block: 'center' }))
  let last = ''
  await expect(async () => {
    const box = JSON.stringify(await line.boundingBox())
    const same = box === last
    last = box
    expect(same).toBe(true)
  }).toPass({ intervals: [250], timeout: 10_000 })
  await line.tap()
  await expect(page).toHaveURL(/\/today/)
  return line
}

/** Tap a row open, then ENTER (the real path into a session). */
export async function enterFromToday(page: Page, id: string) {
  await gotoToday(page)
  const row = todayRow(page, id)
  await openRow(row)
  await row.getByRole('button', { name: 'ENTER' }).tap()
  await expect(page).toHaveURL(new RegExp(`/session/${id}`))
}

export async function insertSession(api: Api, type: string, timeSlot: 'am' | 'pm' = 'pm', extra: Record<string, unknown> = {}) {
  const today = todayISO()
  return api.post<{ id: string; label: string | null; type: string }>('/api/sessions/insert-ad-hoc', { type, timeSlot, date: today, today, ...extra })
}

/** Seconds left on the visible timer face (its accessible name: "2 minutes 0 seconds"). */
export async function timerSeconds(page: Page): Promise<number> {
  const name = (await page.getByRole('timer').first().getAttribute('aria-label')) ?? ''
  const m = /(-?\d+) minutes? (\d+) seconds?/.exec(name)
  if (!m) throw new Error(`timer label not understood: "${name}"`)
  const min = Number(m[1])
  return min * 60 + Math.sign(min || 1) * Number(m[2])
}

/**
 * Every word a person can read on screen: plain text nodes, plus the flap
 * labels' aria-labels (a FlapLabel draws one tile per letter, so its text
 * nodes are single letters; the label carries the word).
 */
export async function visibleWords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect?.()
      const cs = getComputedStyle(el)
      return !!r && r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0
    }
    document.querySelectorAll('[role="img"][aria-label]').forEach(el => { if (visible(el)) out.push(el.getAttribute('aria-label') ?? '') })
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = walker.nextNode())) {
      const text = n.textContent?.trim()
      const el = n.parentElement
      if (!text || !el || el.closest('[role="img"][aria-label], script, style')) continue
      if (visible(el)) out.push(text)
    }
    document.querySelectorAll('input, textarea').forEach(el => {
      const i = el as HTMLInputElement
      if (visible(i)) out.push(i.placeholder ?? '', i.value ?? '')
    })
    return out.filter(Boolean)
  })
}

/**
 * Units the athlete should never see. Weights read in lb (never kg), short
 * distances (form cues) in inches (never cm or mm), and run distance and pace
 * always in km (never miles): km is right, so it is not on this list.
 */
export const WRONG_UNIT = /(?:^|[^a-z])(kg|kgs|kilograms?|cm|mm|centimet(?:er|re)s?|millimet(?:er|re)s?|mi|miles?)(?![a-z])/i

export async function metricOffenders(page: Page): Promise<string[]> {
  return (await visibleWords(page)).filter(w => WRONG_UNIT.test(w))
}

/** The grass under a running timer (tap: pause; swipe up: skip). */
export function grass(page: Page): Locator {
  return page.getByRole('button', { name: /^Timer\. Tap to pause/ })
}

/** The grass under a timer that hasn't started (page 71: no START button; the grass starts it). */
export function grassToStart(page: Page): Locator {
  return page.getByRole('button', { name: 'Timer. Tap to start.', exact: true })
}

/** The grass while paused (page 71: PAUSED · TAP TO GO ON). */
export function grassPaused(page: Page): Locator {
  return page.getByRole('button', { name: /^Timer paused\. Tap to go on/ })
}

/** Page 71: tap the grass to start a timed step (holds, rounds, the warm-up). */
export async function tapGrassToStart(page: Page) {
  const g = grassToStart(page)
  await expect(g).toBeVisible()
  await g.tap()
  await expect(grass(page)).toBeVisible()
}

/** A finger drag up the grass, far enough to pull it all the way: skips the phase. */
export async function swipeUpGrass(page: Page) {
  const box = await grass(page).boundingBox()
  if (!box) throw new Error('no grass to swipe')
  const x = box.x + box.width / 2
  const y0 = box.y + box.height - 4
  await page.mouse.move(x, y0)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y0 - (box.height * 0.7 * i) / 8)
  await page.mouse.up()
}

/**
 * Through a mobility / Zone 2 warm-up: tap the grass to start a timed hold
 * (page 71) then swipe it up to skip it, DONE a rep exercise, wait out the
 * BREATHE beat. Stops when `done()` says so.
 */
export async function throughWarmup(page: Page, done: () => Promise<boolean>, max = 40) {
  for (let i = 0; i < max; i++) {
    if (await done()) return
    if (await page.getByRole('status', { name: /^Breathe/ }).isVisible()) { await page.clock.fastForward(3500); continue }
    const start = grassToStart(page)
    const finished = page.getByRole('button', { name: 'DONE', exact: true })
    if (await start.isVisible()) { await start.tap(); await expect(grass(page)).toBeVisible(); await swipeUpGrass(page); continue }
    if (await finished.isVisible()) { await finished.tap(); continue }
    if (await grass(page).isVisible()) { await swipeUpGrass(page); continue }
    await page.waitForTimeout(250)
  }
  throw new Error('warm-up never finished')
}

/** Hold a session row for the command window (page 73: 500 ms; the click after a hold is eaten). */
export async function holdRow(page: Page, row: Locator) {
  const hit = row.locator('[role=button]').first()
  // nothing over the row: the splash takes a raw press for its own hold
  await expect(page.locator('.wm-splash')).toHaveCount(0, { timeout: 20_000 })
  await hit.scrollIntoViewIfNeeded()
  const b = (await hit.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  const cmd = page.locator('.pl-cmd')
  await expect(cmd).toBeVisible()
  return cmd
}

/** Program's day row for an epoch day (the planner, page 73). */
export function dayRow(page: Page, epochDay: number): Locator {
  return page.locator(`.pg-dr[data-day="${epochDay}"]`)
}

/** Opens a day on Program (one at a time). */
export async function openDay(page: Page, epochDay: number) {
  const row = dayRow(page, epochDay)
  await expect(row).toBeVisible({ timeout: 20_000 })
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.tap()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
}

/** The athlete's local day as an epoch day. */
export function epochOf(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000)
}
