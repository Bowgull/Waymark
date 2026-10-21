import { test, expect } from './fixtures'
import { gotoToday } from './support/helpers'

test('Settings: opened from Today, MT class days and the technique switches', async ({ page }) => {
  await gotoToday(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).tap()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('img', { name: 'SETTINGS' })).toBeVisible()

  const days = page.getByRole('group', { name: 'MT class days' })
  await expect(days.getByRole('button')).toHaveCount(7)

  // A technique switch flips and flips back (it saves each time).
  const knees = page.getByRole('switch', { name: 'knees' })
  const was = await knees.getAttribute('aria-checked')
  await knees.tap()
  await expect(knees).not.toHaveAttribute('aria-checked', was ?? '')
  await knees.tap()
  await expect(knees).toHaveAttribute('aria-checked', was ?? '')

  await expect(page.getByRole('switch', { name: 'Morning alarm' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Time of day' })).toBeAttached()
  // The redeploy countdown depends on the build time: masked.
  await expect(page).toHaveScreenshot('settings.png', { mask: [page.getByText('until redeploy').locator('..')] })

  await page.getByRole('button', { name: '‹ TODAY' }).tap()
  await expect(page).toHaveURL(/\/today/)
})

test('Library: categories, a category list, search', async ({ page }) => {
  await gotoToday(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'library' }).tap()
  await expect(page).toHaveURL(/\/library$/)
  for (const c of ['strength', 'core', 'foundation', 'mobility', 'bagwork', 'techniques', 'runs', 'waybook']) {
    await expect(page.getByRole('button', { name: c, exact: true })).toBeVisible()
  }
  await expect(page).toHaveScreenshot('library.png')

  await page.getByRole('button', { name: 'strength', exact: true }).tap()
  await expect(page.getByRole('button', { name: /^STRENGTH \d+$/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: /^Goblet Squat Dumbbell/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Front Squat Barbell/ })).toBeVisible()
  await page.getByRole('button', { name: 'Back to the Library' }).tap()

  await page.getByRole('searchbox').fill('goblet')
  await expect(page.getByRole('button', { name: /^Goblet Squat/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Front Squat/ })).toHaveCount(0)
})

test('Ledger: the week, month and season boards', async ({ page }) => {
  await gotoToday(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'ledger' }).tap()
  await expect(page).toHaveURL(/\/history$/)
  const range = page.getByRole('tablist', { name: 'Range' })
  await expect(range.getByRole('tab', { name: 'WEEK' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: /^This week: Strength \d+ of \d+/ })).toBeVisible()
  await expect(range).toHaveScreenshot('ledger-range.png')

  for (const tab of ['MONTH', 'SEASON', 'WEEK']) {
    await range.getByRole('tab', { name: tab }).tap()
    await expect(range.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
  }
  await expect(page.getByText('Aerobic base', { exact: true })).toBeVisible()
  await expect(page.getByText('Consistency')).toBeVisible()
})
