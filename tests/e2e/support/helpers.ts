import { expect, type Page, type Locator } from '@playwright/test'
import type { Api } from '../fixtures'

/** The athlete's local day (the browser runs in the same timezone as Node). */
export function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return todayISO(d)
}

/**
 * Environment shims, installed before the app loads:
 * - Playwright's Windows WebKit build ships without Web Audio. The app's web
 *   fallback for timer bells (src/lib/sounds.ts) calls `new AudioContext()`
 *   unguarded, so a silent stand-in keeps the session alive. On iOS the native
 *   WaymarkAudio plugin plays the bells; this never runs there.
 */
export async function installShims(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    if (typeof w.AudioContext === 'undefined') {
      class SilentParam { setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} }
      class SilentNode { gain = new SilentParam(); frequency = new SilentParam(); type = 'sine'; connect() {} start() {} stop() {} }
      class SilentAudioContext {
        state = 'running'; currentTime = 0; destination = {}
        resume() { return Promise.resolve() }
        createOscillator() { return new SilentNode() }
        createGain() { return new SilentNode() }
      }
      w.AudioContext = SilentAudioContext
      w.__e2eAudioShim = true
    }
  })
}

/** Today, without the auto-resume into an in-progress session. */
export async function gotoToday(page: Page) {
  await page.goto('/today?resume=0')
  await expect(page.getByRole('button', { name: '+ add session' })).toBeVisible({ timeout: 20_000 })
}

/** A row on Today's board by session id. */
export function todayRow(page: Page, id: string): Locator {
  return page.locator(`.td-row[data-sid="${id}"]`)
}

/** Tap a row open, then ENTER (the real path into a session). */
export async function enterFromToday(page: Page, id: string) {
  await gotoToday(page)
  const row = todayRow(page, id)
  await row.locator('[role=button]').first().tap()
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

/** Metric units the athlete should never see (he reads lb and miles). */
export const METRIC_UNIT = /(?:^|[^a-z])(kg|kgs|km|kms|kilograms?|kilometers?|kilometres?)(?![a-z])/i

export async function metricOffenders(page: Page): Promise<string[]> {
  return (await visibleWords(page)).filter(w => METRIC_UNIT.test(w))
}

/** The grass under a timer (tap: pause; swipe up: skip). */
export function grass(page: Page): Locator {
  return page.getByRole('button', { name: /^Timer\. Tap to pause/ })
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
 * Through a mobility / Zone 2 warm-up: START a timed hold then swipe the grass
 * up to skip it, DONE a rep exercise, wait out the BREATHE beat. Stops when
 * `done()` says so.
 */
export async function throughWarmup(page: Page, done: () => Promise<boolean>, max = 40) {
  for (let i = 0; i < max; i++) {
    if (await done()) return
    if (await page.getByRole('status', { name: /^Breathe/ }).isVisible()) { await page.clock.fastForward(3500); continue }
    const start = page.getByRole('button', { name: 'START', exact: true })
    const finished = page.getByRole('button', { name: 'DONE', exact: true })
    if (await start.isVisible()) { await start.tap(); await swipeUpGrass(page); continue }
    if (await finished.isVisible()) { await finished.tap(); continue }
    if (await grass(page).isVisible()) { await swipeUpGrass(page); continue }
    await page.waitForTimeout(250)
  }
  throw new Error('warm-up never finished')
}
