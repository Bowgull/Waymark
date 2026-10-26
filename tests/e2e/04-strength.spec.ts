import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { enterFromToday, gotoToday, grass, insertSession, openRow, swipeUpGrass, todayRow } from './support/helpers'
import { GOOD_MORNING, setMorning } from './support/data'
import { makeApiFor } from './support/api'

const DUMBBELL_MAIN = /^(Goblet Squat|Dumbbell Row|DB Overhead Press|DB Romanian Deadlift|DB Bench Press)$/

interface WorkoutSet { id: string; isWarmup: number; weightKg: number | null; reps: number; completedAt: number | null }
interface Workout { exercises: Array<{ section: string; exercise: { name: string; equipment: string }; sets: WorkoutSet[] }> }

/** Tap through the warm-up sets (LOG SET, then a swipe up the rest's grass) until `until` shows. */
async function stepUntil(page: Page, until: () => Promise<boolean>, max = 60) {
  for (let i = 0; i < max; i++) {
    if (await until()) return
    // Block Zero asks how many reps were left after a working set (one tap, rest starts).
    const effort = page.getByRole('group', { name: 'Reps left' })
    if (await effort.isVisible()) { await effort.getByRole('button').nth(1).tap(); continue }
    // page 84: the rest (and the rope warm-up) have no button; a swipe up the grass moves on
    if (await grass(page).isVisible()) { await swipeUpGrass(page); await page.waitForTimeout(250); continue }
    for (const name of ['LOG SET', 'NEXT EXERCISE', 'NEXT', 'CONTINUE']) {
      const b = page.getByRole('button', { name, exact: true })
      if (await b.isVisible()) { await b.tap(); break }
    }
    await page.waitForTimeout(250)
  }
  throw new Error('never reached the step')
}

test.afterAll(async ({ request }) => {
  await setMorning(makeApiFor(request), GOOD_MORNING)
})

test('Strength: a dumbbell main lift takes its weight in lb from the stepper', async ({ page, api }) => {
  // A sore back this morning: Block Zero swaps the barbell main lifts for their
  // dumbbell versions (goblet squat, dumbbell row, DB press).
  await setMorning(api, { ...GOOD_MORNING, backToday: 2 })
  const s = await insertSession(api, 'strength')
  await enterFromToday(page, s.id)

  const mainLift = page.getByRole('img', { name: DUMBBELL_MAIN })
  await stepUntil(page, async () => (await page.getByRole('group', { name: 'Weight in pounds' }).isVisible()) && (await mainLift.first().isVisible()))
  const liftName = (await mainLift.first().getAttribute('aria-label'))!

  const weight = page.getByRole('group', { name: 'Weight in pounds' })
  await expect(page.getByText('Weight · lbs')).toBeVisible()
  const read = async () => Number(await weight.getByRole('img').first().getAttribute('aria-label'))
  const before = await read()
  // No load history for this lift in the demo seed: it may start at 0 lb.
  expect(before).toBeGreaterThanOrEqual(0)

  await weight.getByRole('button', { name: 'More weight' }).tap()
  const up = await read()
  expect(up).toBeGreaterThan(before)
  await weight.getByRole('button', { name: 'More weight' }).tap()
  await weight.getByRole('button', { name: 'Less weight' }).tap()
  expect(await read()).toBe(up)
  await expect(weight).toHaveScreenshot('strength-dumbbell-weight.png')

  await page.getByRole('button', { name: 'LOG SET', exact: true }).tap()

  // The logged set carries the lb shown, stored as kg.
  await expect.poll(async () => {
    const w = await api.get<Workout>(`/api/sessions/${s.id}/workout`)
    const ex = w.exercises.find(e => e.exercise.name === liftName)
    const done = ex?.sets.filter(x => x.completedAt != null) ?? []
    return done.length > 0 ? Math.round((done.at(-1)!.weightKg ?? 0) * 2.20462) : null
  }, { timeout: 10_000 }).toBe(up)

})

// Page 93 (rebuild Phase 5): the landmine on the same set screen. The number is what slides onto
// the bar end, "Bar only" at 0, one 2.5 lb plate a step, the plates to grab under it.
test('Strength: the landmine punch reads lbs on the bar end, bar only, then plates', async ({ page, api }) => {
  await setMorning(api, GOOD_MORNING)
  const s = await insertSession(api, 'strength', 'pm', { label: 'Strength B' })
  await enterFromToday(page, s.id)
  const punch = page.getByRole('img', { name: 'LANDMINE PUNCH' })
  await stepUntil(page, async () => (await page.getByRole('group', { name: 'Weight in pounds' }).isVisible()) && (await punch.first().isVisible()))
  await expect(page.getByText('Weight · lbs on the bar end')).toBeVisible()
  const weight = page.getByRole('group', { name: 'Weight in pounds' })
  const read = async () => Number(await weight.getByRole('img').first().getAttribute('aria-label'))
  expect(await read()).toBe(0)
  await expect(page.getByText('Bar only', { exact: true })).toBeVisible()
  await weight.getByRole('button', { name: 'More weight' }).tap()
  expect(await read()).toBe(2.5)
  await weight.getByRole('button', { name: 'More weight' }).tap()
  await weight.getByRole('button', { name: 'More weight' }).tap()
  await weight.getByRole('button', { name: 'More weight' }).tap()
  expect(await read()).toBe(10)
  await expect(page.getByText('1× 10', { exact: true })).toBeVisible()
  // The built reps-left card after LOG SET, as on every lift (no bar-speed tap).
  await page.getByRole('button', { name: 'LOG SET', exact: true }).tap()
  await expect(page.getByRole('group', { name: 'Reps left' })).toBeVisible()
})

// Page 93: Strength A's PRESS line says which press, and one plain line why behind a tap.
test('Strength: the PRESS line opens why this press', async ({ page, api }) => {
  await setMorning(api, GOOD_MORNING)
  const s = await insertSession(api, 'strength', 'pm', { label: 'Strength A' })
  await gotoToday(page)
  const row = todayRow(page, s.id)
  await openRow(row)
  const press = row.getByRole('button', { name: 'PRESS: why' })
  await expect(press).toContainText(/landmine · \d×8 · /)
  await press.tap()
  await expect(page.getByRole('dialog', { name: 'PRESS: why' })).toContainText('Landmine press while your shoulders and back rebuild.')
})
