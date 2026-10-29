import { test, expect } from './fixtures'
import { addDaysISO, enterFromToday, epochOf, gotoToday, holdRow, insertSession, openDay, openRow, todayISO, todayRow } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * The dead ends Josh approved on 2026-10-21 (functional-gaps-2026-10-21.md, Part 2):
 *   #4  a missed session can still be done: ENTER on Today (page 73: Program's rows open
 *       to their lines with no ENTER; Today keeps it)
 *   #5  his own SKIP can be put back (page 73: hold the struck row, UNDO SKIP)
 *   #16 MARK COMPLETED (hold ×) opens the runner's own close, not a status-only save
 *   #18 a Ledger that fails to load shows the page error with RELOAD
 * Runs after 09-coach (today's earlier sessions are already missed).
 */
test.describe.configure({ mode: 'serial', retries: 0 })

test.beforeAll(async ({ request }) => {
  await setMorning(makeApiFor(request))
})

type Row = { id: string; type: string; status: string }

test('#4: a missed session opens with ENTER on Today (not struck); on Program it opens to its lines', async ({ page, api }) => {
  const s = await insertSession(api, 'mobility', 'pm')
  // the day rolls over (the server's rollover with tomorrow's date): it reads missed
  await api.get(`/api/sessions/today?date=${addDaysISO(todayISO(), 1)}`)
  const rows = await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)
  expect(rows.find(r => r.id === s.id)?.status).toBe('missed')

  await gotoToday(page)
  const row = todayRow(page, s.id)
  await expect(row).not.toHaveClass(/is-skip/)
  await openRow(row)
  await expect(row.getByRole('button', { name: 'ENTER' })).toBeVisible()

  // Program (page 73): today's day opens, the missed row opens to its lines, and no ENTER there
  await page.goto('/program')
  await expect(page.getByRole('tablist', { name: 'Weeks' })).toBeVisible({ timeout: 20_000 })
  await openDay(page, epochOf(todayISO()))
  const missed = page.locator(`.pl-row[data-sid="${s.id}"]`)
  await expect(missed).not.toHaveClass(/is-skip/)
  await missed.locator('.pl-hit').tap()
  await expect(missed.locator('.pl-hit')).toHaveAttribute('aria-expanded', 'true')
  // Page 94: Foundation opens to its moves, back first.
  await expect(missed.locator('.pl-lgh').first()).toHaveText('Back')
  await expect(missed.getByRole('button', { name: /ENTER|RESUME/ })).toHaveCount(0)

  // ENTER on Today starts it
  await enterFromToday(page, s.id)
})

test('#5: his own SKIP is put back: hold the struck row, UNDO SKIP', async ({ page, api }) => {
  const s = await insertSession(api, 'active_recovery', 'pm')
  await gotoToday(page)
  const row = todayRow(page, s.id)
  let cmd = await holdRow(page, row)
  await cmd.getByRole('button', { name: 'Skip' }).tap()
  await expect(row).toHaveClass(/is-skip/)
  await expect.poll(async () => (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).find(r => r.id === s.id)?.status).toBe('skipped')
  // the optional WHY? tiles: a tap away leaves no reason
  const why = page.getByRole('dialog', { name: 'Why, optional' })
  await expect(why).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(why).toBeHidden()
  await expect(row.getByText('SKIPPED')).toBeVisible()

  // a skipped session's window has one line: UNDO SKIP
  cmd = await holdRow(page, row)
  await expect(cmd.getByRole('button')).toHaveCount(1)
  await cmd.getByRole('button', { name: 'Undo skip' }).tap()
  await expect.poll(async () => (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).find(r => r.id === s.id)?.status).toBe('planned')
  await expect(row).not.toHaveClass(/is-skip/)
})

test('#16: hold × then MARK COMPLETED opens the session\'s own close (effort)', async ({ page, api }) => {
  const s = await insertSession(api, 'mobility', 'pm')
  await api.post(`/api/sessions/${s.id}/start-mobility`)
  await gotoToday(page)
  const row = todayRow(page, s.id)
  await openRow(row)
  const x = row.getByRole('button', { name: 'Hold to end early' })
  await x.dispatchEvent('pointerdown')
  await page.waitForTimeout(1800)
  const card = page.getByRole('dialog', { name: 'End early' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'MARK COMPLETED' }).tap()
  await expect(page).toHaveURL(new RegExp(`/session/${s.id}\\?close=1`))
  await expect(page.getByRole('button', { name: 'CLOSE SESSION' })).toBeVisible({ timeout: 20_000 })
})

test('#18: a Ledger that fails to load: the page error with RELOAD', async ({ page }) => {
  await page.route('**/api/history/ledger?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }))
  await page.goto('/history')
  await expect(page.getByRole('button', { name: 'RELOAD' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'BACK TO TODAY' })).toBeVisible()
})
