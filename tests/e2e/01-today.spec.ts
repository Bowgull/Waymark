import { test, expect } from './fixtures'
import { gotoToday, todayISO } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

test.beforeAll(async ({ request }) => {
  // A known morning, so the readiness line is the same every run.
  await setMorning(makeApiFor(request))
})

test('Today: the week strip, the Morning Report row with readiness, no Coach board', async ({ page }) => {
  await gotoToday(page)

  // Week strip: seven day tiles, Monday to Sunday, today marked.
  const strip = page.getByRole('list', { name: 'This week' })
  const tiles = strip.getByRole('listitem')
  await expect(tiles).toHaveCount(7)
  await expect(strip.getByRole('listitem', { name: new RegExp(`^${todayISO()}, today`) })).toHaveCount(1)
  const days = await tiles.evaluateAll(els => els.map(e => (e.textContent ?? '').trim().charAt(0)))
  expect(days).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])

  // Morning Report: one row, LOGGED and the readiness line.
  const report = page.getByRole('button', { name: /^Morning Report, logged\./ })
  await expect(report).toBeVisible()
  await expect(report.getByRole('img', { name: 'LOGGED' })).toBeVisible()
  await expect(report.getByRole('paragraph')).toHaveText('Good to go.')
  await expect(report).toHaveScreenshot('morning-report.png')

  // No Coach board on Today any more (page 56): the readiness lives in the row above.
  await expect(page.getByText(/coach board/i)).toHaveCount(0)
  await expect(page.getByRole('img', { name: /^COACH$/ })).toHaveCount(0)
  await expect(page.locator('.wm-board', { hasText: /^\s*COACH/ })).toHaveCount(0)

  // The day board and the tab bar are there.
  await expect(page.getByRole('button', { name: '+ add session' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(4)
})

test('Today: a tap on a day tile opens that day in Program', async ({ page }) => {
  await gotoToday(page)
  const plain = page.getByRole('list', { name: 'This week' }).getByRole('listitem', { name: /Open in Program\.$/ }).first()
  const label = (await plain.getAttribute('aria-label')) ?? ''
  const iso = label.slice(0, 10)
  await plain.tap()
  await expect(page).toHaveURL(new RegExp(`/program\\?day=${iso}`))
  await expect(page.getByRole('tablist', { name: 'Days of the week' })).toBeVisible()
})
