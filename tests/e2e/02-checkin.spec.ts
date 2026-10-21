import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { gotoToday, todayISO } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

test.describe.configure({ mode: 'serial' })

/** Each card in order, and the tile to tap (by its accessible name). */
const GOOD: Array<[string, string]> = [
  ['SLEEP', '8'],
  ['SLEEP QUALITY', '4, good'],
  ['ENERGY', '4, good'],
  ['SORENESS', '2, loose'],
  ['STRESS', '2, low'],
  ['MOOD', '4, good'],
  ['BACK TODAY', '4, good'],
  ['ALCOHOL', '0, none'],
  ['HERB', '3'],
]

async function openDeck(page: Page) {
  await gotoToday(page)
  await page.getByRole('button', { name: 'Edit the Morning Report' }).tap()
  const deck = page.getByRole('dialog', { name: 'Morning check-in' })
  await expect(deck).toBeVisible()
  return deck
}

// A complete morning to start from: the cards open by themselves while any of the nine is missing.
test.beforeAll(async ({ request }) => {
  await setMorning(makeApiFor(request))
})

test.afterAll(async ({ request }) => {
  // Leave a plain good morning for the specs after this one.
  await setMorning(makeApiFor(request))
})

test('Morning check-in: nine cards, the herb 0-9 card, GOOD TO GO, and the row on Today', async ({ page, api }) => {
  const deck = await openDeck(page)

  for (const [i, [title, tile]] of GOOD.entries()) {
    await expect(deck.getByRole('img', { name: title, exact: true })).toBeVisible()
    await expect(deck.getByText(`${i + 1} of 9`)).toBeVisible()
    if (title === 'HERB') {
      // Page 51: ten tiles, 0 (none) to 9 (most), two rows of five.
      const herb = deck.getByRole('group', { name: 'Herb' })
      await expect(herb.getByRole('button')).toHaveCount(10)
      await expect(herb.getByRole('button', { name: '0, none' })).toBeVisible()
      await expect(herb.getByRole('button', { name: '9, most' })).toBeVisible()
      await expect(deck.getByText('Last 24 h · 0 none, 9 most')).toBeVisible()
      await expect(deck).toHaveScreenshot('checkin-herb-card.png')
    }
    await deck.getByRole('button', { name: tile, exact: true }).tap()
  }

  // The verdict card.
  await expect(deck.getByRole('img', { name: 'GOOD TO GO' })).toBeVisible()
  await expect(deck).toHaveScreenshot('checkin-good-to-go.png')
  await deck.getByRole('button', { name: 'TO TODAY' }).tap()
  await expect(deck).toBeHidden()

  const report = page.getByRole('button', { name: /^Morning Report, logged\./ })
  await expect(report.getByRole('paragraph')).toHaveText('Good to go.')

  // What was saved.
  const log = await api.get<{ herbScale: number; sleepHours: number; backToday: number; alcoholScale: number }>(`/api/daily-logs/today?date=${todayISO()}`)
  expect(log).toMatchObject({ herbScale: 3, sleepHours: 8, backToday: 4, alcoholScale: 0 })
})

test('Morning check-in: a rough morning names what is off trend, a bad back asks what bothers it', async ({ page, api }) => {
  const deck = await openDeck(page)
  const rough: Array<[string, string]> = [
    ['SLEEP', '4, or less'], ['SLEEP QUALITY', '1, poor'], ['ENERGY', '1, empty'], ['SORENESS', '5, cooked'],
    ['STRESS', '5, maxed'], ['MOOD', '1, low'], ['BACK TODAY', '2, sore'],
  ]
  for (const [title, tile] of rough) {
    await expect(deck.getByRole('img', { name: title, exact: true })).toBeVisible()
    await deck.getByRole('button', { name: tile, exact: true }).tap()
  }
  // Back today at 2 or under: the back-notes card.
  await expect(deck.getByRole('img', { name: 'WHAT BOTHERS IT?' })).toBeVisible()
  await deck.getByRole('textbox').fill('Bending forward')
  await deck.getByRole('button', { name: 'NEXT' }).tap()
  await deck.getByRole('button', { name: '3+', exact: true }).tap()
  await expect(deck.getByRole('img', { name: 'HERB', exact: true })).toBeVisible()
  await deck.getByRole('button', { name: '9, most', exact: true }).tap()

  // The verdict names what is off trend. With the demo seed's short history one
  // rough morning stays GOOD TO GO ("One day doesn't change the plan"); the
  // server decides when it eases (readinessFor).
  await expect(deck.getByRole('img', { name: /^(GOOD TO GO|EASING TODAY)$/ })).toBeVisible()
  // The brain names the numbers (coach brain P2): "Slept 4 h with energy 1.", or what is off trend.
  await expect(deck.getByText(/off trend|Slept \d+(\.\d)? h/).first()).toBeVisible()
  await deck.getByRole('button', { name: 'TO TODAY' }).tap()
  await expect(page.getByRole('button', { name: /^Morning Report, logged\./ })).toBeVisible()

  const log = await api.get<{ herbScale: number; backToday: number; backNotes: string }>(`/api/daily-logs/today?date=${todayISO()}`)
  expect(log).toMatchObject({ herbScale: 9, backToday: 2, backNotes: 'Bending forward' })
})

test('Morning check-in: comes back until all nine are in, at the first unanswered card, with no skip', async ({ page, api }) => {
  // A fresh morning: nothing answered yet.
  const blank = Object.fromEntries(GOOD.map((_, i) => [['sleepHours', 'sleepQuality', 'energy', 'soreness', 'stress', 'mood', 'backToday', 'alcoholScale', 'herbScale'][i], null]))
  await setMorning(api, blank)

  // The app opens on Today: the cards come up by themselves (a takeover, Today waits behind them).
  // No "Skip today", only Close.
  await page.goto('/today?resume=0')
  const deck = page.getByRole('dialog', { name: 'Morning check-in' })
  await expect(deck).toBeVisible({ timeout: 20_000 })
  await expect(deck.getByText('1 of 9')).toBeVisible()
  await expect(page.getByText(/skip today/i)).toHaveCount(0)
  await expect(deck.getByRole('button', { name: 'Close', exact: true })).toBeVisible()

  // Three answers, each saved as it is given.
  for (const [title, tile] of GOOD.slice(0, 3)) {
    await expect(deck.getByRole('img', { name: title, exact: true })).toBeVisible()
    await deck.getByRole('button', { name: tile, exact: true }).tap()
  }
  await expect(deck.getByText('4 of 9')).toBeVisible()
  await expect.poll(async () => (await api.get<{ energy: number | null }>(`/api/daily-logs/today?date=${todayISO()}`)).energy).toBe(4)
  const partial = await api.get<{ sleepHours: number; sleepQuality: number; soreness: number | null }>(`/api/daily-logs/today?date=${todayISO()}`)
  expect(partial).toMatchObject({ sleepHours: 8, sleepQuality: 4, soreness: null })

  // Closed (page 61): the answers are kept and the Morning Report row reads CHECK IN · 3 OF 9.
  await deck.getByRole('button', { name: 'Close', exact: true }).tap()
  await expect(deck).toBeHidden()
  await expect(page.getByRole('button', { name: /^Morning Report, not logged yet, 3 of 9\./ })).toBeVisible()
  await expect(page.getByText('Your answers so far are kept. Tap to carry on.')).toBeVisible()
  await expect(page.getByRole('img', { name: 'CHECK IN · 3 OF 9' })).toBeVisible()

  // The next app open: back, on the first unanswered card (soreness).
  await page.reload()
  await expect(deck).toBeVisible({ timeout: 20_000 })
  await expect(deck.getByText('4 of 9')).toBeVisible()
  await expect(deck.getByRole('img', { name: 'SORENESS', exact: true })).toBeVisible()
  await deck.getByRole('button', { name: 'Close', exact: true }).tap()
  await expect(deck).toBeHidden()

  // Today back in the foreground (from another app): back again.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(deck).toBeVisible()
  await expect(deck.getByText('4 of 9')).toBeVisible()

  // The rest of the nine: GOOD TO GO, and the row reads LOGGED.
  for (const [title, tile] of GOOD.slice(3)) {
    await expect(deck.getByRole('img', { name: title, exact: true })).toBeVisible()
    await deck.getByRole('button', { name: tile, exact: true }).tap()
  }
  await expect(deck.getByRole('img', { name: 'GOOD TO GO' })).toBeVisible()
  await deck.getByRole('button', { name: 'TO TODAY' }).tap()
  await expect(page.getByRole('button', { name: /^Morning Report, logged\./ })).toBeVisible()

  // All nine in: the next open stays on Today.
  await page.reload()
  await expect(page.getByRole('button', { name: /^Morning Report, logged\./ })).toBeVisible({ timeout: 20_000 })
  await expect(deck).toBeHidden()
})

test('Morning check-in: a PASS counts for re-opening (approved 2026-10-21), LOGGED still needs all nine, CHECK IN reopens', async ({ page, api }) => {
  const blank = Object.fromEntries(['sleepHours', 'sleepQuality', 'energy', 'soreness', 'stress', 'mood', 'backToday', 'alcoholScale', 'herbScale'].map(k => [k, null]))
  await setMorning(api, blank)
  await page.goto('/today?resume=0')
  const deck = page.getByRole('dialog', { name: 'Morning check-in' })
  await expect(deck).toBeVisible({ timeout: 20_000 })

  // Eight answers, the herb card passed.
  for (const [title, tile] of GOOD.slice(0, 8)) {
    await expect(deck.getByRole('img', { name: title, exact: true })).toBeVisible()
    await deck.getByRole('button', { name: tile, exact: true }).tap()
  }
  await expect(deck.getByRole('img', { name: 'HERB', exact: true })).toBeVisible()
  await deck.getByRole('button', { name: /^PASS/ }).tap()
  await expect(deck.getByRole('img', { name: /^(GOOD TO GO|EASING TODAY)$/ })).toBeVisible()
  await deck.getByRole('button', { name: 'TO TODAY' }).tap()
  await expect(deck).toBeHidden()
  await expect(page.getByRole('button', { name: /^Morning Report, not logged yet, 8 of 9\./ })).toBeVisible()

  // The next open stays on Today: the passed card doesn't bring the deck back.
  await page.reload()
  await expect(page.getByRole('button', { name: /^Morning Report, not logged yet, 8 of 9\./ })).toBeVisible({ timeout: 20_000 })
  await expect(deck).toBeHidden()

  // CHECK IN on the row still opens the cards, at the passed one.
  await page.getByRole('button', { name: /^Morning Report, not logged yet/ }).tap()
  await expect(deck).toBeVisible()
  await expect(deck.getByRole('img', { name: 'HERB', exact: true })).toBeVisible()
  await deck.getByRole('button', { name: 'Close', exact: true }).tap()
})
