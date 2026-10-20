import { test, expect } from './fixtures'
import { addDaysISO, gotoToday, todayISO } from './support/helpers'
import { GOOD_MORNING, setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * The Ledger (approved 2026-10-19):
 * - page 62 B, Herb: the last 28 mornings as bars in one neutral tone, the
 *   dashed brass 28-day average, the 7-day average on the flap, and the one
 *   sleep line from his own check-ins; right after Sleep + soreness.
 * - page 63 final, Consistency: on the first screen between the week rings
 *   and Aerobic base; closed, a flap and one bar with the NEXT BLOCK line;
 *   a tap opens it in place (four groups); it closes the page 61 ways.
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

test('Consistency: on the first screen; closed a flap and the bar; open in place; closes the page 61 ways (page 63)', async ({ page }) => {
  await openLedger(page)
  const board = page.locator('section.lg-cb')
  await expect(board).toBeVisible()

  // between the week rings and Aerobic base; the day streak and the week bars are gone
  const heads = await page.locator('section.lg-glass .lg-head > span:first-child, section.lg-glass .lg-label').allTextContents()
  expect(heads.map(h => h.trim().toLowerCase()).indexOf('consistency')).toBeLessThan(heads.map(h => h.trim().toLowerCase()).indexOf('aerobic base'))
  await expect(page.getByText(/D STREAK$/)).toHaveCount(0)
  await expect(page.locator('.lg-wbar')).toHaveCount(0)

  // closed: the flap (one of the states), one bar of tiles, the counts
  await expect(board.getByRole('img', { name: /^(ON TRACK|AT RISK|\d+ DAY BREAK|ONE MORE WEEK|TWO MORE WEEKS|\d+ OF \d+ WKS)$/ })).toBeVisible()
  const label = (await board.getAttribute('aria-label'))!
  const [, done, toCome, missed] = /(\d+) done, (\d+) to come, (\d+) missed/.exec(label)!.map(Number)
  await expect(board.locator('.track .lg-tl')).toHaveCount(done + toCome + missed)
  await expect(board.locator('.lg-cdet')).toHaveAttribute('aria-hidden', 'true')

  // a tap opens it in place: the four groups
  await board.tap()
  await expect(board).toHaveAttribute('aria-expanded', 'true')
  for (const g of ['When you train', 'What gets done']) await expect(board.getByText(g, { exact: true })).toBeVisible()
  await expect(board.getByText(/^(Next block|Last weeks)$/)).toBeVisible()
  await expect(board.getByRole('button', { name: 'Close', exact: true })).toBeVisible()

  // CLOSE
  await board.getByRole('button', { name: 'Close', exact: true }).tap()
  await expect(board).toHaveAttribute('aria-expanded', 'false')
  // tap again
  await board.tap()
  await expect(board).toHaveAttribute('aria-expanded', 'true')
  await board.tap({ position: { x: 20, y: 12 } })
  await expect(board).toHaveAttribute('aria-expanded', 'false')
  // tap outside
  await board.tap()
  await expect(board).toHaveAttribute('aria-expanded', 'true')
  await page.locator('.lg-segl').tap({ position: { x: 4, y: 4 } })
  await expect(board).toHaveAttribute('aria-expanded', 'false')
  // Escape
  await board.tap()
  await page.keyboard.press('Escape')
  await expect(board).toHaveAttribute('aria-expanded', 'false')
})
