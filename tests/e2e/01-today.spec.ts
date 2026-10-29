import { test, expect } from './fixtures'
import { gotoToday } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

test.beforeAll(async ({ request }) => {
  // A known morning, so the readiness line is the same every run.
  await setMorning(makeApiFor(request))
})

test('Today: no week strip (page 72), the Morning Report row with readiness, no Coach board', async ({ page }) => {
  await gotoToday(page)

  // Page 72: the week strip is gone (Program has the week); with no location the weather hides too.
  await expect(page.getByRole('list', { name: 'This week' })).toHaveCount(0)
  await expect(page.locator('.wx-wrap')).toHaveCount(0)

  // Morning Report (page 96): checked in, one folded line, the flap and the coach's word; a tap opens it.
  const report = page.getByRole('button', { name: /^Morning Report, logged\./ })
  await expect(report).toBeVisible()
  await expect(report.getByRole('img', { name: 'GOOD TO GO' })).toBeVisible()
  await expect(report.locator('.td-mr-word')).toHaveText('Everything is near your usual.')
  await expect(report).toHaveScreenshot('morning-report.png')
  await report.tap()
  await expect(page.locator('.td-mr').getByRole('img', { name: 'LOGGED' })).toBeVisible()
  await expect(page.locator('.td-mr .rd')).toHaveText('Good to go.')

  // No Coach board on Today any more (page 56): the readiness lives in the row above.
  await expect(page.getByText(/coach board/i)).toHaveCount(0)
  await expect(page.getByRole('img', { name: /^COACH$/ })).toHaveCount(0)
  await expect(page.locator('.wm-board', { hasText: /^\s*COACH/ })).toHaveCount(0)

  // The day board and the tab bar are there.
  await expect(page.getByRole('button', { name: '+ add session' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveCount(4)
})
