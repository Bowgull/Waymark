import { test, expect } from './fixtures'
import { addDaysISO, gotoToday, todayISO } from './support/helpers'
import { GOOD_MORNING, setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * The Ledger (approved 2026-10-19):
 * - page 62 B, Herb: the last 28 mornings as bars in one neutral tone, the
 *   dashed brass 28-day average, the 7-day average on the flap, and the one
 *   sleep line from his own check-ins; right after Sleep + soreness.
 * - page 77 A (approved 2026-10-23): under the toggle and the rings, one
 *   closed line per board (its real header and headline); a tap opens that
 *   exact board in place, one at a time; a tap on it again, outside, or Escape
 *   closes it; the opened line snaps up under the header; lines start closed
 *   each visit.
 * - page 79 (approved 2026-10-23): the list is Next block, Running, Fight,
 *   Strength, Sleep + soreness, Herb (no Body board). Next block in plain words (Showing
 *   up, Running base, Lifting, Back; "N OF 4 DONE"; tap a part for its line).
 */
test.describe.configure({ mode: 'serial' })

// The mockup's 28 mornings, oldest first, ending today.
const HERB = [4, 5, 3, 6, 7, 5, 4, 5, 6, 4, 7, 8, 6, 5, 6, 5, 7, 8, 6, 7, 5, 6, 7, 5, 8, 9, 7, 6]
const SLEEP = [7.6, 7.1, 7.8, 6.9, 6.5, 7.4, 7.7, 7.3, 6.9, 7.6, 6.4, 6.2, 7.0, 7.5, 6.8, 7.2, 6.5, 6.3, 7.0, 6.6, 7.4, 7.2, 6.8, 7.5, 6.1, 7.9, 7.4, 6.6]

test.beforeAll(async ({ request }) => {
  const api = makeApiFor(request)
  const today = todayISO()
  for (let i = 0; i < 27; i++) {
    await api.post('/api/daily-logs', { date: addDaysISO(today, i - 27), herbScale: HERB[i], sleepHours: SLEEP[i], partial: true })
  }
  await setMorning(api, { ...GOOD_MORNING, herbScale: HERB[27], sleepHours: SLEEP[27] })
})

async function openLedger(page: import('@playwright/test').Page) {
  await gotoToday(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'ledger' }).tap()
  await expect(page).toHaveURL(/\/history$/)
}

const line = (page: import('@playwright/test').Page, key: string) => page.locator(`.wm-pane:not([style*="display: none"]) button.cl-line[data-line="${key}"]`)

/** Lines start closed: open one (page 77 A). */
async function openLine(page: import('@playwright/test').Page, key: string) {
  const l = line(page, key)
  await l.tap()
  await expect(l).toHaveAttribute('aria-expanded', 'true')
  return l
}

test('Herb: 28 mornings, the averages, and the sleep line (page 62 B)', async ({ page }) => {
  await openLedger(page)
  // the line carries the board's head: the name and the 7-day average
  await expect(line(page, 'herb').getByRole('img', { name: '6.9 AVG' })).toBeVisible()
  await openLine(page, 'herb')
  const herb = page.locator('section.lg-herb')
  await herb.scrollIntoViewIfNeeded()
  await expect(herb.locator('rect')).toHaveCount(28)
  // one neutral tone: the last 7 bright, the 3 weeks before dim; no good/bad colours
  const fills = await herb.locator('rect').evaluateAll(rs => [...new Set(rs.map(r => r.getAttribute('fill')))])
  expect(fills.sort()).toEqual(['#5d6863', '#cfd9d2'])
  await expect(herb.getByText('28-day average 6.0')).toBeVisible()
  await expect(herb.getByText('On the 10 mornings above your 28-day average (6.0), you slept 6.7 h. On the other 18, 7.3 h.')).toBeVisible()
  await expect(herb.getByText('From your last 28 check-ins.')).toBeVisible()
  await expect(herb).toHaveScreenshot('ledger-herb.png', { mask: [herb.locator('text.lg-hbd')] })

  // page 79's order: Herb right after Sleep + soreness, last; no Body line
  const order = await page.locator('.wm-pane:not([style*="display: none"]) .cl-line .cl-head > span:first-child').allTextContents()
  expect(order.map(x => x.trim())).toEqual(['Next block', 'Running', 'Fight', 'Strength', 'Sleep + soreness', 'Herb'])
})

test('Lines (page 77 A): closed each visit; one open at a time; tap again, outside or Escape closes; the open line snaps under the header', async ({ page }) => {
  await openLedger(page)
  const lines = page.locator('.wm-pane:not([style*="display: none"]) button.cl-line')
  await expect(lines).toHaveCount(6)
  for (const l of await lines.all()) await expect(l).toHaveAttribute('aria-expanded', 'false')
  // the rings and the toggle stay on top
  await expect(page.getByRole('region', { name: /^This week:/ })).toBeVisible()

  // one open at a time
  await openLine(page, 'running')
  await openLine(page, 'fight')
  await expect(line(page, 'running')).toHaveAttribute('aria-expanded', 'false')
  // snapped: the open line sits just under the header
  const hd = (await page.locator('.wm-pane:not([style*="display: none"]) .wm-scene-hd').boundingBox())!
  await expect.poll(async () => Math.round((await line(page, 'fight').boundingBox())!.y - (hd.y + hd.height))).toBeLessThanOrEqual(12)
  // tap it again
  await line(page, 'fight').tap()
  await expect(line(page, 'fight')).toHaveAttribute('aria-expanded', 'false')
  // even the last line snaps to the top (the list makes room below)
  await line(page, 'herb').tap()
  await expect(line(page, 'herb')).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => Math.round((await line(page, 'herb').boundingBox())!.y - (hd.y + hd.height))).toBeLessThanOrEqual(12)
  // tap outside
  await page.touchscreen.tap(hd.x + hd.width - 8, hd.y + hd.height / 2)
  await expect(line(page, 'herb')).toHaveAttribute('aria-expanded', 'false')
  // Escape
  await openLine(page, 'strength')
  await page.keyboard.press('Escape')
  await expect(line(page, 'strength')).toHaveAttribute('aria-expanded', 'false')

  // closed again on the next visit
  await openLine(page, 'running')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'today' }).tap()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'ledger' }).tap()
  await expect(page).toHaveURL(/\/history$/)
  await expect(line(page, 'running')).toHaveAttribute('aria-expanded', 'false')
})

test('Goal boards (page 79): Running leads with the 5K and the 22:00 goal; Fight and Strength say where he is, honestly', async ({ page }) => {
  await openLedger(page)
  // Running: the 5K headline (a test time, or when the first test is)
  await expect(line(page, 'running').getByRole('img', { name: /^5K (\d+:\d\d|FIRST TEST WK \d+)$/ })).toBeVisible()
  await openLine(page, 'running')
  const run = page.locator('.cl-panel[aria-hidden="false"] section')
  await expect(run.getByText('22:00 GOAL')).toBeVisible()
  await expect(run.getByText(/^Easy runs · pace at heart \d+$/)).toBeVisible()
  expect(await run.innerText()).not.toMatch(/140 bpm|@140/)
  // Fight: bag rounds this week on the line
  await expect(line(page, 'fight').getByRole('img', { name: /^\d+ ROUNDS?$/ })).toBeVisible()
  await openLine(page, 'fight')
  await expect(page.locator('.cl-panel[aria-hidden="false"]').getByText('Bag rounds · each week')).toBeVisible()
  await expect(page.locator('.cl-panel[aria-hidden="false"] .fx-k').first()).toHaveText(/^MT classes/)
  // Strength since you started
  await expect(line(page, 'strength').getByRole('img', { name: /^(FROM TODAY|WEEK 1 = 0|\d+ LIFTS? UP)$/ })).toBeVisible()
  // no Body board, no weigh-in prompt anywhere on the Ledger
  await expect(line(page, 'body')).toHaveCount(0)
  expect(await page.locator('.wm-pane:not([style*="display: none"])').innerText()).not.toMatch(/weigh/i)
  // his units only
  for (const k of ['running', 'fight', 'strength']) {
    await openLine(page, k)
    expect(await page.locator('.cl-panel[aria-hidden="false"]').innerText()).not.toMatch(/\bkg\b|\bmiles?\b/)
  }
})

test('Next block in plain words (page 79 §5): N OF 4 DONE, 4 x 6 tiles, Showing up / Running base / Lifting / Back, tap a part for its line', async ({ page }) => {
  await openLedger(page)
  const l = line(page, 'next')
  await expect(l.getByRole('img', { name: /^([0-4] OF 4 DONE|READY|\d+ DAY BREAK)$/ })).toBeVisible()
  await openLine(page, 'next')
  const board = page.locator('section.lg-meter-new')
  await expect(board).toBeVisible()
  await expect(board.locator('.track.lanes .lane')).toHaveCount(4)
  await expect(board.locator('.track.lanes .lg-tl')).toHaveCount(24)
  await expect(board.locator('.lg-lanek span')).toHaveText(['SHOWING UP', 'RUNNING BASE', 'LIFTING', 'BACK'])
  await expect(board.locator('.lg-bark.one')).toHaveText(/\w/)
  // copy rules (page 63): no percentages, "gate" or "pass line"; the old names are gone
  const text = await board.innerText()
  expect(text).not.toMatch(/%|gate|pass line|\bHABIT\b|\bENGINE\b/)
  expect(text).not.toMatch(/\bkg\b|\bmiles?\b/)
  // lit tiles agree with the parts: teal only for a part that is done (all six)
  for (const lane of await board.locator('.track.lanes .lane').all()) {
    const met = await lane.locator('.lg-tl.met').count()
    expect(met === 0 || met === 6).toBe(true)
  }
  // one part open at a time, each one plain line
  const parts = board.locator('button.nb-part')
  await expect(parts).toHaveCount(4)
  await expect(board.locator('button.nb-part[aria-expanded="true"]')).toHaveCount(1)
  await parts.nth(3).tap()
  await expect(parts.nth(3)).toHaveAttribute('aria-expanded', 'true')
  await expect(board.locator('button.nb-part[aria-expanded="true"]')).toHaveCount(1)
  await expect(parts.nth(3).locator('.nb-say')).toHaveText(/\w/)
  // a tap inside the board doesn't close its line
  await expect(l).toHaveAttribute('aria-expanded', 'true')
  await expect(board.getByText(/Fighter Block 1 starts/)).toBeVisible()
})
