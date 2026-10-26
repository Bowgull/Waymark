import { test, expect } from './fixtures'
import type { Api } from './fixtures'

/**
 * Class days (coach brain P4; coach-brain §9, page 70 layout A, approved 2026-10-21):
 * - Settings › Training › MT class days (page 76, approved 2026-10-23): one flap
 *   per day; a tap goes OFF → AM → PM → ANY → OFF; the lit tile shows its mark
 *   inside it (sun AM teal, moon PM clay, both ANY gold, nothing OFF); no slot
 *   row under the days; the sub line reads as approved.
 * - Rebuild Phase 2 (page 93): the week holds its classes on the Settings
 *   class days itself; new class days re-shape the week that night with no
 *   rune (he made the change).
 *
 * Runs last: the second test runs the nightly pass for a day two weeks ahead
 * (the scratch backend is started with --test-scheduled), which rolls the
 * days before it over.
 */
test.describe.configure({ mode: 'serial', retries: 0 })

interface SettingsRow { mtClassDays: string | null; mtClassSlots?: string | null }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const API_URL = () => process.env.E2E_API_URL as string

test('Settings: one flap per class day, a tap goes OFF → AM → PM → ANY → OFF (page 76)', async ({ page, api }) => {
  const before = await api.get<SettingsRow>('/api/settings')
  await api.patch('/api/settings', { mtClassDays: '1,3', mtClassSlots: 'mon:pm,wed:pm' })
  await page.goto('/settings')
  await expect(page.getByText('Classes are booked outside the app. Pick the days, and morning, evening or either.', { exact: true })).toBeVisible()
  const days = page.getByRole('group', { name: 'MT class days' })
  // Seven day flaps, nothing under them (page 70's slot row is gone).
  await expect(days.getByRole('button')).toHaveCount(7)
  await expect(page.getByRole('group', { name: 'MT class slots' })).toHaveCount(0)
  await expect(days.getByRole('button', { name: 'Tuesday class: off. Change' })).toBeVisible()
  await expect(days.getByRole('button', { name: 'Tuesday class: off. Change' }).locator('svg.st-mk')).toHaveCount(0)

  // Monday: PM (the moon, clay) → ANY (both, gold) → OFF (no mark) → AM (the sun, teal).
  const mon = days.getByRole('button', { name: /^Monday class:/ })
  await expect(mon).toHaveAccessibleName('Monday class: evening. Change')
  await expect(mon).toHaveAttribute('data-slot', 'pm')
  await expect(mon.locator('svg.st-mk')).toHaveCount(1)
  await expect(mon.getByRole('img', { name: 'MO' })).toHaveClass(/is-clay/)
  await mon.tap()
  await expect(mon).toHaveAccessibleName('Monday class: either. Change')
  await expect(mon.locator('svg.st-mk')).toHaveCount(2)
  await expect(mon.getByRole('img', { name: 'MO' })).toHaveClass(/is-gold/)
  await mon.tap()
  await expect(mon).toHaveAccessibleName('Monday class: off. Change')
  await expect(mon.locator('svg.st-mk')).toHaveCount(0)
  await mon.tap()
  await expect(mon).toHaveAccessibleName('Monday class: morning. Change')
  await expect(mon.locator('svg.st-mk')).toHaveCount(1)
  await expect(mon.getByRole('img', { name: 'MO' })).toHaveClass(/is-teal/)

  // An OFF day lights at AM, whatever the weekday; Saturday round to OFF again.
  const sat = days.getByRole('button', { name: /^Saturday class:/ })
  await sat.tap()
  await expect(sat).toHaveAccessibleName('Saturday class: morning. Change')
  await days.getByRole('button', { name: /^Tuesday class:/ }).tap()
  await days.getByRole('button', { name: /^Tuesday class:/ }).tap()
  await expect(days.getByRole('button', { name: /^Tuesday class:/ })).toHaveAccessibleName('Tuesday class: evening. Change')
  for (let i = 0; i < 3; i++) await sat.tap()
  await expect(sat).toHaveAccessibleName('Saturday class: off. Change')

  if (process.env.P4_SHOTS) await page.locator('.st-board').first().screenshot({ path: `${process.env.P4_SHOTS}/settings-class-days.png` })
  // Saved as "mon:am,tue:pm,wed:pm" (the days still in mt_class_days), and there on the next open.
  await expect.poll(async () => (await api.get<SettingsRow>('/api/settings')).mtClassSlots, { timeout: 10_000 }).toBe('mon:am,tue:pm,wed:pm')
  expect((await api.get<SettingsRow>('/api/settings')).mtClassDays?.split(',').sort().join(',')).toBe('1,2,3')
  await page.reload()
  await expect(page.getByRole('group', { name: 'MT class days' }).getByRole('button', { name: 'Monday class: morning. Change' })).toBeVisible()

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

test('the week holds a class on a class day; new class days re-shape the week that night with no rune (page 93)', async ({ api, request }) => {
  await api.patch('/api/settings', { mtClassDays: '1,3,5', mtClassSlots: 'mon:pm,wed:pm,fri:pm' })
  // A Monday two weeks ahead: nothing planned there yet. He checked in the day before (he's active).
  const now = new Date()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() + (((8 - monday.getUTCDay()) % 7) || 7) + 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() - 1)
  await api.post('/api/daily-logs', { date: iso(sunday), sleepHours: 8, sleepQuality: 4, energy: 4, soreness: 2, stress: 2, mood: 4, backToday: 4 })
  await nightly(request, iso(monday))

  const weekClasses = async () => {
    const out: Array<{ id: string; dow: number }> = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setUTCDate(d.getUTCDate() + i)
      const rows = await api.get<Array<{ id: string; type: string; status: string }>>(`/api/sessions/today?date=${iso(d)}`)
      for (const r of rows) if (r.type === 'mt_class' && r.status !== 'skipped') out.push({ id: r.id, dow: d.getUTCDay() })
    }
    return out
  }
  // Rebuild Phase 2: the one plan's week puts the class in itself (only on Settings days); no coach "add" rune.
  const placed = await weekClasses()
  expect(placed.length, 'a class in the week').toBeGreaterThan(0)
  expect(placed.every(c => [1, 3, 5].includes(c.dow))).toBe(true)
  expect((await weekChanges(api, iso(monday))).filter(c => c.kind === 'add' && c.session.type === 'mt_class')).toHaveLength(0)

  // New class days: that night the week re-shapes quietly, classes only on the new days.
  await api.patch('/api/settings', { mtClassDays: '2,4', mtClassSlots: 'tue:pm,thu:pm' })
  await nightly(request, iso(monday))
  const after = await weekClasses()
  expect(after.length).toBeGreaterThan(0)
  expect(after.every(c => [2, 4].includes(c.dow))).toBe(true)
  expect((await weekChanges(api, iso(monday))).filter(c => c.session.type === 'mt_class' && c.actor === 'coach')).toHaveLength(0)
  await api.patch('/api/settings', { mtClassDays: '1,3,5', mtClassSlots: 'mon:pm,wed:pm,fri:pm' })
})
