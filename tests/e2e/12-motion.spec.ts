import { test, expect } from './fixtures'
import { gotoToday } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

// Page 59 (motion and speed, approved 2026-10-19): the flap engine, the tab
// switch (world first, tabs kept alive, Program in one request) and the
// splash's skip. The real motion runs here (the rest of the suite turns
// Reduce Motion on so its screenshots never catch a letter mid-flip).
test.use({ reducedMotion: 'no-preference' })

test.beforeAll(async ({ request }) => {
  // the morning check-in done, so its cards don't open over Today
  await setMorning(makeApiFor(request))
})

/** Every flap label on the shown tab, and whether its tiles show its words. */
async function flapsLanded(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const pane = document.querySelector('.wm-pane:not([style*="display: none"])')
    const labels = Array.from(pane?.querySelectorAll<HTMLElement>('.wm-flap') ?? [])
    const shown = (f: HTMLElement) => Array.from(f.children).map(c => (c.firstChild?.nodeType === 3 ? (c.firstChild as Text).data : '')).join('')
    const want = (f: HTMLElement) => (f.getAttribute('aria-label') ?? '').toUpperCase().replace(/\s+/g, '')
    return { count: labels.length, wrong: labels.filter(f => shown(f).replace(/\s+/g, '') !== want(f)).map(f => f.getAttribute('aria-label')) }
  })
}

test('the flap engine: one pass, at most two writes a tile, landed by about 1.3 s; no :has() on body', async ({ page }) => {
  await gotoToday(page)
  // no stylesheet restyles the page from <body> (page 59 cause 1)
  const hasOnBody = await page.evaluate(() => Array.from(document.styleSheets).some(sheet => {
    try { return Array.from(sheet.cssRules).some(r => /body:has\(/.test(r.cssText)) } catch { return false }
  }))
  expect(hasOnBody).toBe(false)

  // count every glyph write per tile while Program opens
  await page.evaluate(() => {
    const w = window as unknown as { __writes: Map<Element, number> }
    w.__writes = new Map()
    new MutationObserver(list => {
      for (const r of list) {
        const cell = (r.target.nodeType === 3 ? r.target.parentElement : (r.target as Element))?.closest('.wm-cell')
        if (cell) w.__writes.set(cell, (w.__writes.get(cell) ?? 0) + 1)
      }
    }).observe(document.body, { subtree: true, characterData: true, childList: true })
  })
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'program' }).tap()
  await expect(page).toHaveURL(/\/program$/)
  // world first: the boards wait for the glide, then rise and flip in; all landed by about 1.3 s
  await page.waitForTimeout(1500)
  const landed = await flapsLanded(page)
  expect(landed.count).toBeGreaterThan(5)
  expect(landed.wrong).toEqual([])
  const maxWrites = await page.evaluate(() => Math.max(0, ...(window as unknown as { __writes: Map<Element, number> }).__writes.values()))
  // blank, a nearby glyph, the glyph: never the old 4 to 7 flips
  expect(maxWrites).toBeLessThanOrEqual(3)
  // no old fold class, no tile restyled per flip
  await expect(page.locator('.wm-cell.is-tick')).toHaveCount(0)
})

test('tabs stay alive: Program opens in one request, comes back at once, the profile read once', async ({ page }) => {
  const reads: string[] = []
  let lastRead = Date.now()
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) { reads.push(u.pathname); lastRead = Date.now() } })
  page.on('requestfinished', () => { lastRead = Date.now() })
  /** Until no read has gone out or come back for 800 ms. */
  const quiet = async () => { await expect.poll(() => Date.now() - lastRead, { timeout: 15_000 }).toBeGreaterThan(800) }
  await gotoToday(page)
  const tabs = page.getByRole('navigation', { name: 'Main' })
  await quiet()
  reads.length = 0
  await tabs.getByRole('link', { name: 'program' }).tap()
  await expect(page.getByRole('img', { name: /^WEEK \d+$/ }).first()).toBeVisible()
  // one read for the block, its week and the road (it may already be in hand from the prefetch)
  expect(reads.filter(p => p === '/api/program').length).toBeLessThanOrEqual(1)
  // never the old chain: /blocks/current, then /weeks/current, then one per past week
  expect(reads.filter(p => p === '/api/weeks/current')).toEqual([])
  await page.evaluate(() => { (document.querySelector('[data-tab-pane="program"]') as HTMLElement & { __kept?: boolean }).__kept = true })

  await tabs.getByRole('link', { name: 'today' }).tap()
  await expect(page.getByRole('button', { name: '+ add session' })).toBeVisible()
  await quiet()
  reads.length = 0
  await tabs.getByRole('link', { name: 'program' }).tap()
  // the same page, kept: its boards are there at once (never "Reading the plan."); it refreshes behind them
  await expect(page.getByRole('img', { name: /^WEEK \d+$/ }).first()).toBeAttached()
  await expect(page.getByText('Reading the plan.')).toHaveCount(0)
  expect(await page.evaluate(() => (document.querySelector('[data-tab-pane="program"]') as HTMLElement & { __kept?: boolean }).__kept)).toBe(true)
  await expect(page.getByRole('img', { name: /^WEEK \d+$/ }).first()).toBeVisible()
  expect(reads.filter(p => p === '/api/program').length).toBeLessThanOrEqual(1)
  // the onboarding check is never read again on a tab tap (Today, kept, may still refresh its own week behind)
  expect(reads.filter(p => p === '/api/user-profile')).toEqual([])
})

test.describe('the splash, moving (no Reduce Motion)', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('the splash: tap 1 skips to the title screen, tap 2 lifts it into the app (Josh, 2026-10-20)', async ({ page }) => {
    await page.goto('/today?resume=0')
    const splash = page.locator('.wm-splash')
    await expect(splash).toBeVisible()
    await page.waitForTimeout(400)
    // Raw taps, as the hold test does: a locator click waits for two still
    // frames first, and on the Linux runner the world's first software-WebGL
    // compile can hold the page long enough for the splash to end on its own.
    const box = await splash.boundingBox()
    const tap = () => page.mouse.click((box?.width ?? 390) / 2, 300)
    await tap()
    // tap 1: the title screen (WAYMARK under the whole crest), the splash still up
    const word = page.locator('.wm-splash-word.is-on')
    await expect(word).toBeVisible({ timeout: 6000 })
    await expect(splash).toHaveCount(1)
    // tap 2: the title lifts at once, straight into the app (not the title's own 1.6 s wait)
    await tap()
    await expect(splash).toHaveCount(0, { timeout: 4000 })
    await expect(page.getByRole('button', { name: '+ add session' })).toBeVisible()
  })
})

test('the splash under Reduce Motion: the title is up at once, so one tap lifts it', async ({ page }) => {
  await page.goto('/today?resume=0')
  const splash = page.locator('.wm-splash')
  await expect(splash).toBeVisible()
  // no wait for the word here: on the Linux runner the still splash can run its whole 2.5 s
  // while the page settles, so the tap goes in at once (raw, as the hold test does)
  const box = await splash.boundingBox()
  await page.mouse.click((box?.width ?? 390) / 2, 300)
  await expect(splash).toHaveCount(0, { timeout: 6000 })
  await expect(page.getByRole('button', { name: '+ add session' })).toBeVisible()
})

test('the splash: a hold skips it all, straight into the app', async ({ page }) => {
  await page.goto('/today?resume=0')
  const splash = page.locator('.wm-splash')
  await expect(splash).toBeVisible()
  const box = await splash.boundingBox()
  await page.mouse.move((box?.width ?? 390) / 2, 300)
  await page.mouse.down()
  // gone as soon as it is held, before the press ends. Held while the crest is
  // still loading, the skip plays once it is up: WebKit's software WebGL can
  // take a second or two there, with Today rendering behind it.
  await expect(splash).toHaveCount(0, { timeout: 4000 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: '+ add session' })).toBeVisible()
})
