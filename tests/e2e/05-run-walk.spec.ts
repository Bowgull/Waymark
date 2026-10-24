import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { enterFromToday, grass, insertSession, swipeUpGrass, throughWarmup, timerSeconds } from './support/helpers'
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
  // The ready board carries the run's one name from its dose (Run-Walk, Zone 2 Run, or Easy Walk or Bike).
  const ready = page.getByRole('dialog', { name: /^(Run-Walk|Zone 2 Run|Easy Walk or Bike), ready$/ })
  await throughWarmup(page, () => ready.isVisible())

  const { prescription } = await api.get<{ prescription: { runWalk: RunWalk; targetDesc: string } }>(`/api/sessions/${s.id}/foundation-run-workout`)
  const rw = prescription.runWalk
  test.info().annotations.push({ type: 'run-walk', description: `${rw.rounds} rounds, run ${rw.runSec}s / walk ${rw.walkSec}s, warm-up ${rw.warmupSec}s${rw.capped ? ' (capped)' : ''}: ${prescription.targetDesc}` })
  await expect(ready.getByRole('radio', { name: 'OUTDOOR' })).toBeVisible()
  await expect(ready).toHaveScreenshot('run-walk-ready.png')

  // Indoors: START RUN doesn't open Strava (a walk-only day reads START).
  await ready.getByRole('radio', { name: 'INDOOR' }).tap()
  await ready.getByRole('button', { name: /^START( RUN)?$/ }).tap()
  await expect(page.getByRole('timer')).toBeVisible()

  // The run guards can cap a week's run volume (then it's an easy walk, no intervals).
  test.skip(rw.rounds === 0, `capped to an easy walk by the run guards: ${prescription.targetDesc}`)

  // Its brisk-walk lead-in first, when there is one.
  // Page 84: the count sits under the clock in the bag round's language (ROUND n OF 6, walking NEXT).
  const count = (w: string) => page.getByRole('img', { name: w, exact: true })
  if (rw.warmupSec > 0) {
    await expect(count(`Next 1 of ${rw.rounds}`)).toBeVisible()
    await page.clock.fastForward(rw.warmupSec * 1000 + 500)
  }
  await expect(count(`Round 1 of ${rw.rounds}`)).toBeVisible()
  const runLeft = await timerSeconds(page)
  expect(runLeft).toBeLessThanOrEqual(rw.runSec)
  expect(runLeft).toBeGreaterThan(rw.runSec - 5)
  await expect(page).toHaveScreenshot('run-walk-run.png', { mask: [page.getByRole('timer')] })

  await page.clock.fastForward(rw.runSec * 1000)
  if (rw.rounds > 1) await expect(count(`Next 2 of ${rw.rounds}`)).toBeVisible()
  else await expect(count('WALK')).toBeVisible()
  expect(await timerSeconds(page)).toBeLessThanOrEqual(rw.walkSec)
  await expect(page).toHaveScreenshot('run-walk-walk.png', { mask: [page.getByRole('timer')] })

  await page.clock.fastForward(rw.walkSec * 1000)
  if (rw.rounds > 1) await expect(count(`Round 2 of ${rw.rounds}`)).toBeVisible()

  // Page 85: the swipes move the plan's pieces, never the run. Up: the walk after round 2 now.
  if (rw.rounds < 3 || rw.walkSec <= 10) return
  await expect(grass(page)).toHaveAccessibleName(/Swipe up to skip\. Swipe down to go back\. Hold for 3 seconds to finish\.$/)
  await swipeUpGrass(page)
  await expect(count(`Next 3 of ${rw.rounds}`)).toBeVisible()
  expect(await timerSeconds(page)).toBeGreaterThan(rw.walkSec - 3)
  // 10 s in, down: the walk again from the top; down again within 3 s: round 2's run.
  await page.clock.fastForward(10_000)
  expect(await timerSeconds(page)).toBeLessThanOrEqual(rw.walkSec - 9)
  await swipeDownGrass(page)
  await expect.poll(() => timerSeconds(page)).toBeGreaterThan(rw.walkSec - 3)
  await expect(count(`Next 3 of ${rw.rounds}`)).toBeVisible()
  await swipeDownGrass(page)
  await expect(count(`Round 2 of ${rw.rounds}`)).toBeVisible()
  expect(await timerSeconds(page)).toBeGreaterThan(rw.runSec - 3)
})

/** A finger drag down the grass, all the way: back (page 85). */
async function swipeDownGrass(page: Page) {
  const box = await grass(page).boundingBox()
  if (!box) throw new Error('no grass to swipe')
  const x = box.x + box.width / 2
  const y0 = box.y + 4
  await page.mouse.move(x, y0)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y0 + (box.height * 0.7 * i) / 8)
  await page.mouse.up()
}
