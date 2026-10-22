import type { Page } from '@playwright/test'

import { test, expect, type Api } from './fixtures'
import { enterFromToday, insertSession, todayISO } from './support/helpers'
import { setMorning } from './support/data'

/**
 * Page 74 (the run with the strap), the run screen: the plan lives on the
 * ready board; running shows the clock, RUNNING, the heart, BPM and distance;
 * the zone steps teal → gold → ember (EASE OFF) from the recorder's ticks; the
 * grass held 3 s finishes (Log your run, filled), a tap outside goes back; the
 * × held 3 s offers END AND LOG or DISCARD on every session. Driven by the web
 * recorder mock (window.__wmStrapMock).
 */

interface RunWorkout { prescription: { z2CeilingBpm?: number | null } | null }
interface Row { id: string; status: string }

const strapHr = (page: Page, bpm: number | null) => page.evaluate(b => (window as unknown as { __wmStrapMock: { hr(b: number | null): void } }).__wmStrapMock.hr(b), bpm)
const strapDistance = (page: Page, m: number) => page.evaluate(d => (window as unknown as { __wmStrapMock: { distance(m: number): void } }).__wmStrapMock.distance(d), m)
const activity = (page: Page) => page.evaluate(() => (window as unknown as { __wmActivity?: { runKind?: string; hrZone?: string; hr?: number | null } }).__wmActivity ?? null)
const statusOf = async (api: Api, id: string) => (await api.get<Row[]>(`/api/sessions/today?date=${todayISO()}`)).find(r => r.id === id)?.status

/** A run session, through its ready board to the running screen. With `strap`, a remembered strap (it links by itself). */
async function intoRun(page: Page, api: Api, { strap = false }: { strap?: boolean } = {}) {
  if (strap) await page.addInitScript(() => { try { localStorage.setItem('wm.mockStrap', 'COOSPO H9Z') } catch { /* private */ } })
  await setMorning(api)
  const s = await insertSession(api, 'running', 'am')
  await enterFromToday(page, s.id)
  const ready = page.getByRole('dialog', { name: /, ready$/ })
  await expect(ready).toBeVisible()
  const ceiling = (await api.get<RunWorkout>(`/api/sessions/${s.id}/run-workout`)).prescription?.z2CeilingBpm ?? null
  return { s, ready, ceiling }
}

async function start(page: Page, ready: ReturnType<Page['getByRole']>) {
  await ready.getByRole('button', { name: 'START RUN' }).tap()
  await expect(page.getByRole('timer')).toBeVisible()
}

const runGrass = (page: Page) => page.getByRole('button', { name: /^Timer\. Tap to pause\. Hold for 3 seconds to finish\.$/ })
const xButton = (page: Page) => page.getByRole('button', { name: 'End. Hold for 3 seconds.' })

/** Press and hold an element for `ms` with the mouse (a thumb on the glass). */
async function hold(page: Page, el: ReturnType<Page['getByRole']>, ms: number, at: { x: number; y: number } = { x: 0.5, y: 0.7 }) {
  const box = (await el.boundingBox())!
  await page.mouse.move(box.x + box.width * at.x, box.y + box.height * at.y)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

test('The plan lives on the ready board; the run screen has no chips and no FINISH RUN; no strap: a dim heart and dashes', async ({ page, api }) => {
  const { ready, ceiling } = await intoRun(page, api)
  // the plan, before the start: time, heart rate ≤ the line, nasal breathing, the shape
  await expect(ready.getByRole('img', { name: /^\d+ MIN$/ })).toBeVisible()
  if (ceiling != null) await expect(ready.getByRole('img', { name: `≤ ${ceiling}` })).toBeVisible()
  await expect(ready.getByText('Shape')).toBeVisible()
  await start(page, ready)

  await expect(page.locator('.ss-chips')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'FINISH RUN' })).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'RUNNING', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'No heart rate strap' })).toBeVisible()
  await expect(page.locator('[data-live]').getByRole('img', { name: '---', exact: true })).toBeVisible()
  await expect(page.locator('[data-live]')).toHaveAttribute('data-zone', 'none')
  await expect(page.getByText('HOLD · FINISH')).toBeVisible()
  // the swipe up no longer finishes a run (the hold does): its label says hold, not swipe
  await expect(runGrass(page)).toBeVisible()
  // an easy run's lock card: pause / play only, never a skip
  await expect.poll(async () => (await activity(page))?.runKind).toBe('easy')
})

test('Zones from the strap: teal, gold at the top, ember with EASE OFF after 30 s over, and back', async ({ page, api }) => {
  const { ready, ceiling } = await intoRun(page, api, { strap: true })
  test.skip(ceiling == null, 'no heart-rate line on this run')
  const line = ceiling!
  await start(page, ready)
  const liveRow = page.locator('[data-live]')

  await strapHr(page, line - 20)
  await strapDistance(page, 1234)
  await expect(liveRow).toHaveAttribute('data-zone', 'in')
  await expect(page.getByRole('img', { name: `Heart rate ${line - 20}` })).toBeVisible()
  await expect(liveRow.getByRole('img', { name: '1.23', exact: true })).toBeVisible()
  await expect.poll(async () => (await activity(page))?.hrZone).toBe('in')

  await strapHr(page, line - 2)
  await expect(liveRow).toHaveAttribute('data-zone', 'gold')
  await expect(page.getByRole('img', { name: 'RUNNING', exact: true })).toBeVisible()

  // just over: gold, no cue, for under 30 s
  await strapHr(page, line + 6)
  await expect(liveRow).toHaveAttribute('data-zone', 'gold')
  await expect(page.getByRole('img', { name: 'EASE OFF', exact: true })).toHaveCount(0)
  // over for 30 s: ember, EASE OFF in RUNNING's place
  await page.clock.fastForward(31_000)
  await strapHr(page, line + 6)
  await expect(liveRow).toHaveAttribute('data-zone', 'over')
  await expect(page.getByRole('img', { name: 'EASE OFF', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'RUNNING', exact: true })).toHaveCount(0)
  await expect.poll(async () => (await activity(page))?.hrZone).toBe('over')

  // eased off: back to teal, RUNNING again
  await strapHr(page, line - 20)
  await expect(liveRow).toHaveAttribute('data-zone', 'in')
  await expect(page.getByRole('img', { name: 'RUNNING', exact: true })).toBeVisible()

  // the strap drops: the heart dims, dashes
  await strapHr(page, null)
  await expect(liveRow).toHaveAttribute('data-zone', 'none')
  await expect(page.getByRole('img', { name: 'No heart rate strap' })).toBeVisible()
})

test('Hold the grass 3 s to finish: early let-go eases back; at full Log your run comes up filled; a tap outside goes back to the run', async ({ page, api }) => {
  const { ready } = await intoRun(page, api, { strap: true })
  await start(page, ready)
  await strapHr(page, 140)
  await strapDistance(page, 2510)
  await page.waitForTimeout(2200)
  const log = page.getByRole('dialog', { name: 'Log your run' })

  // let go after 1.6 s: FINISHING showed (after 1 s), no board, and the run carries on
  const g = runGrass(page)
  const box = (await g.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7)
  await page.mouse.down()
  await expect(page.locator('[data-finishing]')).toBeAttached({ timeout: 2500 })
  await page.mouse.up()
  await expect(page.locator('[data-finishing]')).toHaveCount(0)
  await page.waitForTimeout(600)
  await expect(log).toHaveCount(0)
  await expect(runGrass(page)).toBeVisible()

  // a short tap still pauses, and again goes on
  await g.tap()
  await expect(page.getByRole('button', { name: /^Timer paused\. Tap to go on/ })).toBeVisible()
  await page.getByRole('button', { name: /^Timer paused\. Tap to go on/ }).tap()
  await expect(runGrass(page)).toBeVisible()

  // the full hold: Log your run, filled by itself (km, time, avg and max heart rate), no helper text
  await hold(page, runGrass(page), 3400)
  await expect(log).toBeVisible()
  await expect(log.getByRole('button', { name: /^KM 2\.51\. Change$/ })).toBeVisible()
  await expect(log.getByRole('button', { name: /^AVG HR 140\. Change$/ })).toBeVisible()
  await expect(log.getByRole('button', { name: /^MAX HR 140\. Change$/ })).toBeVisible()
  await expect(log.getByRole('button', { name: /^TIME \d+(:\d\d)?\. Change$/ })).toBeVisible()
  await expect(log.getByText('Tap a number to change it.')).toHaveCount(0)

  // a tap outside: the board goes, the run carries on as it was (running), nothing saved
  await page.mouse.click(8, 8)
  await expect(log).toHaveCount(0)
  await expect(runGrass(page)).toBeVisible()
  const t1 = await page.getByRole('timer').getAttribute('aria-label')
  await page.waitForTimeout(2200)
  expect(await page.getByRole('timer').getAttribute('aria-label')).not.toBe(t1)
})

test('The × on a run: a 3 s hold, END AND LOG or DISCARD; tap outside returns; DISCARD is back to planned', async ({ page, api }) => {
  const { s, ready } = await intoRun(page, api)
  await start(page, ready)
  const close = page.getByRole('dialog', { name: /: end$/ })

  // let go early: nothing opens
  await hold(page, xButton(page), 1200)
  await page.waitForTimeout(400)
  await expect(close).toHaveCount(0)

  // held through: the close window, two plates
  await hold(page, xButton(page), 3300)
  await expect(close).toBeVisible()
  await expect(close.getByRole('button', { name: 'END AND LOG' })).toBeVisible()
  await expect(close.getByRole('button', { name: 'DISCARD' })).toBeVisible()
  // tap outside: back to the run as it was
  await page.mouse.click(8, 8)
  await expect(close).toHaveCount(0)
  await expect(runGrass(page)).toBeVisible()

  // END AND LOG on a run: Log your run; tap outside, back to the run
  await hold(page, xButton(page), 3300)
  await close.getByRole('button', { name: 'END AND LOG' }).tap()
  const log = page.getByRole('dialog', { name: 'Log your run' })
  await expect(log).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(log).toHaveCount(0)
  await expect(runGrass(page)).toBeVisible()

  // DISCARD: back to Today, the session planned again
  await hold(page, xButton(page), 3300)
  await close.getByRole('button', { name: 'DISCARD' }).tap()
  await expect(page).toHaveURL(/\/today/)
  await expect.poll(() => statusOf(api, s.id), { timeout: 15_000 }).toBe('planned')
})

test('The × on a non-run session: 3 s, then END AND LOG closes it; DISCARD puts another back to planned', async ({ page, api }) => {
  const bag = await insertSession(api, 'bag_work')
  await intoBagRound(page, bag.id)
  const close = page.getByRole('dialog', { name: /: end$/ })
  await hold(page, xButton(page), 3300)
  await expect(close).toBeVisible()
  await close.getByRole('button', { name: 'DISCARD' }).tap()
  await expect(page).toHaveURL(/\/today/)
  await expect.poll(() => statusOf(api, bag.id), { timeout: 15_000 }).toBe('planned')

  const bag2 = await insertSession(api, 'bag_work')
  await intoBagRound(page, bag2.id)
  await hold(page, xButton(page), 3300)
  await expect(close).toBeVisible()
  await close.getByRole('button', { name: 'END AND LOG' }).tap()
  await expect(page.getByRole('button', { name: 'CLOSE SESSION' })).toBeVisible({ timeout: 10_000 })
})

async function intoBagRound(page: Page, id: string) {
  await enterFromToday(page, id)
  const begin = page.getByRole('button', { name: /^(BEGIN SESSION|BEGIN|START BAG WORK|SKIP WARM UP)$/ })
  const round1 = page.getByRole('img', { name: /^Round 1 of \d+$/ })
  const toStart = page.getByRole('button', { name: 'Timer. Tap to start.', exact: true })
  const warmUp = page.getByRole('img', { name: 'SKIP ROPE', exact: true })
  for (let i = 0; i < 6 && !(await round1.isVisible()); i++) {
    if (await begin.first().isVisible()) await begin.first().tap()
    else if (await warmUp.isVisible() && await toStart.isVisible()) await toStart.tap()
    else await page.waitForTimeout(500)
  }
  await toStart.tap()
  await expect(page.getByRole('img', { name: 'FIGHT', exact: true })).toBeVisible()
}
