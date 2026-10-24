import { test, expect } from './fixtures'
import { enterFromToday, grass, grassPaused, grassToStart, insertSession, timerSeconds, swipeUpGrass } from './support/helpers'

/**
 * The bag round (page 55 layout 1) on a test clock: READY, then the round in
 * work (FIGHT), its last 10 s (FINISH, the heat) and the rest (REST, teal,
 * the next round's combo). Time moves by page.clock.fastForward; the clock
 * digits can be a second apart run to run, so they are masked with the combos.
 */
test('Bag round: ready, work, last 10 s, rest', async ({ page, api }) => {
  test.setTimeout(120_000)
  const bag = await insertSession(api, 'bag_work')
  await enterFromToday(page, bag.id)

  // The combos are drawn fresh for each session: masked in the screenshots.
  const combos = page.locator('.bw-zone')
  const digits = page.getByRole('timer')
  const phase = (name: string) => page.getByRole('img', { name, exact: true })

  // A session may open on its preview / skip-rope warm-up first (the warm-up starts on the grass, page 71).
  const begin = page.getByRole('button', { name: /^(BEGIN|START BAG WORK)$/ })
  const round1 = page.getByRole('img', { name: /^Round 1 of \d+$/ })
  const warmUp = page.getByRole('img', { name: 'SKIP ROPE', exact: true })
  for (let i = 0; i < 6 && !(await round1.isVisible()); i++) {
    if (await begin.first().isVisible()) await begin.first().tap()
    else if (await warmUp.isVisible() && await grassToStart(page).isVisible()) await grassToStart(page).tap()
    // page 84: no SKIP WARM UP button; a swipe up the grass moves on
    else if (await warmUp.isVisible() && await grass(page).isVisible()) await swipeUpGrass(page)
    else await page.waitForTimeout(500)
  }

  await expect(phase('READY')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Round 1 of \d+$/ })).toBeVisible()
  await expect(page).toHaveScreenshot('bag-ready.png', { mask: [combos, digits] })

  // Page 71: no START ROUND; the grass says TAP THE GRASS TO START (boxed, the first time) and starts it.
  await expect(page.getByRole('button', { name: 'START ROUND' })).toHaveCount(0)
  await expect(page.locator('.tm-ghint')).toHaveText('TAP THE GRASS TO START')
  await grassToStart(page).tap()
  await expect(phase('FIGHT')).toBeVisible()
  const roundSec = await timerSeconds(page)
  expect(roundSec).toBeGreaterThanOrEqual(60)
  await expect(page).toHaveScreenshot('bag-work.png', { mask: [combos, digits] })

  // The last 10 s: FINISH in the heat.
  await page.clock.fastForward((roundSec - 8) * 1000)
  await expect(phase('FINISH')).toBeVisible()
  expect(await timerSeconds(page)).toBeLessThanOrEqual(10)
  await expect(page).toHaveScreenshot('bag-last-10s.png', { mask: [combos, digits] })

  // Rest: REST in teal and the next round coming.
  await page.clock.fastForward(10_000)
  await expect(phase('REST')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Next round 2 of \d+$/ })).toBeVisible()
  const restSec = await timerSeconds(page)
  expect(restSec).toBeGreaterThan(10)
  await expect(page).toHaveScreenshot('bag-rest.png', { mask: [combos, digits] })

  // Tap the grass: paused (PAUSED · TAP TO GO ON). Tap again: running.
  await grass(page).tap()
  await expect(page.getByRole('status').getByRole('img', { name: 'PAUSED' })).toBeAttached()
  await expect(page.locator('.tm-ghint')).toHaveText('PAUSED · TAP TO GO ON')
  await grassPaused(page).tap()
  await expect(page.getByRole('status').getByRole('img', { name: 'PAUSED' })).toHaveCount(0)

  // Rest runs out: round 2 stands READY; the grass (now the quiet TAP TO START line) puts it in work.
  await page.clock.fastForward((restSec + 1) * 1000)
  await expect(phase('READY')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Round 2 of \d+$/ })).toBeVisible()
  await expect(page.locator('.tm-ghint:not(.is-mid)')).toHaveText('TAP TO START')
  await grassToStart(page).tap()
  await expect(phase('FIGHT')).toBeVisible()
})
