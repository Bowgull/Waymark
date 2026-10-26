import { test, expect } from './fixtures'
import { enterFromToday, insertSession, swipeUpGrass } from './support/helpers'

/**
 * Bag Conditioning (page 93): its own session on page 81's interval timer.
 * GET READY shows the first move, then each part one move big (WORK gold,
 * REST teal); the grass moves it on, with no buttons.
 */
test('Bag Conditioning: get ready, one move big, the grass moves it on', async ({ page, api }) => {
  test.setTimeout(120_000)
  const s = await insertSession(api, 'bag_conditioning')
  await enterFromToday(page, s.id)

  const word = page.locator('[data-conditioning]')
  await expect(page.getByRole('img', { name: 'BAG CONDITIONING' }).first()).toBeVisible()
  await expect(word).toHaveAttribute('data-phase', 'ready')
  await expect(page.locator('[data-move="rope_or_jog"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /^(END|END EARLY|SKIP|NEXT|NEXT SET)$/ })).toHaveCount(0)

  // the coach's pick, kept once started: the timer runs its parts in order
  const read = await api.get<{ plan: { templateId: string; blocks: Array<{ name: string }>; parts: Array<{ ph: string; block: number; move?: string }> } | null; started: boolean }>(`/api/sessions/${s.id}/bag-conditioning`)
  expect(read.started).toBe(true)
  const plan = read.plan!
  expect(plan.blocks[0].name).toBe('WARM-UP')
  const warm = plan.parts.filter(p => p.block === 0).length

  // through the warm-up to round 1's first move, ROUND 1 OF n beside the clock
  for (let i = 0; i < warm + 1; i++) await swipeUpGrass(page)
  await expect(word).toHaveAttribute('data-phase', 'work')
  await expect(page.locator(`[data-move="${plan.parts[warm].move}"]`)).toBeVisible()
  await expect(page.getByRole('img', { name: /^Round 1 of \d+$/ })).toBeVisible()

  // a rest (when the round has one) shows what's next
  const next = plan.parts[warm + 1]
  if (next?.ph === 'rest') {
    await swipeUpGrass(page)
    await expect(word).toHaveAttribute('data-phase', 'rest')
    await expect(page.locator(`[data-move="${plan.parts[warm + 2].move}"]`)).toBeVisible()
  }
})
