import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { enterFromToday, gotoToday, insertSession, metricOffenders } from './support/helpers'

/**
 * Josh reads weights in lb, form-cue distances in inches, and run distance and
 * pace in km: no "kg", "cm" or "miles" anywhere he can see ("6:42/KM" on the
 * Ledger and the manual run's KM field are right). Each screen is read whole:
 * plain text, flap labels (by their aria-labels) and inputs.
 */
async function expectNoMetric(page: Page) {
  // Let late boards land.
  await page.waitForTimeout(1500)
  expect(await metricOffenders(page)).toEqual([])
}

test('Units: Today', async ({ page }) => {
  await gotoToday(page)
  await expectNoMetric(page)
})

test('Units: Program, every day of the week', async ({ page }) => {
  await page.goto('/program')
  const days = page.getByRole('tablist', { name: 'Days of the week' }).getByRole('tab')
  await expect(days).toHaveCount(7)
  for (let i = 0; i < 7; i++) {
    await days.nth(i).tap()
    await expectNoMetric(page)
    // A day with a rune opens its back under the strip (with its own words, checked above): close it.
    const veil = page.locator('.wm-veil3')
    if (await veil.isVisible()) await veil.click({ position: { x: 5, y: 5 } })
  }
})

test('Units: Library', async ({ page }) => {
  await page.goto('/library')
  await expectNoMetric(page)
  await page.getByRole('button', { name: 'strength', exact: true }).tap()
  await expectNoMetric(page)
})

test('Units: Settings', async ({ page }) => {
  await page.goto('/settings')
  await expectNoMetric(page)
})

test('Units: Ledger (week, month, season)', async ({ page }) => {
  await page.goto('/history')
  const range = page.getByRole('tablist', { name: 'Range' })
  const offenders: string[] = []
  for (const tab of ['WEEK', 'MONTH', 'SEASON']) {
    await range.getByRole('tab', { name: tab }).tap()
    await page.waitForTimeout(1500)
    offenders.push(...(await metricOffenders(page)))
  }
  test.info().annotations.push({ type: 'wrong units on the Ledger', description: [...new Set(offenders)].join(' | ') })
  expect(offenders).toEqual([])
})

test('Units: a strength session', async ({ page, api }) => {
  const s = await insertSession(api, 'strength')
  await enterFromToday(page, s.id)
  await expect(page.getByRole('button', { name: 'LOG SET', exact: true })).toBeVisible()
  await expectNoMetric(page)
})
