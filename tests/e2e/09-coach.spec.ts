import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { addDaysISO, gotoToday, insertSession, todayISO, todayRow } from './support/helpers'

/**
 * The page 56 coach model on Today: REPLACE (with the optional ROUGH DAY tile)
 * swaps at once; SKIP is instant and then offers its reason tiles; + Add
 * always adds, MT Class included; the coach's own changes put a Dagaz rune on
 * their day, a missed session an Algiz; a rune day opens its back (before ->
 * after, why, UNDO), UNDO puts it back; Program's week log lists it all.
 *
 * Runs last: it rolls today's sessions over to "missed" at the end. No
 * retries: each test builds on the one before in the shared scratch DB, so a
 * serial retry (from the first test) would only fail on the state left behind.
 */
test.describe.configure({ mode: 'serial', retries: 0 })

const strip = (page: Page) => page.getByRole('list', { name: 'This week' })
const row = (page: Page, name: RegExp) => page.locator('.td-row').filter({ has: page.getByRole('button', { name }) })

test('REPLACE with ROUGH DAY swaps at once', async ({ page }) => {
  await gotoToday(page)
  // Foundation is on every day of Block Zero.
  const foundation = row(page, /^Foundation FOUNDATION ~\d+min$/).first()
  const sid = await foundation.getAttribute('data-sid')
  await foundation.locator('[role=button]').first().tap()
  await foundation.getByRole('button', { name: 'REPLACE' }).tap()

  const picker = page.getByRole('dialog', { name: 'Replace foundation' })
  await expect(picker).toBeVisible()
  const why = picker.getByRole('radiogroup', { name: 'Why, optional' })
  await why.getByRole('radio', { name: 'ROUGH DAY' }).tap()
  await expect(why.getByRole('radio', { name: 'ROUGH DAY' })).toHaveAttribute('aria-checked', 'true')
  await expect(why).toHaveScreenshot('replace-why-rough-day.png')
  // Foundation itself isn't offered as its own replacement; MT Class is.
  await expect(picker.getByRole('button', { name: /^Pick (Coach pick: )?Foundation/ })).toHaveCount(0)
  await expect(picker.getByRole('button', { name: /^Pick (Coach pick: )?MT Class/ })).toBeVisible()

  await picker.getByRole('button', { name: /^Pick (Coach pick: )?Bag Work/ }).tap()
  // No confirm step: the picker closes and the swap is on the board.
  await expect(picker).toBeHidden()
  await expect(page.getByRole('button', { name: /^Bag Work BAG WORK ~\d+min$/ }).first()).toBeVisible()
  // The replaced session leaves the board (it stays in the week log).
  await expect(page.locator(`.td-row[data-sid="${sid}"]`)).toHaveCount(0)
})

test('SKIP is instant, then offers the reason tiles', async ({ page, api }) => {
  // The Bag Work that REPLACE just put on the day (other specs leave theirs in progress).
  const today = await api.get<Array<{ id: string; type: string; source: string | null; status: string }>>(`/api/sessions/today?date=${todayISO()}`)
  const swapped = today.find(s => s.type === 'bag_work' && s.source === 'replace' && s.status === 'planned')
  expect(swapped, 'the replacement session').toBeTruthy()
  await gotoToday(page)
  const bag = todayRow(page, swapped!.id)
  await bag.locator('[role=button]').first().tap()
  await bag.getByRole('button', { name: 'SKIP' }).tap()
  await expect(bag.getByText('SKIPPED')).toBeVisible()
  const why = bag.getByRole('radiogroup', { name: 'Why, optional' })
  await expect(why.getByRole('radio')).toHaveCount(8)
  await why.getByRole('radio', { name: 'TIRED' }).tap()
  await expect(why.getByRole('radio', { name: 'TIRED' })).toHaveAttribute('aria-checked', 'true')
})

test('+ Add always adds, MT Class included', async ({ page }) => {
  await gotoToday(page)
  const rows = page.locator('.td-row')
  const ropesBefore = await page.getByRole('button', { name: /^Skip Rope SKIP ROPE/ }).count()
  for (const pick of [/^Pick (Coach pick: )?MT Class/, /^Pick (Coach pick: )?Skip Rope/, /^Pick (Coach pick: )?Skip Rope/]) {
    const before = await rows.count()
    await page.getByRole('button', { name: '+ add session' }).tap()
    const picker = page.getByRole('dialog', { name: 'Add Session' })
    await picker.getByRole('button', { name: pick }).tap()
    await expect(picker).toBeHidden()
    await expect(rows).toHaveCount(before + 1)
  }
  await expect(page.getByRole('button', { name: /^MT Class MT CLASS/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Skip Rope SKIP ROPE/ })).toHaveCount(ropesBefore + 2)
})

test('a Dagaz day opens its back: before -> after, why, UNDO; UNDO puts it back', async ({ page }) => {
  await gotoToday(page)
  const dagaz = strip(page).getByRole('listitem', { name: /The coach changed this day\./ })
  // The week's changes arrive after the board: wait for a rune day before counting
  // (none may come on a Sunday, so a timeout here is not the failure).
  await dagaz.first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
  const n = await dagaz.count()
  test.skip(n === 0 && new Date().getDay() === 0, 'Sunday: the coach rebalances into next week, no rune this week')
  expect(n).toBeGreaterThan(0)
  await expect(dagaz.first().locator('.wm-rune')).toBeAttached()

  // The first rune day whose change can still be undone.
  const back = page.getByRole('dialog', { name: 'What changed this day' })
  let opened = false
  for (let i = 0; i < n && !opened; i++) {
    await dagaz.nth(i).tap()
    await expect(back).toBeVisible()
    if (await back.getByRole('button', { name: 'UNDO' }).count()) opened = true
    else await page.locator('.wm-veil3').click({ position: { x: 5, y: 5 } })
  }
  expect(opened).toBe(true)

  const change = back.locator('.wm-tchange').filter({ has: page.getByRole('button', { name: 'UNDO' }) }).first()
  await expect(change.getByText(/^COACH/)).toBeVisible()
  await expect(change.locator('.ba2')).toContainText('→')
  await expect(change.locator('.ba2 .old [role=img]').first()).toHaveAttribute('aria-label', /.+/)
  await expect(change.locator('.voice').first()).toHaveText(/\w.*\./)
  await expect(change.getByText(/^Until it starts/)).toBeVisible()

  await change.getByRole('button', { name: 'UNDO' }).tap()
  await expect(back.getByRole('img', { name: 'PUT BACK' }).first()).toBeVisible()
})

test('the week log in Program lists his changes and the coach ones', async ({ page }) => {
  await page.goto('/program')
  const open = page.getByRole('button', { name: /^\d+ changes? ›$/ })
  await expect(open).toBeVisible()
  await open.tap()
  const log = page.getByRole('dialog', { name: /^Week \d+ changes$/ })
  await expect(log).toBeVisible()
  // His REPLACE with its reason, his SKIP and his adds.
  await expect(log.getByText('Rough day.').first()).toBeVisible()
  await expect(log.getByRole('img', { name: 'BAG WORK' }).first()).toBeVisible()
  await expect(log.getByText(/^Skipped|^Tired/).first()).toBeVisible()
  await expect(log.getByRole('img', { name: /MT TECHNIQUE|MT CLASS/ }).first()).toBeVisible()
  // The coach change undone above reads "put back".
  await expect(log.getByText('put back').first()).toBeVisible()
  await log.getByRole('button', { name: 'Close' }).tap()
  await expect(log).toBeHidden()
})

test('a missed session puts an Algiz on its day', async ({ page, api }) => {
  // A key session today that never happens: the day rolls over (the server's
  // rollover runs with the athlete's day, here tomorrow) and it reads missed.
  await insertSession(api, 'strength', 'pm')
  await api.get(`/api/sessions/today?date=${addDaysISO(todayISO(), 1)}`)

  await gotoToday(page)
  const todayTile = strip(page).getByRole('listitem', { name: new RegExp(`^${todayISO()}, today`) })
  await expect(todayTile).toHaveAttribute('aria-label', /A missed session\./)
  await expect(todayTile.locator('.wm-rune.is-miss, .wm-rune.is-missseen')).toBeAttached()
  await todayTile.tap()
  const back = page.getByRole('dialog', { name: 'What changed this day' })
  await expect(back.getByText(/^MISSED/).first()).toBeVisible()
})
