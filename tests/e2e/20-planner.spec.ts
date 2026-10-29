import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { addDaysISO, dayRow, epochOf, gotoToday, holdRow, insertSession, openDay, todayISO, todayRow } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'
import { mockWeather } from './support/weather'

/**
 * Pages 72 and 73 (approved 2026-10-22): the weather in the week strip's place
 * on Today, and Program as a day list with the hold's command window, the
 * coach picks (the new brain's, previewed before SWAP IN / ADD), the WHY?
 * tiles, and next week planned with no marks. The same window on Today.
 */

test.beforeAll(async ({ request }) => {
  await setMorning(makeApiFor(request))
})
test.describe.configure({ mode: 'serial' })

type Row = { id: string; type: string; status: string; skipReason: string | null; source: string | null; contextJson: string | null }

test('Today: no location, no weather; the week strip is gone', async ({ page }) => {
  await gotoToday(page)
  await expect(page.getByRole('list', { name: 'This week' })).toHaveCount(0)
  await expect(page.locator('.wx-wrap')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Weather:/ })).toHaveCount(0)
})

test('Today: the flap weather strip, its coach line, the hours and the week', async ({ page, context, api }) => {
  // A run tonight: the coach line speaks for it when the rain is at its hour.
  // No hour learned yet, so it names the evening, not a made-up clock hour (audit 2026-10-23 #16).
  await insertSession(api, 'foundation_run', 'pm')
  await mockWeather(page, context)
  await gotoToday(page)
  const strip = page.getByRole('button', { name: /^Weather:/ })
  await expect(strip).toBeVisible({ timeout: 20_000 })
  await expect(strip.locator('.l1')).toHaveText(/^Feels −?\d+°$/)
  await expect(strip.locator('.l2 b')).toHaveText(/^Rain at \d{1,2}(:\d\d)?$/)
  // No wind, no source or freshness words.
  await expect(page.locator('.wx-wrap')).not.toContainText(/km\/h|wind|station|Environment|Open-Meteo|min ago|updated/i)
  await expect(page.locator('.wx-cline')).toHaveText(/^Run this evening: −?\d+° and rain\.$/)
  // It sits where the week strip was: above the Morning Report.
  const wxBox = (await page.locator('.wx-wrap').boundingBox())!
  const mrBox = (await page.getByRole('button', { name: /^Morning Report/ }).boundingBox())!
  expect(wxBox.y).toBeLessThan(mrBox.y)

  // Tap: the board in place, now and feels-like with high and low, the 8 hours, when the rain comes.
  await strip.tap()
  const hours = page.getByRole('dialog', { name: 'The weather, the next hours' })
  await expect(hours).toBeVisible()
  await expect(hours.locator('.nowr')).toContainText('High 6° · low −1°')
  await expect(hours.locator('.wx-hrs .h')).toHaveCount(8)
  await expect(hours.locator('.wx-hrs .h.is-run')).toHaveCount(1)
  await expect(hours.locator('.wx-cline')).toHaveText(/^Rain /)
  // 7 DAYS ›: the week, one line a day; ‹ TODAY goes back.
  await hours.getByRole('button', { name: '7 DAYS ›' }).tap()
  const week = page.getByRole('dialog', { name: 'The week ahead' })
  await expect(week.locator('.wx-wk .w')).toHaveCount(7)
  await expect(week.locator('.wx-wk .w').first()).toContainText('6°')
  await week.getByRole('button', { name: '‹ TODAY' }).tap()
  await expect(hours).toBeVisible()
  // CLOSE, then a tap outside.
  await hours.getByRole('button', { name: 'CLOSE' }).tap()
  await expect(hours).toBeHidden()
  await strip.tap()
  await expect(hours).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(hours).toBeHidden()
})

test('Program: the week as a day list, one day open at a time, a session opens to its lines', async ({ page, api }) => {
  const bag = await insertSession(api, 'bag_work', 'pm')
  const today = epochOf(todayISO())
  await page.goto('/program')
  const days = page.getByRole('list', { name: 'Days of the week' })
  await expect(days.getByRole('listitem')).toHaveCount(7, { timeout: 20_000 })
  await expect(page.getByRole('tablist', { name: 'Weeks' }).getByRole('tab')).toHaveCount(2)
  // Page 93: the line under THIS WEEK is the app's own week line ("Week 3. ...").
  await expect(page.locator('.pg-wsub')).toHaveText(/^Week \d+\. |^Block Zero · (week \d+|lead-in)$/)
  // Gone: the week numbers, "of 6", RPE copy, Prev / Next.
  await expect(page.locator('.pg-week')).not.toContainText(/ of \d|RPE|Prev|Next ›|Not prepared/)
  // Today's date on a gold flap, the cursor on it.
  await expect(dayRow(page, today).locator('.wm-flap.is-gold')).toHaveCount(1)
  await expect(dayRow(page, today).locator('.pl-cur')).toHaveCount(1)

  // One day open at a time.
  const other = (await days.locator('.pg-dr').evaluateAll(els => els.map(e => Number((e as HTMLElement).dataset.day)))).find(d => d !== today)!
  await openDay(page, other)
  await openDay(page, today)
  await expect(dayRow(page, other)).toHaveAttribute('aria-expanded', 'false')

  // A session: its real lines under it, the cursor on it, its name gold.
  const row = page.locator(`.pl-row[data-sid="${bag.id}"]`)
  await row.locator('[role=button]').first().tap()
  await expect(row).toHaveClass(/is-on/)
  await expect(row.locator('.pl-cur')).toHaveCount(1)
  // Page 94: a bag day lists its rounds (ABOUT before they're picked).
  await expect(row.locator('.pl-ol .lb, .pl-lg .nm').first()).toHaveText(/ABOUT|Round 1/)
  // No boxes or glows: no ENTER on Program.
  await expect(row.getByRole('button', { name: /ENTER|RESUME/ })).toHaveCount(0)
})

test('Hold: the command window (REPLACE / SKIP, 44 pt lines); a tap outside closes it', async ({ page, api }) => {
  const s = await insertSession(api, 'bag_work', 'pm')
  await page.goto('/program')
  await openDay(page, epochOf(todayISO()))
  const cmd = await holdRow(page, page.locator(`.pl-row[data-sid="${s.id}"]`))
  const replace = cmd.getByRole('button', { name: 'Replace' })
  const skip = cmd.getByRole('button', { name: 'Skip' })
  await expect(replace).toBeVisible()
  await expect(skip).toBeVisible()
  for (const b of [replace, skip]) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(replace.locator('.pl-cur')).toHaveCount(1)
  // the lift's own click is swallowed for 400 ms (swallowReleaseClick); a real tap outside comes later
  await page.waitForTimeout(450)
  await page.mouse.click(8, 8)
  await expect(cmd).toBeHidden()
  // Nothing changed.
  const rows = await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)
  expect(rows.find(r => r.id === s.id)?.status).toBe('planned')
})

/** Page 80: a Bag Work pick asks COACH / HYBRID / CUSTOM first; COACH, then its own ADD / SWAP IN. Anything else lands at once. */
async function throughBagModes(page: Page) {
  const modes = page.getByRole('dialog', { name: 'Bag work', exact: true })
  if (!(await modes.isVisible().catch(() => false))) return
  await modes.getByRole('button', { name: 'Coach' }).tap()
  const board = page.getByRole('dialog', { name: 'Bag work: coach' })
  await board.getByRole('button', { name: /^(Add|Swap in)$/ }).tap()
}

test('REPLACE: COACH PICKS from the brain, a tap only previews, SWAP IN swaps, then the WHY? tiles', async ({ page, api }) => {
  const s = await insertSession(api, 'bag_work', 'pm')
  await page.goto('/program')
  await openDay(page, epochOf(todayISO()))
  const row = page.locator(`.pl-row[data-sid="${s.id}"]`)
  let cmd = await holdRow(page, row)
  await cmd.getByRole('button', { name: 'Replace' }).tap()
  const picks = page.getByRole('dialog', { name: 'Coach picks: replace' })
  await expect(picks).toBeVisible()
  await expect(picks.getByRole('img', { name: 'COACH PICKS' })).toBeVisible()
  const lines = picks.locator('.pl-cl:not(.is-more)')
  await expect(lines.first()).toBeVisible({ timeout: 20_000 })
  const n = await lines.count()
  expect(n).toBeGreaterThanOrEqual(1)
  expect(n).toBeLessThanOrEqual(3)
  // The pointed pick: one short reason, exactly what it would be, SWAP IN.
  await expect(lines.first().locator('.why2')).toHaveText(/\w.*\./)
  await expect(lines.first().locator('.pl-inn .pl-ol').first()).toBeVisible()
  await expect(lines.first().getByRole('button', { name: 'Swap in' })).toBeVisible()
  if (n > 1) {
    await lines.nth(1).tap()
    await expect(lines.nth(1)).toHaveClass(/is-on/)
    await expect(lines.nth(1).locator('.pl-inn .pl-ol').first()).toBeVisible()
    await expect(lines.first().getByRole('button', { name: 'Swap in' })).toHaveCount(0)
  }
  // EVERYTHING ELSE ›, then back.
  await picks.getByRole('button', { name: 'Everything else' }).tap()
  await expect(picks.getByRole('img', { name: 'EVERYTHING' })).toBeVisible()
  // Page 76: the run types fold into RUNS ›: its own list (a tap previews, ‹ BACK returns).
  await expect(picks.getByRole('button', { name: 'Run-Walk', exact: true })).toHaveCount(0)
  await picks.getByRole('button', { name: 'Runs', exact: true }).tap()
  await expect(picks.getByRole('img', { name: 'RUNS' })).toBeVisible()
  const runLines = picks.locator('.pl-cl:not(.is-more)')
  await expect(runLines.first()).toHaveClass(/is-on/)
  await expect(runLines.first().locator('.pl-inn .pl-ol').first()).toBeVisible()
  if (await runLines.count() > 1) {
    await runLines.nth(1).tap()
    await expect(runLines.nth(1).locator('.pl-inn .pl-ol').first()).toBeVisible()
  }
  await picks.getByRole('button', { name: 'Back', exact: true }).tap()
  await expect(picks.getByRole('img', { name: 'EVERYTHING' })).toBeVisible()
  await expect(picks.getByRole('button', { name: 'Runs', exact: true })).toHaveClass(/is-on/)
  await picks.getByRole('button', { name: 'Coach picks' }).tap()
  // Tapping away changes nothing.
  await page.mouse.click(8, 8)
  await expect(picks).toBeHidden()
  expect((await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).find(r => r.id === s.id)?.status).toBe('planned')

  // Again, and SWAP IN. Page 73's motion: the row stays and its flaps flip (the same element, now the new session).
  await row.evaluate(el => el.setAttribute('data-e2e-row', 'kept'))
  cmd = await holdRow(page, row)
  await cmd.getByRole('button', { name: 'Replace' }).tap()
  await expect(lines.first()).toBeVisible({ timeout: 20_000 })
  const name = (await lines.first().getAttribute('aria-label')) ?? ''
  await lines.first().getByRole('button', { name: 'Swap in' }).tap()
  await page.waitForTimeout(250)
  await throughBagModes(page)
  const why = page.getByRole('dialog', { name: 'Why, optional' })
  await expect(why).toBeVisible()
  await expect(why.getByRole('button')).toHaveCount(3)
  for (const t of ['TIME', 'BODY', 'JUST BECAUSE']) await expect(why.getByRole('button', { name: t, exact: true })).toBeVisible()
  await why.getByRole('button', { name: 'TIME' }).tap()
  await expect(why).toBeHidden()
  await expect.poll(async () => (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).find(r => r.id === s.id)?.skipReason).toBe('schedule')
  const all = await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)
  const swapped = all.find(r => r.source === 'replace' && (r.contextJson ?? '').includes(s.id))
  expect(swapped, `the ${name} swapped in`).toBeTruthy()
  await expect(page.locator('.pl-row[data-e2e-row="kept"]')).toHaveAttribute('data-sid', swapped!.id)
  await expect(page.locator(`.pl-row[data-sid="${swapped!.id}"] .pl-ol`).filter({ hasText: 'WHY' })).toContainText('time')
})

test('SKIP: the row is struck, the WHY? tiles (TIME / BODY / SICK / PAIN), then UNDO SKIP', async ({ page, api }) => {
  const s = await insertSession(api, 'active_recovery', 'pm')
  await page.goto('/program')
  await openDay(page, epochOf(todayISO()))
  const row = page.locator(`.pl-row[data-sid="${s.id}"]`)
  let cmd = await holdRow(page, row)
  await cmd.getByRole('button', { name: 'Skip' }).tap()
  await expect(row).toHaveClass(/is-skip/)
  const why = page.getByRole('dialog', { name: 'Why, optional' })
  await expect(why).toBeVisible()
  await expect(why.getByRole('button')).toHaveCount(4)
  for (const t of ['TIME', 'BODY', 'SICK', 'PAIN']) await expect(why.getByRole('button', { name: t, exact: true })).toBeVisible()
  await why.getByRole('button', { name: 'SICK' }).tap()
  await expect.poll(async () => (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).find(r => r.id === s.id)?.skipReason).toBe('sick')
  await expect(row.locator('.pl-ol').first()).toHaveText(/SKIPPED\s*sick/)
  // A skipped session's window: UNDO SKIP.
  cmd = await holdRow(page, row)
  await cmd.getByRole('button', { name: 'Undo skip' }).tap()
  await expect.poll(async () => (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).find(r => r.id === s.id)?.status).toBe('planned')
  await expect(row).not.toHaveClass(/is-skip/)
})

test('+ add: COACH PICKS, ADD puts it on the day', async ({ page, api }) => {
  await page.goto('/program')
  const today = epochOf(todayISO())
  await openDay(page, today)
  const before = (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).length
  await page.locator('.pg-dayw').filter({ has: dayRow(page, today) }).getByRole('button', { name: '+ add session' }).tap()
  const picks = page.getByRole('dialog', { name: 'Coach picks: add' })
  await expect(picks.locator('.pl-cl:not(.is-more)').first()).toBeVisible({ timeout: 20_000 })
  await picks.getByRole('button', { name: 'Add', exact: true }).tap()
  await page.waitForTimeout(250)
  await throughBagModes(page)
  await expect(picks).toBeHidden()
  await expect.poll(async () => (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).length).toBe(before + 1)
})

test('NEXT WEEK: fully planned, no marks, nothing past it', async ({ page }) => {
  await page.goto('/program')
  const tabs = page.getByRole('tablist', { name: 'Weeks' })
  await tabs.getByRole('tab', { name: 'NEXT WEEK' }).tap()
  await expect(tabs.getByRole('tab', { name: 'NEXT WEEK' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.pg-wsub').first()).toHaveText('Planned. Fine-tuned the night before.')
  const rows = page.locator('.pg-dr')
  await expect(rows).toHaveCount(7, { timeout: 30_000 })
  const monday = epochOf(addDaysISO(todayISO(), 7 - ((new Date().getDay() + 6) % 7)))
  await expect(rows.first()).toHaveAttribute('data-day', String(monday))
  // planned: sessions on its days, and no runes or change lines
  await expect(page.locator('.pg-dr .ics .ic').first()).toBeVisible()
  await expect(page.locator('.pg-week .wm-rune')).toHaveCount(0)
  await expect(page.locator('.pg-week')).not.toContainText('Not prepared')
  await openDay(page, monday)
  await expect(page.locator('.pg-week .pl-ol.is-why')).toHaveCount(0)
  // two tabs only: nothing past next week
  await expect(tabs.getByRole('tab')).toHaveCount(2)
})

test('Today: the same rows, hold and window; a tap opens the lines with ENTER', async ({ page, api }) => {
  const s = await insertSession(api, 'skip_rope', 'pm')
  await gotoToday(page)
  const row = todayRow(page, s.id)
  await row.locator('[role=button]').first().tap()
  await expect(row.getByRole('button', { name: 'ENTER' })).toBeVisible()
  await expect(row.locator('.pl-ol .lb').first()).toHaveText('ROUNDS')
  await page.mouse.click(8, 8)
  const cmd = await holdRow(page, row)
  await expect(cmd.getByRole('button', { name: 'Replace' })).toBeVisible()
  await cmd.getByRole('button', { name: 'Replace' }).tap()
  const picks = page.getByRole('dialog', { name: 'Coach picks: replace' })
  await expect(picks.locator('.pl-cl:not(.is-more)').first()).toBeVisible({ timeout: 20_000 })
  await expect(picks.locator('.pl-cl.is-on .pl-inn .pl-ol').first()).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(picks).toBeHidden()
})
