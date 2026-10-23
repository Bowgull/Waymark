import { test, expect } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { addDaysISO, dayRow, epochOf, gotoToday, holdRow, insertSession, todayISO, todayRow } from './support/helpers'
import { GOOD_MORNING, setMorning } from './support/data'

/**
 * The coach model on Today with page 73's gestures (approved 2026-10-22):
 * hold a row → REPLACE → COACH PICKS (preview, then SWAP IN) → the optional
 * WHY? tiles; SKIP is instant and then offers TIME / BODY / SICK / PAIN; + add
 * opens the coach picks and always adds, MT Class included; the coach's own
 * changes put a Dagaz rune on their day (Program), a missed session an Algiz;
 * the rune opens the why-line with KEEP and UNDO, then REDO.
 *
 * It rolls today's sessions over to "missed" at the end. No retries: each
 * test builds on the one before in the shared scratch DB.
 */
test.describe.configure({ mode: 'serial', retries: 0 })

type Row = { id: string; type: string; source: string | null; status: string; skipReason: string | null }
// A row's name: its icon's alt (the flap name), the flap, the minutes ("FOUNDATION FOUNDATION ~12min").
const row = (page: Page, name: RegExp) => page.locator('.td-row').filter({ has: page.getByRole('button', { name }) })
/**
 * Tap a line in the COACH PICKS window. EVERYTHING (with a line open) is taller
 * than the window, which scrolls inside itself; bring the line into the window
 * first and let the list settle, so the tap never has to scroll the page (a
 * page scroll closes the window, by design).
 */
async function pickTap(picks: Locator, name: string) {
  const b = picks.getByRole('button', { name, exact: true })
  await expect(b).toBeVisible()
  await b.evaluate(el => {
    const w = el.closest('.pl-cmd') as HTMLElement
    const r = el.getBoundingClientRect(), wr = w.getBoundingClientRect()
    if (r.top < wr.top) w.scrollTop -= wr.top - r.top + 8
    else if (r.bottom > wr.bottom) w.scrollTop += r.bottom - wr.bottom + 8
  })
  await expect.poll(() => b.evaluate(el => el.closest('.pl-cmd')!.getAnimations({ subtree: true })
    .filter(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity).length)).toBe(0)
  await b.tap()
}
const sessionsToday = (api: { get<T>(p: string): Promise<T> }) => api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)

test('REPLACE: hold, COACH PICKS, SWAP IN, then BODY', async ({ page, api }) => {
  await gotoToday(page)
  // Foundation is on every day of Block Zero.
  const foundation = row(page, /^Foundation FOUNDATION ~\d+min$/i).first()
  const sid = await foundation.getAttribute('data-sid')
  // Page 73's motion: a swap keeps the row (its flaps flip), so mark the element.
  await foundation.evaluate(el => el.setAttribute('data-e2e-row', 'kept'))
  const cmd = await holdRow(page, foundation)
  await cmd.getByRole('button', { name: 'Replace' }).tap()

  const picks = page.getByRole('dialog', { name: 'Coach picks: replace' })
  const first = picks.locator('.pl-cl:not(.is-more)').first()
  await expect(first).toBeVisible({ timeout: 20_000 })
  // Foundation itself isn't offered as its own replacement; MT Class is (everything else).
  await picks.getByRole('button', { name: 'Everything else' }).tap()
  await expect(picks.getByRole('button', { name: 'Foundation', exact: true })).toHaveCount(0)
  await expect(picks.getByRole('button', { name: 'MT Class', exact: true })).toBeVisible()
  await picks.getByRole('button', { name: 'Bag Work', exact: true }).tap()
  await picks.getByRole('button', { name: 'Swap in' }).tap()
  const why = page.getByRole('dialog', { name: 'Why, optional' })
  await expect(why).toBeVisible()
  await why.getByRole('button', { name: 'BODY', exact: true }).tap()
  await expect(why).toBeHidden()
  await expect(page.getByRole('button', { name: /^Bag Work BAG WORK ~\d+min$/i }).first()).toBeVisible()
  await expect(page.locator('.td-row[data-e2e-row="kept"]').getByRole('button', { name: /^Bag Work BAG WORK ~\d+min$/i })).toBeVisible()
  // The replaced session leaves the board (it stays in the week's changes), with his reason.
  await expect(page.locator(`.td-row[data-sid="${sid}"]`)).toHaveCount(0)
  await expect.poll(async () => (await sessionsToday(api)).find(r => r.id === sid)?.skipReason).toBe('too_sore')
})

test('SKIP is instant, then offers TIME / BODY / SICK / PAIN', async ({ page, api }) => {
  // The Bag Work that REPLACE just put on the day.
  const swapped = (await sessionsToday(api)).find(s => s.type === 'bag_work' && s.source === 'replace' && s.status === 'planned')
  expect(swapped, 'the replacement session').toBeTruthy()
  await gotoToday(page)
  const bag = todayRow(page, swapped!.id)
  const cmd = await holdRow(page, bag)
  await cmd.getByRole('button', { name: 'Skip' }).tap()
  await expect(bag).toHaveClass(/is-skip/)
  const why = page.getByRole('dialog', { name: 'Why, optional' })
  await expect(why.getByRole('button')).toHaveCount(4)
  await why.getByRole('button', { name: 'TIME', exact: true }).tap()
  await expect.poll(async () => (await sessionsToday(api)).find(r => r.id === swapped!.id)?.skipReason).toBe('schedule')
})

test('+ Add always adds, MT Class included', async ({ page }) => {
  await gotoToday(page)
  const rows = page.locator('.td-row')
  const ropesBefore = await page.getByRole('button', { name: /^Skip Rope SKIP ROPE/i }).count()
  for (const name of ['MT Class', 'Skip Rope', 'Skip Rope']) {
    const before = await rows.count()
    await page.getByRole('button', { name: '+ add session' }).tap()
    const picks = page.getByRole('dialog', { name: 'Coach picks: add' })
    await expect(picks.locator('.pl-cl:not(.is-more)').first()).toBeVisible({ timeout: 20_000 })
    await pickTap(picks, 'Everything else')
    // page 76: the runs fold into RUNS ›; MT Class and Skip Rope stay plain lines in EVERYTHING
    await expect(picks.getByRole('button', { name: 'Runs', exact: true })).toBeVisible()
    await pickTap(picks, name)
    await expect(picks.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'true')
    await pickTap(picks, 'Add')
    await expect(picks).toBeHidden()
    await expect(rows).toHaveCount(before + 1)
  }
  await expect(page.getByRole('button', { name: /^MT Class MT CLASS/i }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Skip Rope SKIP ROPE/i })).toHaveCount(ropesBefore + 2)
})

test('a Dagaz day on Program: the why-line, KEEP and UNDO, then REDO', async ({ page, api }) => {
  // Coach brain P2: in the day only a rough morning caps today's dose. A strength session
  // tonight and a 4 h, energy-1 morning: a coach rune.
  await insertSession(api, 'strength', 'pm')
  await setMorning(api, { ...GOOD_MORNING, sleepHours: 4, energy: 1 })
  await page.goto('/program')
  const today = dayRow(page, epochOf(todayISO()))
  await expect(today).toBeVisible({ timeout: 20_000 })
  const rune = today.getByRole('button', { name: 'What the coach changed' })
  await rune.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
  test.skip((await rune.count()) === 0 && new Date().getDay() === 0, 'Sunday: the coach rebalances into next week, no rune this week')
  await expect(today).toHaveAttribute('aria-label', /The coach changed it\./)
  await rune.tap()
  const win = page.getByRole('dialog', { name: 'What the coach changed' })
  await expect(win).toBeVisible()
  await expect(win.locator('.pl-say')).toHaveText(/\w.*\./)
  await expect(win.getByRole('button', { name: 'Keep' })).toBeVisible()
  await win.getByRole('button', { name: 'Undo' }).tap()
  await expect(win.getByRole('button', { name: 'Redo' })).toBeVisible()
  await win.getByRole('button', { name: 'Redo' }).tap()
  await expect(win).toBeHidden()
  // Back in place: the rune and its row's why-line.
  await expect(rune).toBeVisible()
  await setMorning(api, GOOD_MORNING)
})

test('a missed session puts an Algiz on its day', async ({ page, api }) => {
  // A key session today that never happens: the day rolls over (the server's
  // rollover runs with the athlete's day, here tomorrow) and it reads missed.
  await insertSession(api, 'strength', 'pm')
  await api.get(`/api/sessions/today?date=${addDaysISO(todayISO(), 1)}`)

  await page.goto('/program')
  const today = dayRow(page, epochOf(todayISO()))
  await expect(today).toHaveAttribute('aria-label', /A missed session\./, { timeout: 20_000 })
  await expect(today.locator('.wm-rune.is-miss, .wm-rune.is-missseen')).toBeAttached()
  await today.getByRole('button', { name: 'What the coach changed' }).tap()
  await expect(page.getByRole('dialog', { name: 'What the coach changed' })).toBeVisible()
})
