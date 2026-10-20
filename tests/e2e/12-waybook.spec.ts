import { test, expect } from './fixtures'
import { gotoToday, visibleWords } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * The Waybook (approved 2026-10-19): the line reads just "Waybook". On the
 * phone a tap asks Face ID / the passcode with iOS's own prompt; the web
 * build has no Face ID, so here it opens straight away, with no lock design.
 */

// A morning already checked in: otherwise the check-in cards open first (they come back until all nine are in).
test.beforeAll(async ({ request }) => {
  await setMorning(makeApiFor(request))
})

test('Waybook: the line reads just "Waybook" and opens on a tap (web: no prompt)', async ({ page }) => {
  await gotoToday(page)
  const line = page.locator('button.td-wline')
  await expect(line).toBeVisible()
  await expect(line.locator('.t')).toHaveText('Waybook')
  expect((await visibleWords(page)).some(w => /write in the waybook/i.test(w))).toBe(false)

  await line.tap()
  await expect(page.getByRole('textbox', { name: 'Waybook entry' })).toBeVisible()
  // no lock card, no unlock button
  await expect(page.getByText(/Waybook is locked/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /UNLOCK/ })).toHaveCount(0)
})

test('Waybook in the Library: the row opens the pages (web: no prompt, no lock card)', async ({ page }) => {
  await page.goto('/library')
  await page.getByRole('button', { name: 'waybook' }).tap()
  await expect(page).toHaveURL(/open=waybook/)
  await expect(page.getByRole('article', { name: 'The Waybook' })).toBeVisible()
  await expect(page.getByText(/Waybook is locked/i)).toHaveCount(0)
})
