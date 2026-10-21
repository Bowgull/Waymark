import { test, expect } from './fixtures'
import { addDaysISO, gotoToday, insertSession, openRow, todayISO, todayRow } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * The dead ends Josh approved on 2026-10-21 (functional-gaps-2026-10-21.md, Part 2):
 *   #4  a missed session can still be done: ENTER on Today and on Program's day board
 *   #5  his own SKIP can be put back from the day's back (UNDO)
 *   #16 MARK COMPLETED (hold ×) opens the runner's own close, not a status-only save
 *   #18 a Ledger that fails to load shows the page error with RELOAD
 * Runs after 09-coach (today's earlier sessions are already missed).
 */
test.describe.configure({ mode: 'serial', retries: 0 })

test.beforeAll(async ({ request }) => {
  await setMorning(makeApiFor(request))
})

type Row = { id: string; type: string; status: string }

test('#4: a missed session opens with ENTER on Today (not struck), and on Program it starts', async ({ page, api }) => {
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

  // Program's day board: the missed row's summary has ENTER too, and it starts the session
  await page.goto('/program')
  await expect(page.getByRole('group', { name: 'Weeks of the block' })).toBeVisible({ timeout: 20_000 })
  const missed = page.locator('.db-row.is-missed').first()
  await missed.locator('.db-face').tap()
  const enter = missed.getByRole('button', { name: 'ENTER' })
  await expect(enter).toBeVisible()
  await enter.tap()
  await expect(page).toHaveURL(/\/session\//)
})

test('#5: his own SKIP is put back from the day\'s back (UNDO)', async ({ page, api }) => {
  const s = await insertSession(api, 'active_recovery', 'pm')
  await gotoToday(page)
  const row = todayRow(page, s.id)
  await openRow(row)
  await row.getByRole('button', { name: 'SKIP' }).tap()
  await expect(row.getByText('SKIPPED')).toBeVisible()
  await expect.poll(async () => (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).find(r => r.id === s.id)?.status).toBe('skipped')

  // the week's changes are read again after the skip; then today's tile opens its back
  const tile = page.getByRole('list', { name: 'This week' }).getByRole('listitem', { name: new RegExp(`^${todayISO()}, today`) })
  await page.mouse.click(5, 5)
  const back = page.getByRole('dialog', { name: 'What changed this day' })
  // this Reset's own skip (09-coach left other changes of his on today)
  const mine = back.locator('.wm-tchange').filter({ hasText: /YOU/ }).filter({ has: page.getByRole('img', { name: 'RESET', exact: true }) }).filter({ has: page.getByRole('button', { name: 'UNDO' }) })
  await expect(async () => {
    if (!(await back.isVisible())) await tile.tap()
    await expect(mine.first()).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  await mine.first().getByRole('button', { name: 'UNDO' }).tap()
  await expect.poll(async () => (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).find(r => r.id === s.id)?.status).toBe('planned')
  await expect(back.getByRole('img', { name: 'PUT BACK' }).first()).toBeVisible()
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
