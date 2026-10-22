import { test, expect } from './fixtures'
import { addDaysISO, gotoToday, todayISO } from './support/helpers'
import { GOOD_MORNING, setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * The Ledger (approved 2026-10-19):
 * - page 62 B, Herb: the last 28 mornings as bars in one neutral tone, the
 *   dashed brass 28-day average, the 7-day average on the flap, and the one
 *   sleep line from his own check-ins; right after Sleep + soreness.
 * - page 69 §5 option A, NEXT BLOCK (coach brain P4): page 63's board evolved in
 *   place, on the first screen between the week rings and Aerobic base;
 *   closed, a flap and one bar of 4 x 6 tiles (habit, engine, strength, back)
 *   with one line; a tap opens it in place (a group per part); it closes the
 *   page 61 ways.
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

test('Herb: 28 mornings, the averages, and the sleep line (page 62 B)', async ({ page }) => {
  await openLedger(page)
  const herb = page.locator('section.lg-herb')
  await herb.scrollIntoViewIfNeeded()
  await expect(herb.getByRole('img', { name: '6.9 AVG' })).toBeVisible()
  await expect(herb.locator('rect')).toHaveCount(28)
  // one neutral tone: the last 7 bright, the 3 weeks before dim; no good/bad colours
  const fills = await herb.locator('rect').evaluateAll(rs => [...new Set(rs.map(r => r.getAttribute('fill')))])
  expect(fills.sort()).toEqual(['#5d6863', '#cfd9d2'])
  await expect(herb.getByText('28-day average 6.0')).toBeVisible()
  await expect(herb.getByText('On the 10 mornings above your 28-day average (6.0), you slept 6.7 h. On the other 18, 7.3 h.')).toBeVisible()
  await expect(herb.getByText('From your last 28 check-ins.')).toBeVisible()
  await expect(herb).toHaveScreenshot('ledger-herb.png', { mask: [herb.locator('text.lg-hbd')] })

  // right after Sleep + soreness; no Body weight board (Josh, 2026-10-20)
  const order = await page.locator('section.lg-glass .lg-head > span:first-child').allTextContents()
  const at = (t: string) => order.findIndex(x => x.trim().toLowerCase() === t)
  expect(at('herb')).toBe(at('sleep + soreness') + 1)
  expect(at('body weight')).toBe(-1)
})

test('Next block: in the place of page 63; closed a flap, 4 x 6 tiles and one line; open one group per part; closes the page 61 ways (page 69 §5 A)', async ({ page }) => {
  await openLedger(page)
  const board = page.locator('section.lg-meter')
  await expect(board).toBeVisible()

  // Page 63's place: between the week rings and Aerobic base; page 63's own board and the old marks are gone.
  const heads = (await page.locator('section.lg-glass .lg-head > span:first-child, section.lg-glass .lg-label').allTextContents()).map(h => h.trim().toLowerCase())
  expect(heads.indexOf('next block')).toBeGreaterThan(-1)
  expect(heads.indexOf('next block')).toBeLessThan(heads.indexOf('aerobic base'))
  expect(heads).not.toContain('consistency')
  await expect(page.getByText(/D STREAK$/)).toHaveCount(0)
  await expect(page.locator('.lg-wbar')).toHaveCount(0)

  // Closed: one of the flap states; one bar of 4 x 6 flap tiles; the small part names; one line of what's left.
  await expect(board.getByRole('img', { name: /^(BUILDING|[1-4] OF 4 IN|READY|\d+ DAY BREAK)$/ })).toBeVisible()
  await expect(board.locator('.track.lanes .lane')).toHaveCount(4)
  await expect(board.locator('.track.lanes .lg-tl')).toHaveCount(24)
  await expect(board.locator('.lg-lanek span')).toHaveText(['HABIT', 'ENGINE', 'STRENGTH', 'BACK'])
  const line = board.locator('.lg-bark.one')
  await expect(line).toHaveText(/\w/)
  // Copy rules (page 63): no percentages, "gate" or "pass line" on the closed board; no separate marks row.
  const closed = (await board.locator('.lg-head, .lg-bar, .lg-lanek, .lg-bark').allInnerTexts()).join(' ')
  expect(closed).not.toMatch(/%|gate|pass line/i)
  await expect(board.locator('.lg-cdet')).toHaveAttribute('aria-hidden', 'true')
  // About page 63's height closed (one more short row for the part names).
  expect((await board.boundingBox())!.height).toBeLessThan(160)
  // Lit tiles agree with the parts: teal only for a part that is in (all six), brass while it builds.
  for (const lane of await board.locator('.track.lanes .lane').all()) {
    const met = await lane.locator('.lg-tl.met').count()
    expect(met === 0 || met === 6).toBe(true)
  }

  if (process.env.P4_SHOTS) {
    await board.evaluate(el => el.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${process.env.P4_SHOTS}/app-ledger-closed.png` })
  }
  // A tap opens it in place: one group per part with its tiles and one plain line; page 63's details inside Habit.
  await board.tap()
  await expect(board).toHaveAttribute('aria-expanded', 'true')
  for (const g of ['Habit', 'Engine', 'Strength', 'Back']) await expect(board.locator(`.lg-grp[data-part="${g.toLowerCase()}"] .gh`)).toContainText(g)
  await expect(board.locator('.lg-grp .gh .mini')).toHaveCount(4)
  await expect(board.locator('.lg-grp[data-part="habit"] .nb small')).toContainText(/Mornings \d+ of \d+, evenings \d+ of \d+/)
  await expect(board.getByText(/Fighter Block 1 starts/)).toBeVisible()
  // His units only.
  expect((await board.innerText())).not.toMatch(/\bkg\b|\bmiles?\b/)
  if (process.env.P4_SHOTS) {
    await page.waitForTimeout(600)
    await board.screenshot({ path: `${process.env.P4_SHOTS}/meter-open.png` })
  }

  // CLOSE
  await board.getByRole('button', { name: 'Close', exact: true }).tap()
  await expect(board).toHaveAttribute('aria-expanded', 'false')
  if (process.env.P4_SHOTS) {
    await page.waitForTimeout(800)
    await board.screenshot({ path: `${process.env.P4_SHOTS}/meter-closed.png` })
  }
  // tap again
  await board.tap()
  await expect(board).toHaveAttribute('aria-expanded', 'true')
  await board.tap({ position: { x: 20, y: 12 } })
  await expect(board).toHaveAttribute('aria-expanded', 'false')
  // tap outside
  await board.tap()
  await expect(board).toHaveAttribute('aria-expanded', 'true')
  const hd = (await page.locator('.lg-hd').boundingBox())!
  await page.touchscreen.tap(hd.x + hd.width - 8, hd.y + hd.height / 2)
  await expect(board).toHaveAttribute('aria-expanded', 'false')
  // Escape
  await board.tap()
  await page.keyboard.press('Escape')
  await expect(board).toHaveAttribute('aria-expanded', 'false')
})
