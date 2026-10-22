import { test, expect } from './fixtures'
import type { Api } from './fixtures'
import { dayRow } from './support/helpers'
import { GOOD_MORNING } from './support/data'

/**
 * Class days (coach brain P4; coach-brain §9, page 70 layout A, approved 2026-10-21):
 * - Settings › Training › MT class days keeps the day row; under each lit day a
 *   slot flap (sun AM, moon PM, both + gold ANY) that a tap flips AM → PM → ANY;
 *   unlit days show nothing; a newly lit day starts ANY on the weekend, PM on a
 *   weekday; the sub line reads as approved.
 * - The nightly pass places a class on a class day as a coach change: a Dagaz
 *   rune on that day, one plain why, UNDO that takes it off.
 *
 * Runs last: the second test runs the nightly pass for a day two weeks ahead
 * (the scratch backend is started with --test-scheduled), which rolls the
 * days before it over.
 */
test.describe.configure({ mode: 'serial', retries: 0 })

interface SettingsRow { mtClassDays: string | null; mtClassSlots?: string | null }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const API_URL = () => process.env.E2E_API_URL as string

test('Settings: a slot flap under each lit class day flips AM → PM → ANY (page 70 A)', async ({ page, api }) => {
  const before = await api.get<SettingsRow>('/api/settings')
  await api.patch('/api/settings', { mtClassDays: '1,3', mtClassSlots: 'mon:pm,wed:pm' })
  await page.goto('/settings')
  await expect(page.getByText('Classes are booked outside the app. Pick the days, and morning, evening or either.', { exact: true })).toBeVisible()
  const days = page.getByRole('group', { name: 'MT class days' })
  const slots = page.getByRole('group', { name: 'MT class slots' })
  // The day row is as it was: seven days; one slot flap under each lit day, nothing under the rest.
  await expect(days.getByRole('button')).toHaveCount(7)
  await expect(slots.getByRole('button')).toHaveCount(2)
  await expect(slots.locator('.st-slot.is-off')).toHaveCount(5)

  // Monday: PM (the moon) → ANY (both, gold) → AM (the sun).
  const mon = slots.getByRole('button', { name: /^Monday class:/ })
  await expect(mon).toHaveAccessibleName('Monday class: evening. Change')
  await expect(mon.getByRole('img', { name: 'PM' })).toBeVisible()
  await expect(mon.locator('svg.st-mk')).toHaveCount(1)
  await mon.tap()
  await expect(mon).toHaveAccessibleName('Monday class: either. Change')
  await expect(mon.getByRole('img', { name: 'ANY' })).toBeVisible()
  await expect(mon.locator('svg.st-mk')).toHaveCount(2)
  await mon.tap()
  await expect(mon).toHaveAccessibleName('Monday class: morning. Change')
  await expect(mon.getByRole('img', { name: 'AM' })).toBeVisible()

  // A newly lit day: Saturday starts ANY, Tuesday PM. Unlit again, its flap goes.
  await days.getByRole('button', { name: 'Saturday' }).tap()
  await expect(slots.getByRole('button', { name: 'Saturday class: either. Change' })).toBeVisible()
  await days.getByRole('button', { name: 'Tuesday' }).tap()
  await expect(slots.getByRole('button', { name: 'Tuesday class: evening. Change' })).toBeVisible()
  await days.getByRole('button', { name: 'Saturday' }).tap()
  await expect(slots.getByRole('button', { name: /^Saturday class/ })).toHaveCount(0)
  await expect(slots.getByRole('button')).toHaveCount(3)

  if (process.env.P4_SHOTS) await page.locator('.st-board').first().screenshot({ path: `${process.env.P4_SHOTS}/settings-class-days.png` })
  // Saved as "mon:am,tue:pm,wed:pm" (the days still in mt_class_days), and there on the next open.
  await expect.poll(async () => (await api.get<SettingsRow>('/api/settings')).mtClassSlots, { timeout: 10_000 }).toBe('mon:am,tue:pm,wed:pm')
  expect((await api.get<SettingsRow>('/api/settings')).mtClassDays?.split(',').sort().join(',')).toBe('1,2,3')
  await page.reload()
  await expect(page.getByRole('group', { name: 'MT class slots' }).getByRole('button', { name: 'Monday class: morning. Change' })).toBeVisible()

  await api.patch('/api/settings', { mtClassDays: before.mtClassDays ?? '1,3,5', mtClassSlots: before.mtClassSlots ?? null })
})

/** The nightly pass for local day `day` (YYYY-MM-DD), as the cron runs it (small hours there). */
async function nightly(request: import('@playwright/test').APIRequestContext, day: string) {
  const res = await request.get(`${API_URL()}/cdn-cgi/handler/scheduled?time=${Date.parse(`${day}T07:00:00Z`)}`)
  expect(res.ok()).toBe(true)
}

async function weekChanges(api: Api, monday: string) {
  return (await api.get<{ changes: Array<{ id: string; day: number; actor: string; kind: string; session: { id: string | null; type: string }; why: string; lock: string }> }>(`/api/weeks/${monday}/changes?today=${monday}`)).changes
}

test('the coach places a class on a class day: a Dagaz rune on Program, one plain why, UNDO takes it off', async ({ page, api, request }) => {
  await api.patch('/api/settings', { mtClassDays: '1,3,5', mtClassSlots: 'mon:pm,wed:pm,fri:pm' })
  // A Monday two weeks ahead: nothing planned there yet. He checked in the day before (he's active).
  const now = new Date()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() + (((8 - monday.getUTCDay()) % 7) || 7) + 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() - 1)
  await api.post('/api/daily-logs', { date: iso(sunday), sleepHours: 8, sleepQuality: 4, energy: 4, soreness: 2, stress: 2, mood: 4, backToday: 4 })
  await nightly(request, iso(monday))

  const add = (await weekChanges(api, iso(monday))).find(c => c.kind === 'add' && c.session.type === 'mt_class')
  expect(add, 'a class placed on a class day').toBeTruthy()
  expect(add!.actor).toBe('coach')
  expect(add!.why).toMatch(/^Of your class days, (Monday|Wednesday|Friday)/)
  expect(add!.why).not.toMatch(/night/i)
  expect(add!.lock).toBe('open')
  const dayIso = iso(new Date(add!.day * 86400000))

  // That Monday (the phone's clock moved there), on Program (page 73): the class day's row carries
  // the Dagaz rune; the rune opens the why-line with KEEP and UNDO; UNDO puts it back (an added
  // session: no REDO, the window shows the put-back line).
  // All nine check-in answers for that morning, so the deck stays closed.
  await api.post('/api/daily-logs', { date: iso(monday), ...GOOD_MORNING })
  const [y, m, d] = iso(monday).split('-').map(Number)
  await page.clock.setSystemTime(new Date(y, m - 1, d, 10, 0, 0))
  await page.goto('/program')
  const row = dayRow(page, add!.day)
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).toHaveAttribute('aria-label', /The coach changed it\./)
  await expect(row.locator('.wm-rune')).toBeAttached()
  await row.getByRole('button', { name: 'What the coach changed' }).tap()
  const win = page.getByRole('dialog', { name: 'What the coach changed' })
  await expect(win).toBeVisible()
  await expect(win.locator('.pl-say')).toHaveText(/Of your class days/)
  await expect(win.getByRole('button', { name: 'Keep' })).toBeVisible()
  await win.getByRole('button', { name: 'Undo' }).tap()
  await expect(win.locator('.pl-say')).not.toHaveText(/Of your class days/)
  await expect(win.locator('.pl-say')).toHaveText(/\w/)
  await expect(win.getByRole('button', { name: 'Redo' })).toHaveCount(0)

  // UNDO took the class off the week, and the coach leaves the week as it is.
  await expect.poll(async () => (await weekChanges(api, iso(monday))).find(c => c.id === add!.id)?.lock).toBe('undone')
  const left = await api.get<Array<{ id: string }>>(`/api/sessions/today?date=${dayIso}`)
  expect(left.some(s => s.id === add!.session.id)).toBe(false)
})
