import { test, expect } from './fixtures'
import { enterFromToday, grass, grassPaused, grassToStart, insertSession, timerSeconds, swipeDownGrass, swipeUpGrass } from './support/helpers'

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
  const round1Combo = await page.locator('.bw-stack').getAttribute('aria-label')
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

  // Page 85: a swipe down restarts the rest; another within 3 s goes back into round 1, its combo back.
  await swipeDownGrass(page)
  await expect(phase('REST')).toBeVisible()
  await swipeDownGrass(page)
  await expect(phase('FIGHT')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Round 1 of \d+$/ })).toBeVisible()
  if (round1Combo) await expect(page.locator('.bw-stack')).toHaveAttribute('aria-label', round1Combo)
  expect(await timerSeconds(page)).toBeGreaterThanOrEqual(roundSec - 1)
  // A swipe up: on to its rest again, from full.
  await swipeUpGrass(page)
  await expect(phase('REST')).toBeVisible()
  await expect(page.getByRole('img', { name: /^Next round 2 of \d+$/ })).toBeVisible()

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

/**
 * The bag finisher (page 86): a COACH session gets it after the last round.
 * The last round's rest shows the first set where the next combo would be
 * (NEXT · FINISHER); then each set is a red time box with GOAL under it,
 * orange its last 10 s, a teal 20 s rest showing only the next set, and
 * DONE · FINISHER before the ratings. The grass moves it on (no buttons).
 */
test('Bag finisher: the last rest, a set, its last 10 s, the rest, done', async ({ page, api }) => {
  test.setTimeout(180_000)
  const bag = await insertSession(api, 'bag_work')
  await enterFromToday(page, bag.id)
  const phase = (name: string) => page.getByRole('img', { name, exact: true })
  const word = page.locator('[data-finisher]')

  // Through the preview and the warm-up to round 1, as above.
  const begin = page.getByRole('button', { name: /^(BEGIN|START BAG WORK)$/ })
  const round1 = page.getByRole('img', { name: /^Round 1 of \d+$/ })
  const warmUp = page.getByRole('img', { name: 'SKIP ROPE', exact: true })
  for (let i = 0; i < 6 && !(await round1.isVisible()); i++) {
    if (await begin.first().isVisible()) await begin.first().tap()
    else if (await warmUp.isVisible() && await grassToStart(page).isVisible()) await grassToStart(page).tap()
    else if (await warmUp.isVisible() && await grass(page).isVisible()) await swipeUpGrass(page)
    else await page.waitForTimeout(500)
  }
  const total = Number(/of (\d+)$/.exec((await round1.getAttribute('aria-label')) ?? '')?.[1] ?? 0)
  expect(total).toBeGreaterThan(0)

  // Every round: start it on the grass, swipe up to its rest; every rest but the last, up to the next round.
  for (let r = 1; r <= total; r++) {
    await expect(page.getByRole('img', { name: `Round ${r} of ${total}`, exact: true })).toBeVisible()
    await grassToStart(page).tap()
    await expect(phase('FIGHT')).toBeVisible()
    await swipeUpGrass(page)
    await expect(phase('REST')).toBeVisible()
    if (r < total) await swipeUpGrass(page)
  }

  // The last round's rest: just the first set, where the next combo would be, and NEXT · FINISHER.
  await expect(page.getByRole('img', { name: /^BODY KICK, RIGHT LEG, 0:\d\d · GOAL \d+$/ })).toBeVisible()
  await expect(page.locator('.bw-next')).toHaveText('NEXT · FINISHER')
  await expect(page.locator('.wm-card')).toHaveCount(0) // no list card anywhere

  // Set 1: FINISHER on its red, 1 OF n, the set's name over the clock, GOAL under it; no END / SKIP / NEXT buttons.
  await swipeUpGrass(page)
  await expect(word).toHaveAttribute('data-phase', 'work')
  await expect(phase('FINISHER')).toBeVisible()
  await expect(phase('BODY KICK')).toBeVisible()
  await expect(page.locator('.fin-of')).toHaveText(/^1 OF [34]$/)
  await expect(page.getByRole('img', { name: /^Goal (10|20|30)$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^(END|END EARLY|SKIP|NEXT|NEXT SET)$/ })).toHaveCount(0)
  const setSec = await timerSeconds(page)
  expect([25, 45, 65]).toContain(setSec)

  // Its last 10 s: orange (the plate and the clock), the set's name stays.
  await page.clock.fastForward((setSec - 8) * 1000)
  await expect(word).toHaveAttribute('data-warn', '1')
  await expect(phase('BODY KICK')).toBeVisible()

  // The rest: 20 s, teal, only the next set.
  await page.clock.fastForward(10_000)
  await expect(word).toHaveAttribute('data-phase', 'rest')
  await expect(phase('REST')).toBeVisible()
  await expect(page.getByRole('img', { name: /^NEXT: SWITCH KICK, LEFT LEG, / })).toBeVisible()
  expect(await timerSeconds(page)).toBeLessThanOrEqual(20)

  // Swipe down: the rest from full; again within 3 s: back into set 1.
  await swipeDownGrass(page)
  await expect(word).toHaveAttribute('data-phase', 'rest')
  await swipeDownGrass(page)
  await expect(phase('BODY KICK')).toBeVisible()

  // Up through every part to the end: DONE · FINISHER (NEXT · COMBO RATINGS), then on to the ratings by itself.
  // Never swipe a grass that has gone: once DONE shows (or the finisher has already moved on), stop.
  const ratings = page.getByRole('dialog', { name: 'Rate your combos' })
  let sawDone = false
  for (let i = 0; i < 10; i++) {
    if (await phase('DONE · FINISHER').isVisible()) { sawDone = true; break }
    if ((await word.count()) === 0 || (await grass(page).count()) === 0) break
    await swipeUpGrass(page)
  }
  if (sawDone) await expect(page.locator('.tm-next')).toHaveText('NEXT · COMBO RATINGS')
  await page.clock.fastForward(3_000)
  await expect(word).toHaveCount(0)
  await expect(ratings).toBeVisible()
})
