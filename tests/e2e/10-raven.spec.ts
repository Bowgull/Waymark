import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { addDaysISO, gotoToday, todayISO } from './support/helpers'
import type { Api } from './fixtures'

/**
 * Injury weather and the raven (page 58, approved 2026-10-19): the knee
 * keeps coming back (four reports in 17 days), the raven lands on the
 * Morning Report with its note; DO IT puts the plan on the week; the raven
 * returns the morning after the plan ends with one question; "Not now" waits
 * a day; STILL SORE gets one more plan, the last; STILL SORE again gives the
 * physio board, no third plan; FEELS BETTER clears it.
 *
 * Runs after 09-coach on the shared scratch DB. The reports are Foundation
 * sessions (never left out for a knee, so no "picked through" storm), the
 * days relative to today; the browser's clock moves on to each return
 * morning. Serial, no retries: each step builds on the one before.
 */
test.describe.configure({ mode: 'serial', retries: 0 })

const T = todayISO()
const at = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 10, 0, 0) }

async function skipKnee(api: Api, date: string) {
  const s = await api.post<{ id: string }>('/api/sessions/insert-ad-hoc', { type: 'mobility', timeSlot: 'pm', date, today: date })
  const out = await api.patch<{ changeId: string }>(`/api/sessions/${s.id}`, { status: 'skipped', today: date })
  await api.patch(`/api/changes/${out.changeId}/reason`, { reason: 'injury', detail: 'Knee', today: date })
}

interface Watch { alert: { id: string; stage: string; askDue: boolean; line: { text: string } | null } | null; weather: { level: number; quiet: boolean; clearing: boolean } }
const watch = (api: Api, iso: string) => api.get<Watch>(`/api/body/watch?today=${iso}`)
const raven = (page: Page) => page.getByRole('button', { name: 'The raven, about the knee. Tap to read.', exact: true })

test.beforeAll(async ({ request }) => {
  const { makeApiFor } = await import('./support/api')
  const api = makeApiFor(request)
  await skipKnee(api, addDaysISO(T, -16))
  await skipKnee(api, addDaysISO(T, -7))
  // His note on a session: a place and a pain word.
  const d2 = addDaysISO(T, -2)
  const s = await api.post<{ id: string }>('/api/sessions/insert-ad-hoc', { type: 'mobility', timeSlot: 'pm', date: d2, today: d2 })
  await api.post(`/api/sessions/${s.id}/complete`, { rpe: 4, notes: 'knee sore the last two rounds' })
  await skipKnee(api, T)
})

test('the knee keeps coming back: green rain, and the raven lands with a note', async ({ page, api }) => {
  const w = await watch(api, T)
  expect(w.alert?.stage).toBe('watch')
  expect(w.weather).toEqual({ level: 1, quiet: false, clearing: false })

  await gotoToday(page)
  await expect(raven(page)).toBeVisible()
  const report = page.locator('.td-mr')
  await expect(report.getByText('Knee: 4 times in 17 days.')).toBeVisible()
  await expect(report).toHaveClass(/has-raven/)
  // the world turns green behind the boards (the grade's colour layer)
  await expect(page.locator('.wm-world')).toHaveAttribute('data-weather', '1')

  await raven(page).tap()
  const note = page.getByRole('dialog', { name: /^From the raven: KNEE · 4 IN 17 DAYS$/ })
  await expect(note).toBeVisible()
  for (const s of ['What the coach noticed', 'Why it matters', 'The plan · 5 days']) await expect(note.getByText(s, { exact: true })).toBeVisible()
  await expect(note.locator('.rv-recl .ln')).toHaveCount(4)
  await expect(note.getByText(/^Your note on Foundation:/)).toContainText('knee sore the last two rounds')
  await expect(note.getByText(/past injury is the most common sign of the next one/)).toBeVisible()
  await expect(note.locator('.rv-recs li')).toHaveCount(3)
  await expect(note.getByText(/^DO IT puts these on your week, with UNDO\. GOT IT changes nothing\. The raven asks again /)).toBeVisible()
  await expect(note.getByRole('button', { name: 'GOT IT' })).toBeVisible()
  await expect(note.locator('.rv-advt')).toHaveScreenshot('raven-note-head.png')
  // read: the raven stops looking round
  await expect.poll(async () => (await watch(api, T)).alert?.stage).toBe('watch')

  // DO IT: the plan goes on the week as coach changes; the rain settles.
  await note.getByRole('button', { name: 'DO IT' }).tap()
  await expect(note).toBeHidden()
  await expect(page.getByText('PLAN ON').or(page.getByRole('img', { name: 'PLAN ON' })).first()).toBeVisible()
  await expect(report.getByText(/^Knee plan: bike to \w{3} \d+.* The raven's back \w{3} \d+/)).toBeVisible()
  const after = await watch(api, T)
  expect(after.alert?.stage).toBe('plan1')
  expect(after.weather.quiet).toBe(true)
  await expect(page.locator('.wm-world')).toHaveAttribute('data-weather', '1q')
})

test('the morning alarm carries the raven on its return morning', async ({ api }) => {
  const line = await api.get<{ line: string | null }>(`/api/coach/line?for=morning&day=${addDaysISO(T, 6)}&today=${addDaysISO(T, 5)}`)
  expect(line.line).toBe('The raven\'s back: how\'s the knee?')
})

test('the return: one question on top; "Not now" waits a day', async ({ page, api }) => {
  const d6 = addDaysISO(T, 6)
  await page.clock.setSystemTime(at(d6))
  await page.goto('/today?resume=0')
  const ask = page.getByRole('dialog', { name: 'The raven: HOW\'S THE KNEE?' })
  await expect(ask).toBeVisible({ timeout: 20_000 })
  await expect(ask.getByText(/^Five days of bike, no running\./)).toBeVisible()
  await expect(ask.getByRole('button', { name: 'FEELS BETTER' })).toBeVisible()
  await expect(ask.getByRole('button', { name: 'STILL SORE' })).toBeVisible()
  await expect(ask).toHaveScreenshot('raven-ask.png', { mask: [ask.locator('.from'), ask.locator('.rv-voice')] })

  await ask.getByRole('button', { name: 'Not now · ask me tomorrow' }).tap()
  await expect(ask).toBeHidden()
  const w = await watch(api, d6)
  expect(w.alert?.stage).toBe('ask1')
  expect(w.alert?.askDue).toBe(false)
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'The raven: HOW\'S THE KNEE?' })).toBeHidden()
})

test('still sore: one more plan, the last; then the physio board, no third plan', async ({ page, api }) => {
  const d7 = addDaysISO(T, 7)
  await page.clock.setSystemTime(at(d7))
  await page.goto('/today?resume=0')
  const ask = page.getByRole('dialog', { name: 'The raven: HOW\'S THE KNEE?' })
  await expect(ask).toBeVisible({ timeout: 20_000 })
  await ask.getByRole('button', { name: 'STILL SORE' }).tap()

  const plan2 = page.getByRole('dialog', { name: 'From the raven: KNEE · STILL SORE' })
  await expect(plan2).toBeVisible()
  await expect(plan2.getByText('One more plan')).toBeVisible()
  await expect(plan2.getByText('The plan · 7 more days')).toBeVisible()
  await expect(plan2.getByText(/This is the last change the coach makes for the knee\.$/)).toBeVisible()
  await expect(plan2.getByText('You said: still sore.')).toBeVisible()
  expect((await watch(api, d7)).weather.quiet).toBe(false)
  await plan2.getByRole('button', { name: 'DO IT' }).tap()
  await expect(plan2).toBeHidden()
  const w2 = await watch(api, d7)
  expect(w2.alert?.stage).toBe('plan2')

  // Seven more days: the raven again, and still sore.
  const d14 = addDaysISO(d7, 7)
  await page.clock.setSystemTime(at(d14))
  await page.goto('/today?resume=0')
  const ask2 = page.getByRole('dialog', { name: 'The raven: HOW\'S THE KNEE?' })
  await expect(ask2).toBeVisible({ timeout: 20_000 })
  await expect(ask2.getByText(/^Seven more days of bike, no running\. Last time it was still sore\.$/)).toBeVisible()
  await ask2.getByRole('button', { name: 'STILL SORE' }).tap()

  const physio = page.getByRole('dialog', { name: 'From the raven: KNEE · SEE A PHYSIO' })
  await expect(physio).toBeVisible()
  await expect(physio.getByText('See someone')).toBeVisible()
  await expect(physio.getByText('The coach recommends')).toBeVisible()
  await expect(physio.getByText(/^Book a physio or a doctor/)).toBeVisible()
  await expect(physio.getByText(/^Nothing is locked\./)).toBeVisible()
  await expect(physio.getByRole('button', { name: 'GOT IT' })).toBeVisible()
  await expect(physio.getByRole('button', { name: 'FEELS BETTER' })).toBeVisible()
  await expect(physio.getByRole('button', { name: 'DO IT' })).toHaveCount(0)
  await expect(physio.locator('.rv-advt')).toHaveScreenshot('raven-physio-head.png')

  // No third plan, ever; the rain stays.
  const id = (await watch(api, d14)).alert!.id
  await expect(api.post(`/api/body/watch/${id}/apply`, { today: d14 })).rejects.toThrow(/409/)
  const w3 = await watch(api, d14)
  expect(w3.alert?.stage).toBe('physio')
  expect(w3.weather.level).toBeGreaterThan(0)
  await physio.getByRole('button', { name: 'GOT IT' }).tap()
  await expect(physio).toBeHidden()
})

test('FEELS BETTER on the raven, any morning: the clearing', async ({ page, api }) => {
  const d15 = addDaysISO(T, 15)
  await page.clock.setSystemTime(at(d15))
  await page.goto('/today?resume=0')
  await expect.poll(async () => (await watch(api, d15)).alert?.stage).toBe('physio')
  const id = (await watch(api, d15)).alert!.id
  await api.post(`/api/body/watch/${id}/answer`, { answer: 'better', today: d15 })
  const w = await watch(api, d15)
  expect(w.alert?.stage).toBe('cleared')
  expect(w.weather).toEqual({ level: 0, quiet: false, clearing: true })
  expect(w.alert?.line?.text).toBe('Knee feels better.')
  // the day after, the sky is clear; then the raven is gone
  expect((await watch(api, addDaysISO(d15, 2))).alert).toBeNull()
})

test('Settings has no world, so no rain', async ({ page }) => {
  await gotoToday(page)
  await page.goto('/settings')
  await expect(page.locator('.wm-world')).toHaveAttribute('data-place', 'none')
  await expect(page.locator('.wm-weather-grade')).toHaveCSS('opacity', '0')
})
