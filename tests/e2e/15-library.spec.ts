import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { gotoToday, todayISO } from './support/helpers'

/**
 * The full Library (page 52) and its content (page 60), approved 2026-10-19,
 * with page 65's polish and item pages (approved 2026-10-20): every kind
 * browsable, one search across all kinds, and an item page for everything.
 * The list: no NEW KIND, "18 of 55 unlocked", compact rows. An item: one top
 * board (the move, one useful number, WATCH naming the coach, the length and
 * start under it, the other link quietly), one cue line, and MORE holding the
 * rest, opened in place. Videos open outside the app (target _blank).
 */
async function openLibrary(page: Page) {
  await gotoToday(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'library' }).tap()
  await expect(page).toHaveURL(/\/library$/)
}

/** MORE opens in place; returns its board. */
async function openMore(page: Page) {
  await page.locator('.lib-more').tap()
  const board = page.locator('.lib-mbd')
  await expect(board).toBeVisible()
  return board
}

test('The list: no NEW KIND, Bagwork in words, compact rows; the Waybook keeps its lock (page 65)', async ({ page }) => {
  await openLibrary(page)
  const techniques = page.getByRole('button', { name: 'techniques', exact: true })
  await expect(techniques).toContainText('26')
  await expect(page.getByText('NEW KIND')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'runs', exact: true })).toContainText('6') // 0061: one Zone 2 Run
  await expect(page.getByRole('button', { name: 'bagwork', exact: true })).toHaveText(/^BAGWORK\d+ of \d+unlocked›$/)
  await expect(page.getByRole('button', { name: 'waybook', exact: true }).getByLabel('Locked')).toBeVisible()
  // 46 px rows with 32 px icons; the board sits low (its foot near the tab bar)
  const row = await techniques.boundingBox()
  expect(Math.round(row!.height)).toBe(46)
  expect(await techniques.locator('img').first().evaluate(i => (i as HTMLImageElement).width)).toBe(32)

  // Bagwork, mine first by type (page 93): HANDS, KICKS, TEEPS with counts, then one LOCKED head, folded
  await page.getByRole('button', { name: 'bagwork', exact: true }).tap()
  await expect(page.getByRole('button', { name: /^HANDS \d+$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^KNEES \d+$/ })).toHaveCount(0)
  const locked = page.getByRole('button', { name: /^LOCKED Locked \d+$/ })
  await expect(locked).toHaveAttribute('aria-expanded', 'false')
  await locked.tap()
  await expect(page.getByRole('button', { name: /^WEAPONS Locked \d+$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Back to the Library' }).tap()

  // Techniques: each with its kind and how many combos use it, most used first
  await techniques.tap()
  await expect(page.getByRole('button', { name: /^Jab Punch · in \d+ combos/ })).toBeVisible()
  await page.getByRole('button', { name: /^Body Kick Kick · in \d+ combos/ }).tap()
  await expect(page).toHaveURL(/open=techniques&item=tech-roundhouse/)
  // no alias sub-line (page 65: cut repeated copy)
  await expect(page.getByText(/also Right Kick/)).toHaveCount(0)
  await expect(page.locator('.lib-cueline')).toHaveText(/^Step out at an angle/)
  const watch = page.getByRole('link', { name: /^Watch on YouTube: fightTIPS$/ })
  await expect(watch).toHaveAttribute('target', '_blank')
  await expect(watch).toHaveAttribute('href', /youtube\.com/)
  await expect(page.getByRole('link', { name: 'also on TikTok ›' })).toHaveAttribute('href', /tiktok\.com/)
  // back to the list with ‹ TECHNIQUES
  await page.getByRole('button', { name: 'Back to techniques' }).tap()
  await expect(page).toHaveURL(/open=techniques$/)
})

test('A lift: the move, one number, WATCH, one cue line; MORE opens in place (page 65)', async ({ page }) => {
  await openLibrary(page)
  await page.getByRole('button', { name: 'strength', exact: true }).tap()
  await page.getByRole('button', { name: /^Front Squat Barbell/ }).tap()
  await expect(page.getByRole('img', { name: 'FRONT SQUAT' })).toBeVisible()
  const top = page.locator('.lib-top')
  await expect(top.locator('.lib-imeta')).toHaveText(/^Barbell/)
  // WATCH names the coach, with no raw YouTube title; the length under it
  await expect(top.getByRole('link', { name: 'Watch on YouTube: Squat University' })).toHaveAttribute('href', 'https://www.youtube.com/shorts/4n9HM7VabC0')
  await expect(top.locator('.lib-vline')).toHaveText('1:00')
  await expect(page.getByText(/HIGHER ELBOWS/)).toHaveCount(0)
  // one cue line, no CUE heading; the rest waits under MORE
  await expect(page.locator('.lib-cueline')).toHaveText('Bar on the front of the shoulders, elbows high.')
  await expect(page.getByText('Sit straight down between the hips, then stand up through the whole foot.')).toHaveCount(0)
  await expect(page.locator('.lib-more')).toHaveText(/^MORE3 tips · from the coach/)
  await expect(top.locator('.lib-watch')).toHaveScreenshot('library-front-squat-video.png')

  const more = await openMore(page)
  await expect(more.getByText('Sit straight down between the hips, then stand up through the whole foot.')).toBeVisible()
  await expect(more.locator('.lib-mtips li')).toHaveCount(3)
  await expect(more.getByText('Your main squat from week 3. Sets of 8, 2–3 reps left.')).toBeVisible()
  // CLOSE folds it; MORE is back
  await more.getByRole('button', { name: 'Close' }).tap()
  await expect(page.locator('.lib-mbd')).toHaveCount(0)
  await expect(page.locator('.lib-more')).toBeVisible()
  // a tap on its head folds it too
  const again = await openMore(page)
  await again.getByRole('button', { name: 'More ▴' }).tap()
  await expect(page.locator('.lib-mbd')).toHaveCount(0)
})

test('A combo: five dots and "N of 15 to mastered", WATCH from 0:08, the teal cue; a technique and a run (page 65)', async ({ page, api }) => {
  await page.goto('/library?open=bag&item=combo-w01')
  const top = page.locator('.lib-top')
  await expect(top.getByRole('img', { name: 'BODY KICK' })).toBeVisible()
  await expect(top.locator('.lib-mast')).toHaveText(/●+\d+ of 15 to mastered$|Mastered$/)
  // no MASTERY board
  await expect(page.getByText('Sharp ratings')).toHaveCount(0)
  // the TikTok pass (0041): a TikTok main, no start time, the YouTube it replaced quietly under it
  await expect(top.getByRole('link', { name: 'Watch on TikTok: Damien Trainor' })).toHaveAttribute('href', 'https://www.tiktok.com/@trainor103/video/7499869748306513174')
  await expect(top.locator('.lib-pf rect')).toHaveAttribute('fill', '#111')
  await expect(top.locator('.lib-vline')).toHaveText('0:26')
  await expect(top.getByRole('link', { name: 'also on YouTube ›' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=SOgUZwx5bw4&t=8')
  await expect(page.locator('.lib-cuef').getByRole('img', { name: 'JAB, THEN KICK' })).toBeVisible()
  // the per-tier coach hint is cut
  await expect(page.getByText(/it comes up more until it is Solid/)).toHaveCount(0)
  const more = await openMore(page)
  await expect(more.locator('.lib-mtips li')).toHaveCount(2)

  // a YouTube main with a start time: "from 0:04" under the length, the TikTok quietly under it (0041)
  await page.goto('/library?open=bag&item=combo-f09')
  await expect(page.getByRole('link', { name: 'Watch on YouTube: fightTIPS' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=Bp_QVO7kYtg&t=4')
  await expect(page.locator('.lib-vline')).toHaveText('4:17 · from 0:04')
  await expect(page.getByRole('link', { name: 'also on TikTok ›' })).toHaveAttribute('href', 'https://www.tiktok.com/@fighttips/video/7660290014294723854')

  // a technique: "in N of your combos", the short cue line, three combos then "and N more ›" (the search)
  const unlocked = (await api.get<Array<{ unlocked: number; text: string }>>('/api/combos')).filter(c => c.unlocked)
  await page.goto('/library?open=techniques&item=tech-jab')
  await expect(page.locator('.lib-imeta')).toHaveText(/^Punch · in \d+ of your combos$/)
  await expect(page.getByRole('link', { name: 'Watch on YouTube: Muay Thai Guy' })).toBeVisible()
  await expect(page.locator('.lib-cueline')).toHaveText('Lead hand straight out, turn the fist over, straight back to the chin.')
  const jab = await openMore(page)
  const uses = jab.locator('.lib-uses .lib-strikes')
  await expect(uses).toHaveCount(3)
  const and = jab.getByRole('button', { name: /^and \d+ more ›$/ })
  if (unlocked.length > 3 && await and.count()) {
    await and.tap()
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.getByRole('searchbox', { name: 'Search everything' })).toHaveValue('jab')
  }

  // a run: the cue line is the rule on the run; WATCH from 0:21
  await page.goto('/library?open=runs&item=run-walk')
  await expect(page.getByRole('img', { name: 'RUN-WALK' })).toBeVisible()
  await expect(page.locator('.lib-cueline')).toHaveText('Walk before you need to.')
  await expect(page.locator('.lib-vline')).toHaveText('4:40 · from 0:21')
  await expect(page.getByText('What it is')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Watch on YouTube: The Running Channel' })).toBeVisible()
})

test('One search across every kind, grouped, with counts', async ({ page }) => {
  await openLibrary(page)
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('teep')
  await expect(page.getByRole('button', { name: /^TECHNIQUES · (3 of )?\d+$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Lead Teep / })).toBeVisible()
  const combosHead = page.getByRole('button', { name: /^COMBOS · (3 of \d+|\d+)$/ })
  await expect(combosHead).toBeVisible()
  await expect(page.getByText(/STRENGTH · 0/)).toBeVisible()
  // the header shows them all
  const label = (await combosHead.textContent()) ?? ''
  if (/3 of/.test(label)) {
    await combosHead.tap()
    await expect(page.getByRole('button', { name: /^COMBOS · \d+$/ })).toBeVisible()
  }
  // by muscle too
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('hip')
  await expect(page.getByRole('button', { name: /^FOUNDATION · / })).toBeVisible()
})

test('0039: start times, the swapped videos with their TikTok, and the corrected credit (approved 2026-10-20)', async ({ page, api }) => {
  // a long video's start time is in the Library's data (the item pages add it as t=, below)
  const ex = await api.get<Array<{ id: string; formVideoUrl: string | null; videoStartSec: number | null; videoSource: string | null }>>('/api/exercises')
  expect(ex.find(e => e.id === 'ex-bent-over-row')).toMatchObject({ formVideoUrl: 'https://www.youtube.com/watch?v=RQU8wZPbioA', videoStartSec: 105 })
  // a swap: the taught lesson at its start, Tiger Muay Thai's credit (the full credit stays in the data), the TikTok as the quiet second link
  const combos = await api.get<Array<{ id: string; videoSource: string | null }>>('/api/combos')
  expect(combos.find(c => c.id === 'combo-d03')?.videoSource).toBe('Tiger Muay Thai (Brad Riddell, with Dan Hooker)')
  await page.goto('/library?open=bag&item=combo-d03')
  await expect(page.getByRole('link', { name: 'Watch on YouTube: Tiger Muay Thai' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=u6p4YKrvTwg&t=14')
  await expect(page.locator('.lib-vline')).toHaveText(/ · from 0:14$/)
  await expect(page.getByText(/Fagan/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'also on TikTok ›' })).toHaveAttribute('href', 'https://www.tiktok.com/@trainor103/video/7468272181814873376')
  // combo-w12 (the TikTok pass's overhand combo) is gone: no overhands (0051, Josh 2026-10-25)
  expect(combos.find(c => c.id === 'combo-w12')).toBeUndefined()
})

test('Live numbers: his last set on top, this week\'s run-walk (page 60, page 65)', async ({ page, api }) => {
  // the real endpoint answers the shape the pages read
  const real = await api.get<{ lastSets: Record<string, unknown>; runWalk: unknown }>('/api/library/hints')
  expect(typeof real.lastSets).toBe('object')
  // known numbers, so the lines match the mockup exactly; a set from 3 days ago (over 4 weeks old adds its month)
  const recentDay = Math.floor(Date.parse(`${todayISO()}T00:00:00Z`) / 86_400_000) - 3
  await page.route('**/api/library/hints', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ lastSets: { 'ex-front-squat': { weightKg: 47.6, reps: 8, bandColor: null, day: recentDay } }, runWalk: { week: 1, runSec: 60, walkSec: 120, rounds: 6, warmupSec: 300 } }),
  }))
  await page.goto('/library?open=strength&item=ex-front-squat')
  await expect(page.locator('.lib-imeta')).toHaveText('Barbell · last time 105 lb × 8')
  await page.goto('/library?open=runs&item=run-walk')
  await expect(page.locator('.lib-imeta')).toHaveText('This week: 6 × 1 min run, 2 min walk')
  await expect(page.locator('.lib-more')).toHaveText(/^MORE3 tips · how it works/)
  const run = await openMore(page)
  await expect(run.locator('.lib-mnote').first()).toHaveText('Short easy runs with planned walks in between, after a 5-minute brisk walk. 23 min in all.')
  // no history: the equipment alone on top, the static hint under MORE
  await page.goto('/library?open=strength&item=ex-bench-press')
  await expect(page.locator('.lib-imeta')).toHaveText('Barbell, Bench')
  const bench = await openMore(page)
  await expect(bench.getByText('Main press. 2-3 hard sets, RPE 6-7 early in Block Zero, never to failure.')).toBeVisible()
})
