import { test, expect, type Api } from './fixtures'
import { enterFromToday, gotoToday, insertSession } from './support/helpers'
import { setMorning } from './support/data'

/**
 * Page 76 (hard runs and the 5K, approved 2026-10-23): Settings' Treadmill
 * speed plates (KM/H | MPH: tap picks, tap again unpicks), and a hard run's
 * ready board and run screen (RUN HARD / EASY JOG big, SPEED and INCLINE, NEXT
 * small; the first cue from the bundled clips). Written from the code; the
 * hard run's part runs only where the run model gives this athlete a hard
 * dose (he runs 10 min straight), else it is skipped.
 */

interface RunWorkout { prescription: { hard?: { kind: string; reps: number } | null } | null }

test('Settings: Treadmill speed plates pick, unpick, and stay', async ({ page, api }) => {
  await api.patch('/api/settings', { treadmillUnit: null })
  await gotoToday(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).tap()
  const group = page.getByRole('group', { name: 'Treadmill speed' })
  await expect(group).toBeVisible()
  const kmh = group.getByRole('button', { name: 'Kilometres per hour' })
  const mph = group.getByRole('button', { name: 'Miles per hour' })
  await expect(kmh).toHaveAttribute('aria-pressed', 'false')
  await expect(mph).toHaveAttribute('aria-pressed', 'false')

  await mph.tap()
  await expect(mph).toHaveAttribute('aria-pressed', 'true')
  await expect(kmh).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await api.get<{ treadmillUnit: string | null }>('/api/settings')).treadmillUnit).toBe('mph')

  // Tap the lit one again: neither is picked, both units show.
  await mph.tap()
  await expect(mph).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await api.get<{ treadmillUnit: string | null }>('/api/settings')).treadmillUnit).toBe(null)

  await kmh.tap()
  await page.reload()
  await expect(page.getByRole('group', { name: 'Treadmill speed' }).getByRole('button', { name: 'Kilometres per hour' })).toHaveAttribute('aria-pressed', 'true')
  await api.patch('/api/settings', { treadmillUnit: null })
})

async function hardRun(api: Api) {
  await setMorning(api)
  const s = await insertSession(api, 'running', 'am', { runCategory: 'intervals', label: 'Intervals' })
  const w = await api.get<RunWorkout>(`/api/sessions/${s.id}/run-workout`)
  return { s, hard: w.prescription?.hard ?? null }
}

test('A hard run: the ready board in words, then RUN HARD / EASY JOG with SPEED and INCLINE, NEXT small, and the cue', async ({ page, api }) => {
  await api.patch('/api/settings', { treadmillUnit: 'kmh' })
  const { s, hard } = await hardRun(api)
  test.skip(!hard || hard.kind !== 'intervals', 'no hard dose for this athlete (the run model needs 10 min straight)')
  await enterFromToday(page, s.id)
  const ready = page.getByRole('dialog', { name: /, ready$/ })
  await expect(ready).toBeVisible()
  // In words: run hard 2 min, then jog 2 min, N times; the speeds; incline 1; the heart's top.
  await expect(ready.getByText('Run hard', { exact: true })).toBeVisible()
  await expect(ready.getByText('Then jog', { exact: true })).toBeVisible()
  await expect(ready.getByRole('img', { name: String(hard!.reps) })).toBeVisible()
  await ready.getByRole('radio', { name: 'INDOOR' }).tap()
  await expect(ready.getByText('Hard speed')).toBeVisible()
  await expect(ready.getByText('Incline')).toBeVisible()
  await expect(ready.getByRole('img', { name: /^UP TO \d+$/ })).toBeVisible()
  // Outside: the paces instead.
  await ready.getByRole('radio', { name: 'OUTDOOR' }).tap()
  await expect(ready.getByText('Hard pace')).toBeVisible()
  await ready.getByRole('radio', { name: 'INDOOR' }).tap()

  await ready.getByRole('button', { name: 'START RUN' }).tap()
  await expect(page.getByRole('timer')).toBeVisible()
  // The warm-up is easy: EASY, the speed and the incline, and NEXT run hard 2:00.
  await expect(page.getByRole('img', { name: 'EASY' })).toBeVisible()
  await expect(page.getByText('SPEED')).toBeVisible()
  await expect(page.getByText('INCLINE')).toBeVisible()
  await expect(page.getByText('NEXT')).toBeVisible()
  await expect(page.getByText('run hard 2:00')).toBeVisible()
  // No "What:" bar.
  await expect(page.getByText(/^What:/)).toHaveCount(0)
  // The recorder plays the first cue (a chime, then "Easy run. Speed ...").
  await expect.poll(async () => page.evaluate(() => ((window as unknown as { __wmCueLog?: string[][] }).__wmCueLog ?? [])[0]?.slice(0, 3).join(',') ?? ''), { timeout: 8000 }).toBe('chime_jog,zone2_run,speed')
  await api.patch('/api/settings', { treadmillUnit: null })
})
