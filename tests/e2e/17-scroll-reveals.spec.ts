import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { gotoToday } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * Page 67, Scroll reveals (approved 2026-10-20), on the four world tabs:
 *   1-2  each tab opens with its place in the window: the boards start 46% down (40% on Today)
 *   4    the scene follows at 40% of the scroll and darkens to 60%; Reduce Motion: the darkening only
 *   5    the header: its top scrim always, a dark backing once the boards slide under it
 *   6    tab switches land at the window; a tap on the tab you're on scrolls back to it
 *   7    page 61 unchanged: a tap on the scene is "outside"; a pull down at the top only bounces
 *   8    the first board's top edge always shows above the tab bar
 *   9    the world idles at 15 fps once the boards cover the window
 * (3, each place's camera re-framed into its window, is src/world/world.test.ts.)
 */

test.beforeAll(async ({ request }) => {
  // the morning check-in done, so its cards don't open over Today
  await setMorning(makeApiFor(request))
})

const TABS = [
  { link: 'today', url: /\/today/, at: 0.4 },
  { link: 'program', url: /\/program$/, at: 0.46 },
  { link: 'library', url: /\/library$/, at: 0.46 },
  { link: 'ledger', url: /\/history$/, at: 0.46 },
] as const
const PANE: Record<string, string> = { today: 'today', program: 'program', library: 'library', ledger: 'history' }

/** Until the tab is shown and its window sized. */
async function shown(page: Page, link: string) {
  await expect.poll(() => page.evaluate(key => {
    const pane = document.querySelector<HTMLElement>('.wm-pane:not([style*="display: none"])')
    const win = pane?.querySelector<HTMLElement>('.wm-scene-window')
    return pane?.dataset.tabPane === key && !!win && win.style.height !== '' && win.offsetHeight === Math.round(parseFloat(win.style.height))
  }, PANE[link]), { timeout: 15_000 }).toBe(true)
}

async function openTab(page: Page, link: string, url: RegExp) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link }).tap()
  await expect(page).toHaveURL(url)
  await shown(page, link)
}

/** The shown tab's scroll and window, measured on screen. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main.waymark-scroll')!
    const pane = document.querySelector<HTMLElement>('.wm-pane:not([style*="display: none"])')!
    const win = pane.querySelector<HTMLElement>('.wm-scene-window')!
    const first = win.nextElementSibling as HTMLElement
    const hd = pane.querySelector<HTMLElement>('.wm-scene-hd')!
    const tabs = document.querySelector<HTMLElement>('.wm-tabs')!
    const gap = parseFloat(getComputedStyle(win.parentElement!).rowGap) || 0
    return {
      scroll: main.scrollTop,
      maxScroll: main.scrollHeight - main.clientHeight,
      shellH: main.parentElement!.clientHeight,
      firstTop: first.getBoundingClientRect().top - main.getBoundingClientRect().top,
      tabsTop: tabs.getBoundingClientRect().top,
      window: win.offsetHeight + gap,
      solid: hd.classList.contains('is-solid'),
      veil: Number((document.querySelector<HTMLElement>('.wm-world-veil')!).style.opacity || 0),
      scene: (document.querySelector<HTMLElement>('.wm-world-scene')!).style.transform,
      sceneY: Number(/translate3d\([^,]+,\s*(-?[\d.]+)px/.exec((document.querySelector<HTMLElement>('.wm-world-scene')!).style.transform)?.[1] ?? 0),
    }
  })
}

/** Scroll the shell to y, then let a frame pass (the suite's Reduce Motion gives every change a 0.01 ms transition). */
async function scrollTo(page: Page, y: number) {
  await page.evaluate(v => {
    const main = document.querySelector<HTMLElement>('main.waymark-scroll')!
    main.scrollTop = v
    main.dispatchEvent(new Event('scroll'))
  }, y)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
}

test('each world tab opens with its place in the window: boards 46% down, 40% on Today; tabs land at the window', async ({ page }) => {
  await gotoToday(page)
  await shown(page, 'today')
  for (const t of TABS) {
    if (t.link !== 'today') await openTab(page, t.link, t.url)
    await expect.poll(async () => (await measure(page)).scroll).toBe(0)
    const m = await measure(page)
    expect(Math.abs(m.firstTop - Math.round(t.at * m.shellH)), `${t.link}: the first board ${m.firstTop} px down`).toBeLessThanOrEqual(2)
    // the scene open: no veil, the header clear over it
    expect(m.veil).toBe(0)
    expect(m.solid).toBe(false)
  }

  // scrolled, then away and back: it lands at the window again (page 67 item 6)
  await scrollTo(page, 300)
  await expect.poll(async () => (await measure(page)).scroll).toBeGreaterThan(0)
  await openTab(page, 'today', /\/today/)
  await openTab(page, 'ledger', /\/history$/)
  await expect.poll(async () => (await measure(page)).scroll).toBe(0)
})

test('scrolled: the scene darkens to 60% and the header gets its backing; Reduce Motion keeps the scene still', async ({ page }) => {
  // the suite runs with Reduce Motion on: no parallax, only the darkening
  await gotoToday(page)
  await openTab(page, 'ledger', /\/history$/)
  await expect(page.getByRole('region', { name: /^This week:/ })).toBeVisible()
  const w = (await measure(page)).window
  expect(w).toBeGreaterThan(100)

  await scrollTo(page, Math.round(w / 2))
  let m = await measure(page)
  expect(m.veil).toBeCloseTo(0.3, 1)
  expect(m.solid).toBe(false)
  expect(m.scene).toBe('')

  await scrollTo(page, w)
  m = await measure(page)
  expect(m.veil).toBeCloseTo(0.6, 2)
  expect(m.solid).toBe(true)
  expect(m.scene).toBe('')
  // the header over the boards, on its backing
  await expect(page.locator('.wm-pane:not([style*="display: none"]) .wm-scene-hd')).toHaveScreenshot('ledger-header-solid.png')

  // a tap on the tab you're on: back to the window (page 67 item 6), the scene open again
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'ledger' }).tap()
  await expect.poll(async () => (await measure(page)).scroll).toBe(0)
  m = await measure(page)
  expect(m.veil).toBe(0)
  expect(m.solid).toBe(false)
})

test.describe('moving (no Reduce Motion)', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('the scene follows at 40% of the scroll; the world idles at 15 fps once covered', async ({ page }) => {
    await gotoToday(page)
    await openTab(page, 'ledger', /\/history$/)
    await expect(page.getByRole('region', { name: /^This week:/ })).toBeVisible()
    // the rise and its flaps landed
    await page.waitForTimeout(1500)
    const w = (await measure(page)).window

    await scrollTo(page, 100)
    expect((await measure(page)).sceneY).toBeCloseTo(-40, 1)
    await scrollTo(page, w + 50)
    const m = await measure(page)
    expect(m.sceneY).toBeCloseTo(-0.4 * (w + 50), 0)
    expect(m.veil).toBeCloseTo(0.6, 2)

    // covered: the world drops to its idle 15 fps; uncovered, back to its own rate
    const stats = () => page.evaluate(() => (window as unknown as { __waymarkWorld?: { stats(): { cap: number | null; fps: number } } }).__waymarkWorld?.stats() ?? null)
    await expect.poll(async () => (await stats())?.cap, { timeout: 15_000 }).toBe(15)
    await page.waitForTimeout(2500)
    expect((await stats())!.fps).toBeLessThanOrEqual(16.5)
    await scrollTo(page, 0)
    await expect.poll(async () => (await stats())?.cap).toBeNull()
    expect((await measure(page)).scene).toBe('')
  })
})

test('page 61 unchanged: a tap on the scene closes an open board and does nothing else; a pull down at the top only bounces', async ({ page }) => {
  await gotoToday(page)
  const line = page.locator('button.td-wline')
  await line.tap()
  const box = page.getByRole('textbox', { name: 'Waybook entry' })
  await expect(box).toBeVisible()
  await scrollTo(page, 0)
  // the window counts as outside: the open board closes
  await page.locator('.wm-scene-window').click()
  await expect(box).toBeHidden()
  // with nothing open, a tap on the scene does nothing
  await page.locator('.wm-scene-window').click()
  await expect(page).toHaveURL(/\/today/)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // pulling down at the top: no new meaning, only the system's bounce (the scroller never turns it off)
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('main.waymark-scroll')!).getPropertyValue('overscroll-behavior-y') || 'auto')).toBe('auto')
  const m = await measure(page)
  expect(m.scroll).toBe(0)
  expect(m.veil).toBe(0)
  await expect(page).toHaveURL(/\/today/)
})

test("the first board's top edge always shows above the tab bar, on a short screen too", async ({ page }) => {
  await gotoToday(page)
  for (const h of [659, 420, 260]) {
    await page.setViewportSize({ width: 393, height: h })
    for (const t of TABS) {
      await openTab(page, t.link, t.url)
      await expect.poll(async () => (await measure(page)).scroll).toBe(0)
      const m = await measure(page)
      expect(m.firstTop, `${t.link} at ${h} px: the first board starts above the tab bar`).toBeLessThanOrEqual(m.tabsTop - 56 + 1)
    }
  }
})
