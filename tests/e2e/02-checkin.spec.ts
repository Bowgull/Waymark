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
  await expect(deck.getByText(/off (your 7-day )?trend/)).toBeVisible()
  await deck.getByRole('button', { name: 'TO TODAY' }).tap()
  await expect(page.getByRole('button', { name: /^Morning Report, logged\./ })).toBeVisible()

  const log = await api.get<{ herbScale: number; backToday: number; backNotes: string }>(`/api/daily-logs/today?date=${todayISO()}`)
  expect(log).toMatchObject({ herbScale: 9, backToday: 2, backNotes: 'Bending forward' })
})
