import { test, expect } from './fixtures'
import { enterFromToday, insertSession, throughWarmup, timerSeconds } from './support/helpers'
import { setMorning } from './support/data'

interface RunWalk { runSec: number; walkSec: number; rounds: number; warmupSec: number; capped: boolean }

/**
 * Block Zero's run-walk (page 56: RUN-WALK): the Zone 2 warm-up, the ready
 * card, then the intervals: RUN, then WALK, round after round, on a test clock.
 */
test('Run-walk: warm-up, ready card, then run and walk intervals', async ({ page, api }) => {
  await setMorning(api)
  const s = await insertSession(api, 'foundation_run', 'am')
  await enterFromToday(page, s.id)

  // The Zone 2 warm-up: six moves, each skipped the way a thumb would.
  await expect(page.getByRole('img', { name: '1 OF 6' })).toBeVisible()
  const ready = page.getByRole('dialog', { name: /Run, ready$/ })
  await throughWarmup(page, () => ready.isVisible())

  const { prescription } = await api.get<{ prescription: { runWalk: RunWalk; targetDesc: string } }>(`/api/sessions/${s.id}/foundation-run-workout`)
  const rw = prescription.runWalk
  test.info().annotations.push({ type: 'run-walk', description: `${rw.rounds} rounds, run ${rw.runSec}s / walk ${rw.walkSec}s, warm-up ${rw.warmupSec}s${rw.capped ? ' (capped)' : ''}: ${prescription.targetDesc}` })
  await expect(ready.getByRole('radio', { name: 'OUTDOOR' })).toBeVisible()
  await expect(ready).toHaveScreenshot('run-walk-ready.png')

  // Indoors: START RUN doesn't open Strava.
  await ready.getByRole('radio', { name: 'INDOOR' }).tap()
  await ready.getByRole('button', { name: 'START RUN' }).tap()
  await expect(page.getByRole('timer')).toBeVisible()

  // The run guards can cap a week's run volume (then it's an easy walk, no intervals).
  test.skip(rw.rounds === 0, `capped to an easy walk by the run guards: ${prescription.targetDesc}`)

  // Its brisk-walk lead-in first, when there is one.
  const count = (w: string) => page.getByRole('img', { name: w, exact: true })
  if (rw.warmupSec > 0) {
    await expect(count('WARM-UP')).toBeVisible()
    await page.clock.fastForward(rw.warmupSec * 1000 + 500)
  }
  await expect(count(`RUN 1/${rw.rounds}`)).toBeVisible()
  const runLeft = await timerSeconds(page)
  expect(runLeft).toBeLessThanOrEqual(rw.runSec)
  expect(runLeft).toBeGreaterThan(rw.runSec - 5)
  await expect(page).toHaveScreenshot('run-walk-run.png', { mask: [page.getByRole('timer')] })

  await page.clock.fastForward(rw.runSec * 1000)
  await expect(count(`WALK 1/${rw.rounds}`)).toBeVisible()
  expect(await timerSeconds(page)).toBeLessThanOrEqual(rw.walkSec)
  await expect(page).toHaveScreenshot('run-walk-walk.png', { mask: [page.getByRole('timer')] })

  await page.clock.fastForward(rw.walkSec * 1000)
  await expect(count(`RUN 2/${rw.rounds}`)).toBeVisible()
})
