import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { addDaysISO, todayISO } from './support/helpers'
import { setMorning } from './support/data'

/**
 * Page 64 (approved 2026-10-20): START BLOCK ZERO asks which day. START WHEN?
 * has TODAY (lit), TOMORROW and the next five days, one plain line, START,
 * and page 61's way out. A later day: nothing is planned until then; Today
 * and Program show BLOCK ZERO / STARTS <DAY>, the countdown and CHANGE DAY,
 * which reopens the board with SAVE. The start day gets one line on top.
 *
 * Runs last: it restarts Block Zero in the shared scratch DB (ending on a
 * Block Zero that starts today).
 */
const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const dowOf = (iso: string) => new Date(`${iso}T12:00:00`).getDay()
const dayOf = (sec: number) => Math.floor(sec / 86400)
const epoch = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000)

async function openRestart(page: Page) {
  await page.goto('/program')
  // the link sits at the foot of a week that is still settling (its rows, runes and road): a click, not a tap that waits for it to hold still
  const restart = page.getByRole('button', { name: /^(Restart Block Zero|Reset with Block Zero)$/ })
  await expect(restart).toBeVisible({ timeout: 20_000 })
  await restart.dispatchEvent('click')
  await page.getByRole('button', { name: 'START BLOCK ZERO', exact: true }).tap()
  const board = page.getByRole('dialog', { name: 'Start Block Zero' })
  await expect(board).toBeVisible()
  return board
}

test('START WHEN?: seven days, TODAY lit, the line follows the tile; closing starts nothing', async ({ page, api }) => {
  const before = await api.get<{ id: string } | null>(`/api/blocks/current?date=${todayISO()}`)
  const board = await openRestart(page)
  await expect(board.getByRole('img', { name: 'START WHEN?' })).toBeVisible()
  const days = board.getByRole('group', { name: 'Start day' }).getByRole('button')
  await expect(days).toHaveCount(7)
  await expect(days.nth(0)).toHaveAccessibleName(/^today, \w{3} \d+$/)
  await expect(days.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await expect(days.nth(1)).toHaveAccessibleName(/^tomorrow, \w{3} \d+$/)
  const third = addDaysISO(todayISO(), 2)
  await expect(days.nth(2)).toHaveAccessibleName(`${DAY3[dowOf(third)]}, ${Number(third.slice(8))}`)
  await expect(board.locator('.sd-what')).toHaveText(/^Starts (today|Mon \d+ \w{3})\. /)
  // a tile lights and the line changes with it
  await days.nth(2).tap()
  await expect(days.nth(2)).toHaveAttribute('aria-pressed', 'true')
  await expect(days.nth(0)).toHaveAttribute('aria-pressed', 'false')
  await expect(board.locator('.sd-what')).toHaveText(dowOf(third) === 1 ? /Week 1 starts that day\.$/ : /lead-in days?, all optional\. Week 1 starts Mon \d+ \w{3}\.$/)
  await expect(board.getByRole('button', { name: 'START' })).toBeVisible()

  // page 61: CLOSE, or a tap on the dim forest, and nothing starts
  await board.getByRole('button', { name: 'Close' }).tap()
  await expect(page.getByRole('dialog', { name: 'Start Block Zero' })).toHaveCount(0)
  await page.getByRole('button', { name: 'START BLOCK ZERO', exact: true }).tap()
  await expect(page.getByRole('dialog', { name: 'Start Block Zero' })).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(page.getByRole('dialog', { name: 'Start Block Zero' })).toHaveCount(0)
  const after = await api.get<{ id: string } | null>(`/api/blocks/current?date=${todayISO()}`)
  expect(after?.id).toBe(before?.id)
})

test('A start tomorrow: the countdown, and under it the planned week on Program and the Tomorrow preview on Today', async ({ page, api }) => {
  const today = todayISO()
  const tomorrow = addDaysISO(today, 1)
  const startEpoch = epoch(tomorrow)
  // the start's week: the lead-in from a mid-week start (today is in it), or week 1 from a Monday (next week)
  const sameWeek = dowOf(tomorrow) !== 1
  await setMorning(api)
  const board = await openRestart(page)
  await board.getByRole('group', { name: 'Start day' }).getByRole('button').nth(1).tap()
  await board.getByRole('button', { name: 'START' }).tap()

  // Program: the waiting board stays, and the start's week shows below it, opened on the start day
  await expect(page.getByRole('button', { name: 'CHANGE DAY' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('img', { name: `STARTS ${DAY3[dowOf(tomorrow)]}` })).toBeVisible()
  const days = page.getByRole('tablist', { name: 'Days of the week' })
  await expect(days).toBeVisible({ timeout: 20_000 })
  const startTab = days.locator(`[data-day="${startEpoch}"]`)
  await expect(startTab).toHaveAttribute('aria-selected', 'true')
  await expect(startTab).toHaveAccessibleName(/, [1-9] sessions?(,|$)/)
  const dayBoard = page.locator('.db-glass').filter({ hasText: 'day board' })
  await expect(dayBoard).toContainText(/Foundation/i)
  if (sameWeek) {
    // the days before the start: empty and dim, nothing to add
    const todayTab = days.locator(`[data-day="${epoch(today)}"]`)
    await expect(todayTab).toHaveClass(/is-before/)
    await expect(todayTab).toHaveAccessibleName(/, 0 sessions(,|$)/)
    await todayTab.tap()
    await expect(dayBoard).toContainText('Before the start. Nothing planned.')
    await expect(dayBoard.getByRole('button', { name: '+ add session' })).toHaveCount(0)
  }

  // Today: the same board, and under it the start day's sessions as page 43's Tomorrow row
  await page.route('**/api/sessions/today?*', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await page.goto('/today?resume=0')
  await expect(page.getByRole('button', { name: 'CHANGE DAY' })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.td-next .lbl')).toHaveText('Tomorrow')
  await expect(page.locator('.td-nextline')).toContainText(/Foundation/i)
  if (sameWeek) {
    // the week strip: tomorrow's planned icons; today is not a rest day
    await expect(page.locator(`.td-t7[data-day="${startEpoch}"] .ic`).first()).toBeVisible()
    await expect(page.locator(`.td-t7[data-day="${epoch(today)}"]`)).not.toHaveAccessibleName(/, rest\./)
  }
  await page.unroute('**/api/sessions/today?*')

  // back to a started Block Zero for the next test: CHANGE DAY to today on Program
  await page.goto('/program')
  await page.getByRole('button', { name: 'CHANGE DAY' }).tap()
  const change = page.getByRole('dialog', { name: 'Change start day' })
  await change.getByRole('group', { name: 'Start day' }).getByRole('button').nth(0).tap()
  await change.getByRole('button', { name: 'SAVE' }).tap()
  await expect(page.getByRole('group', { name: 'Weeks of the block' })).toBeVisible({ timeout: 20_000 })
})

test('A later day: nothing planned before it, the waiting board on Program and Today, CHANGE DAY to today starts it', async ({ page, api }) => {
  const today = todayISO()
  const tomorrow = addDaysISO(today, 1)
  await setMorning(api)
  const board = await openRestart(page)
  await board.getByRole('group', { name: 'Start day' }).getByRole('button').nth(1).tap()
  await board.getByRole('button', { name: 'START' }).tap()

  // Program: only the waiting board (no assessment offline; the start's week is prepared)
  await expect(page.getByRole('button', { name: 'CHANGE DAY' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('img', { name: `STARTS ${DAY3[dowOf(tomorrow)]}` })).toBeVisible()
  await expect(page.getByRole('img', { name: 'TOMORROW' })).toBeVisible()
  await expect(page.getByText('BLOCK ZERO', { exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Weeks of the block' })).toHaveCount(0)

  // the data: the start is tomorrow at noon UTC; nothing of the new block is planned today
  const block = await api.get<{ id: string; blockType: string; startedAt: number; status: string }>(`/api/blocks/current?date=${today}`)
  expect(block).toMatchObject({ blockType: 'block_zero', status: 'active' })
  expect(dayOf(block.startedAt)).toBe(epoch(tomorrow))
  expect(block.startedAt % 86400).toBe(12 * 3600)
  const todays = await api.get<Array<{ status: string; source?: string | null }>>(`/api/sessions/today?date=${today}`)
  expect(todays.filter(s => s.status === 'planned' && s.source === 'template')).toHaveLength(0)

  // Today, on a day with nothing done: the same board instead of NOTHING TODAY
  await page.route('**/api/sessions/today?*', route => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await page.goto('/today?resume=0')
  await expect(page.getByRole('button', { name: 'CHANGE DAY' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('img', { name: 'NOTHING TODAY' })).toHaveCount(0)
  await expect(page.locator('.sd-wait')).toContainText(dowOf(tomorrow) === 1 ? 'Week 1 starts that day.' : 'easy lead-in day')

  // CHANGE DAY: the same board, tomorrow lit, "Change start day", SAVE; TODAY starts it now
  await page.getByRole('button', { name: 'CHANGE DAY' }).tap()
  const change = page.getByRole('dialog', { name: 'Change start day' })
  await expect(change).toBeVisible()
  const days = change.getByRole('group', { name: 'Start day' }).getByRole('button')
  await expect(days.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await days.nth(0).tap()
  await page.unroute('**/api/sessions/today?*')
  await change.getByRole('button', { name: 'SAVE' }).tap()
  await expect(page.getByRole('dialog', { name: 'Change start day' })).toHaveCount(0)

  // the start day's morning: one line on top of the day
  await expect(page.getByRole('img', { name: /^BLOCK ZERO · (DAY|WEEK) 1$/ })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.sd-dayone p')).toHaveText(/^(Lead-in day, (both |all )?optional\. Week 1 starts Mon\.|Day 1 of 6 weeks\.)$/)
  const now = await api.get<{ startedAt: number }>(`/api/blocks/current?date=${today}`)
  expect(dayOf(now.startedAt)).toBe(epoch(today))
  // a started block keeps its day
  await expect(api.post(`/api/blocks/${block.id}/start-day`, { startDate: tomorrow, today })).rejects.toThrow(/-> 409/)
})
