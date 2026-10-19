import { test, expect } from './fixtures'
import { enterFromToday, insertSession, timerSeconds } from './support/helpers'

/**
 * The bag round (page 55 layout 1) on a test clock: READY, then the round in
 * work (FIGHT), its last 10 s (FINISH, the heat) and the rest (REST, teal,
 * the next round's combo). Time moves by page.clock.fastForward; the clock
 * digits can be a second apart run to run, so they are masked with the combos.
 */
test('Bag round: ready, work, last 10 s, rest', async ({ page, api }) => {
  await page.clock.install()
  const bag = await insertSession(api, 'bag_work')
  await enterFromToday(page, bag.id)

  // The combos are drawn fresh for each session: masked in the screenshots.
  const combos = page.locator('.bw-zone')
  const digits = page.getByRole('timer')
  const phase = (name: string) => page.getByRole('img', { name, exact: true })

  // A session may open on its preview / skip-rope warm-up first.
  const begin = page.getByRole('button', { name: /^(BEGIN|START BAG WORK|SKIP WARM UP)$/ })
  for (let i = 0; i < 3 && !(await page.getByRole('button', { name: 'START ROUND' }).isVisible()); i++) {
    if (await begin.first().isVisible()) await begin.first().tap()
    else await page.waitForTimeout(500)
  }

  await expect(phase('READY')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Round 1 of \d+$/ })).toBeVisible()
  await expect(page).toHaveScreenshot('bag-ready.png', { mask: [combos, digits] })

  await page.getByRole('button', { name: 'START ROUND' }).tap()
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

  // Tap the grass: paused. Tap again: running.
  await page.getByRole('button', { name: /^Timer\. Tap to pause/ }).tap()
  await expect(page.getByRole('status').getByRole('img', { name: 'PAUSED' })).toBeAttached()
  await page.getByRole('button', { name: /^Timer\. Tap to pause/ }).tap()
  await expect(page.getByRole('status').getByRole('img', { name: 'PAUSED' })).toHaveCount(0)

  // Rest runs out: round 2 stands READY, START ROUND puts it in work.
  await page.clock.fastForward((restSec + 1) * 1000)
  await expect(phase('READY')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Round 2 of \d+$/ })).toBeVisible()
  await page.getByRole('button', { name: 'START ROUND' }).tap()
  await expect(phase('FIGHT')).toBeVisible()
})
