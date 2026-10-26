import { test, expect } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { gotoToday, insertSession, todayISO } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * His combos and his bag sessions (page 80, approved 2026-10-23). Library
 * + COMBO: typed on the slate, READ IT shows it back as strike flaps, a word
 * it doesn't know is clay and one tap fixes it, the grade is one flap word
 * (▼ ▲ nudge it, "set by you"), ADD lands the row with NEW. Bag Work asks
 * COACH / HYBRID / CUSTOM: Coach plans the kru's arc; Hybrid's rounds he
 * fills get the gold edge and the rest say "coach fills"; Custom's − / +
 * and "—"; SAVE ROUTINE puts it under YOUR ROUTINES. The scratch backend has
 * no AI key: a coach session at start is the arc itself.
 */
test.beforeAll(async ({ request }) => {
  await setMorning(makeApiFor(request))
})
test.describe.configure({ mode: 'serial' })

type Combo = { id: string; text: string; unlocked: number; source: string | null; tier: string; difficultyOverride: string | null }

/** Wait for a window's pop to settle (page 59: 180 ms), then tap. */
async function settledTap(target: Locator) {
  await expect(target).toBeVisible()
  await expect.poll(() => target.evaluate(el => (el.closest('.pl-cmd, .bb-sheet') ?? el).getAnimations({ subtree: true })
    .filter(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity).length)).toBe(0)
  await target.tap()
}

async function openAddOnToday(page: Page) {
  await gotoToday(page)
  await page.getByRole('button', { name: '+ add session' }).tap()
  const picks = page.getByRole('dialog', { name: 'Coach picks: add' })
  await expect(picks.locator('.pl-cl:not(.is-more)').first()).toBeVisible({ timeout: 20_000 })
  await settledTap(picks.getByRole('button', { name: 'Everything else' }))
  await settledTap(picks.getByRole('button', { name: 'Bag Work', exact: true }))
  await settledTap(picks.getByRole('button', { name: 'Add', exact: true }))
  const modes = page.getByRole('dialog', { name: 'Bag work', exact: true })
  await expect(modes).toBeVisible()
  return modes
}

test('Library + COMBO: type it, READ IT, fix the clay word, nudge the grade, ADD', async ({ page, api }) => {
  await page.goto('/library?open=bag')
  await page.getByRole('button', { name: '+ Combo' }).tap()
  const win = page.getByRole('dialog', { name: 'New combo' })
  const slate = win.getByRole('textbox', { name: 'Type the combo' })
  await expect(slate).toBeFocused()
  await slate.fill('jab cross swich kick')
  await expect(win).toHaveScreenshot('combo-typed.png', { mask: [win.locator('.caretb')] })
  await win.getByRole('button', { name: 'Read it' }).tap()

  // shown back the app's way; "swich" in clay, ADD blocked while it stays
  await expect(win.getByRole('img', { name: 'JAB' })).toBeVisible()
  const clay = win.getByRole('button', { name: 'swich: not a strike the app knows' })
  await expect(clay).toBeVisible()
  await expect(win.getByRole('button', { name: 'Add' })).toBeDisabled()
  await clay.tap()
  const fixes = win.getByRole('group', { name: 'Fixes' })
  await expect(fixes.getByRole('button', { name: 'Leave it out' })).toBeVisible()
  await fixes.getByRole('button', { name: 'Switch kick' }).tap()
  await expect(win.getByRole('button', { name: /not a strike the app knows/ })).toHaveCount(0)
  await expect(win.getByRole('img', { name: 'SWITCH KICK' })).toBeVisible()

  // graded by the Library's rules: a kick is MEDIUM; ▲ sets HARD, "set by you"
  await expect(win.getByRole('img', { name: 'MEDIUM' })).toBeVisible()
  await expect(win.getByText('set by you')).toHaveCount(0)
  await win.getByRole('button', { name: 'Harder' }).tap()
  await expect(win.getByRole('img', { name: 'HARD' })).toBeVisible()
  await expect(win.getByText('set by you')).toBeVisible()
  await expect(win).toHaveScreenshot('combo-read-back.png')
  await win.getByRole('button', { name: 'Add' }).tap()
  await expect(win).toBeHidden()

  // the row lands at the top, NEW, strikes and the one difficulty flap
  const fresh = page.locator('.cmb-row').first()
  await expect(fresh.getByRole('img', { name: 'NEW' })).toBeVisible()
  await expect(fresh.getByRole('img', { name: 'HARD' })).toBeVisible()
  const combos = await api.get<Combo[]>('/api/combos')
  const mine = combos.find(c => c.text === 'Jab → Cross → Switch Kick')
  expect(mine).toMatchObject({ unlocked: 1, source: 'mine', difficultyOverride: 'hard' })
})

test('Library rows: only the strikes and the difficulty, no mastery mark', async ({ page }) => {
  await page.goto('/library?open=bag')
  // Page 93: his combos sit by type, each group folded until tapped (one open at a time).
  await page.getByRole('button', { name: /^(HANDS|KICKS|TEEPS|KNEES|ELBOWS) \d+$/ }).first().tap()
  const rows = page.locator('.lib-combo:not(.is-locked)')
  await expect(rows.first()).toBeVisible()
  await expect(rows.first().getByRole('img', { name: /^(EASY|MEDIUM|HARD|EXPERT)$/ })).toBeVisible()
  await expect(page.locator('.lib-combo .lib-dots, .lib-combo .lib-anvil')).toHaveCount(0)
})

test('Bag Work asks COACH / HYBRID / CUSTOM; COACH plans the kru\'s rounds (page 93)', async ({ page, api }) => {
  const modes = await openAddOnToday(page)
  for (const m of ['Coach', 'Hybrid', 'Custom']) await expect(modes.getByRole('button', { name: m })).toBeVisible()
  await expect(modes).toHaveScreenshot('bag-modes.png')
  await modes.getByRole('button', { name: 'Coach' }).tap()
  const board = page.getByRole('dialog', { name: 'Bag work: coach' })
  await expect(board.getByRole('img', { name: 'COACH' })).toBeVisible()
  await expect(board.locator('.bb-rnd').first()).toContainText('WARM-UP')
  await expect(board.getByText('TECHNIQUE').first()).toBeVisible()
  // the new combo goes to the first technique round, alone, tagged NEW (learn A)
  await expect(board.locator('.bb-rnd').nth(1).locator('.cmb-strikes')).toHaveCount(1)
  await expect(board.locator('.bb-rnd').nth(1)).toContainText(/SWITCH\s*KICK/)
  await expect(board.locator('.bb-rnd').nth(1).getByRole('img', { name: 'NEW', exact: true })).toBeVisible()
  // page 86's finisher as one row with its set count (the sets come one at a time in the session)
  await expect(board.locator('[data-finisher-row]')).toContainText(/\d SETS · GOAL \d+/)
  await expect(board.getByText('KICKS · LAST 30 S ALL OUT')).toHaveCount(0)
  // (no screenshot: the coach's round count follows the test athlete's readiness, set by earlier specs)
  const before = (await api.get<Array<{ type: string }>>(`/api/sessions/today?date=${todayISO()}`)).length
  await board.getByRole('button', { name: 'Add' }).tap()
  await expect(board).toBeHidden()
  await expect.poll(async () => (await api.get<Array<{ type: string }>>(`/api/sessions/today?date=${todayISO()}`)).length).toBeGreaterThan(before)
})

test('HYBRID: fill a round from the picker (gold edge), the rest say coach fills; SAVE ROUTINE', async ({ page }) => {
  const modes = await openAddOnToday(page)
  await modes.getByRole('button', { name: 'Hybrid' }).tap()
  const board = page.getByRole('dialog', { name: 'Bag work: hybrid' })
  await expect(board.getByText('coach fills').first()).toBeVisible()
  await board.getByRole('button', { name: 'Round 2' }).tap()
  const pick = page.getByRole('dialog', { name: 'Round 2' })
  await expect(pick.getByRole('img', { name: 'NEW', exact: true }).first()).toBeVisible()
  await expect(pick.getByRole('img', { name: 'ALL', exact: true })).toBeVisible()
  await expect(pick.getByRole('button', { name: '+ New combo' })).toBeVisible()
  await pick.getByRole('button', { name: 'Jab → Cross → Switch Kick' }).tap()
  await expect(pick.getByRole('button', { name: 'Jab → Cross → Switch Kick' })).toHaveAttribute('aria-pressed', 'true')
  // search narrows the list
  await pick.getByRole('textbox', { name: 'Search your combos' }).fill('elbow')
  await expect(pick.getByRole('button', { name: 'Jab → Cross → Switch Kick' })).toHaveCount(0)
  await pick.getByRole('button', { name: 'Done' }).tap()
  await expect(pick).toBeHidden()
  await expect(board.locator('.bb-rnd').nth(1)).toHaveClass(/is-mine/)
  await expect(board.locator('.bb-rnd').nth(1)).toContainText(/SWITCH\s*KICK/)
  // (no screenshot: Hybrid's round count is the coach's, see above)

  await board.getByRole('button', { name: 'Save routine' }).tap()
  const save = page.getByRole('dialog', { name: 'Save as routine' })
  await save.getByRole('textbox', { name: 'Routine name' }).fill('Thursday hands')
  await save.getByRole('button', { name: 'Save' }).tap()
  await expect(save).toBeHidden()
  await expect(board.getByRole('button', { name: 'Saved' })).toBeVisible()
  await page.mouse.click(8, 8)
  await expect(board).toBeHidden()

  // next time: under YOUR ROUTINES; starting it keeps everything editable
  const again = await openAddOnToday(page)
  await expect(again.getByRole('img', { name: 'YOUR ROUTINES' })).toBeVisible()
  await again.getByRole('button', { name: 'Routine: Thursday hands' }).tap()
  const back = page.getByRole('dialog', { name: 'Bag work: hybrid' })
  await expect(back.locator('.bb-rnd').nth(1)).toHaveClass(/is-mine/)
  await back.getByRole('button', { name: 'Round 1' }).tap()
  await expect(page.getByRole('dialog', { name: 'Round 1' })).toBeVisible()
})

test('CUSTOM: − / + rounds, length and rest; empty rounds "—"; it starts exactly as he set it', async ({ page, api }) => {
  const modes = await openAddOnToday(page)
  await modes.getByRole('button', { name: 'Custom' }).tap()
  const board = page.getByRole('dialog', { name: 'Bag work: custom' })
  await expect(board.getByText('WARM-UP')).toHaveCount(0)
  await expect(board.locator('[data-finisher-row]')).toHaveCount(0)
  const rounds = board.locator('.bb-rnd:not(.bb-fin)')
  const n = await rounds.count()
  await board.getByRole('button', { name: 'Rounds: more' }).tap()
  await expect(rounds).toHaveCount(n + 1)
  // the coach's dose sets the starting count (it moves with the day), so the picture is taken at 5
  for (let k = n + 1; k > 5; k--) await board.getByRole('button', { name: 'Rounds: less' }).tap()
  for (let k = n + 1; k < 5; k++) await board.getByRole('button', { name: 'Rounds: more' }).tap()
  await expect(rounds).toHaveCount(5)
  await board.getByRole('button', { name: 'Round: less' }).tap()
  await expect(board.getByRole('img', { name: '2:00' })).toBeVisible()
  await expect(rounds.first()).toContainText('—')
  await expect(board).toHaveScreenshot('bag-custom.png')

  // through the API: a custom session starts with his rounds only
  const combos = await api.get<Combo[]>('/api/combos')
  const mine = combos.find(c => c.source === 'mine')!
  const s = await insertSession(api, 'bag_work', 'pm', { bag: { mode: 'custom', rounds: 3, roundSec: 120, restSec: 60, picked: { 0: [mine.id] } } })
  const started = await api.post<{ rounds: Array<{ durationSec: number; combos: Array<{ combo: { id: string } | null }> }> }>(`/api/sessions/${s.id}/start-bag-work`)
  expect(started.rounds.map(r => r.durationSec)).toEqual([120, 120, 120])
  expect(started.rounds.map(r => r.combos.map(c => c.combo?.id))).toEqual([[mine.id], [], []])
})
