import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { enterFromToday, gotoToday, insertSession, openRow, todayRow } from './support/helpers'
import { setMorning } from './support/data'
import { makeApiFor } from './support/api'

/**
 * Class to combo (page 49 sections 1-3, approved 2026-10-19). After CLOSE
 * SESSION on an MT class: "What you learned", one box and a quiet Skip ›.
 * FIND COMBOS lists every combo as "Combo: Jab, Cross, Lead hook" against the
 * bag (IN YOUR BAG / NEW / LOCKED). The scratch backend has no AI key, so the
 * deterministic parser runs alone here: no AI call is made.
 */

// A morning already checked in: otherwise the check-in cards open first (they come back until all nine are in).
test.beforeAll(async ({ request }) => {
  await setMorning(makeApiFor(request))
})
test.describe.configure({ mode: 'serial' })

const NOTE = 'Teeps to the body to start. Then jab, cross, lead hook on the pads. Coach had us double jab, cross, low kick. Last drill: jab, jab, teep. Partner work catching the kick.'

/** The class log and the effort card, as approved (pages 31 and 19), to the new step. */
async function finishClass(page: Page, id: string) {
  await enterFromToday(page, id)
  const entrance = page.getByRole('button', { name: /Tap to skip\.$/ })
  if (await entrance.isVisible().catch(() => false)) await entrance.tap()
  await page.getByRole('button', { name: 'SAVE CLASS LOG' }).tap()
  await page.getByRole('button', { name: 'CLOSE SESSION' }).tap()
  const box = page.getByRole('dialog', { name: 'What you learned' })
  await expect(box).toBeVisible()
  return box
}

test('After class: write it, find the combos, ADD TO BAG and NOT NOW', async ({ page, api }) => {
  const cls = await insertSession(api, 'mt_class', 'pm')
  const box = await finishClass(page, cls.id)

  // Section 1, phone 3: one box, FIND COMBOS, a quiet Skip ›; page 80's + COMBO beside FIND COMBOS.
  await expect(box.getByText('A note, a combo, or both. The coach pulls out the combos.')).toBeVisible()
  await expect(box.getByRole('button', { name: '+ COMBO' })).toBeVisible()
  await expect(box.getByRole('button', { name: 'Skip ›' })).toBeVisible()
  await box.getByRole('textbox', { name: 'What you learned' }).fill(NOTE)
  await expect(box).toHaveScreenshot('class-what-you-learned.png')
  await box.getByRole('button', { name: 'FIND COMBOS' }).tap()

  // Phone 4: every combo, one line each, against the bag.
  const found = page.getByRole('dialog', { name: "From tonight's class" })
  await expect(found).toBeVisible()
  await expect(found.getByRole('img', { name: '3 FOUND' })).toBeVisible()
  const lines = found.locator('.cl-fl:not(.is-out)')
  await expect(lines).toHaveCount(3)
  await expect(lines.nth(0)).toContainText('Combo: Jab, Cross, Lead hook')
  await expect(lines.nth(0).getByRole('img', { name: 'IN YOUR BAG' })).toBeVisible()
  await expect(lines.nth(0)).toContainText('as Jab › Cross › Hook')
  await expect(lines.nth(1)).toContainText('Combo: Double jab, Cross, Low kick')
  await expect(lines.nth(1).getByRole('img', { name: 'NEW' })).toBeVisible()
  await expect(lines.nth(1)).toContainText('Not in the library')
  await expect(lines.nth(2)).toContainText('Combo: Jab, Jab, Teep')
  await expect(lines.nth(2).getByRole('img', { name: 'LOCKED' })).toBeVisible()
  await expect(lines.nth(2)).toContainText('In Weapons, locked')
  // no combo letters anywhere
  await expect(found.getByRole('img', { name: /^[A-D]$/ })).toHaveCount(0)
  await expect(found).toHaveScreenshot('class-found.png')

  // Phone 5: ADD TO BAG flips the line to ADDED with the glove, and the pop-up drops in.
  await lines.nth(1).getByRole('button', { name: 'ADD TO BAG' }).tap()
  await expect(lines.nth(1).getByRole('img', { name: 'ADDED' })).toBeVisible()
  await expect(lines.nth(1).getByRole('img', { name: 'From class' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'ADDED TO BAG' })).toBeVisible()
  // NOT NOW on the locked one: no buttons left on it.
  await lines.nth(2).getByRole('button', { name: 'NOT NOW' }).tap()
  await expect(lines.nth(2).getByRole('button')).toHaveCount(0)
  await found.getByRole('button', { name: 'DONE' }).tap()

  // On to the closing moment, then Today.
  const moment = page.getByRole('button', { name: /^Well traveled\./ })
  await expect(moment).toBeVisible()
  await moment.tap()
  await expect(page).toHaveURL(/\/today/)

  // Saved: the note with the class; the new combo in the bag, from class, on the class's day.
  const workout = await api.get<{ mtLog: { learnedNote: string | null } }>(`/api/sessions/${cls.id}/mt-class-workout`)
  expect(workout.mtLog.learnedNote).toBe(NOTE)
  const combos = await api.get<Array<{ text: string; unlocked: number; source: string | null; classDate: number | null; tier: string }>>('/api/combos')
  const added = combos.find(c => c.text === 'Double Jab → Cross → Low Kick')
  expect(added).toMatchObject({ unlocked: 1, source: 'class', tier: 'weapons' })
  expect(added?.classDate).toBeTruthy()
  expect(combos.find(c => c.text === 'Jab → Jab → Teep')?.unlocked).toBe(0)
  const lib = await api.get<{ declined: string[] }>('/api/class-combos/library')
  expect(lib.declined).toContain('jab > jab > teep')

  // Section 3 (page 80): in the Library list a combo row is only its strikes and its difficulty
  // (Weapons reads MEDIUM); where it came from shows on the combo's own page.
  await page.goto('/library?open=bag')
  await page.getByRole('button', { name: /WEAPONS/ }).first().tap()
  const row = page.locator('.lib-combo').filter({ has: page.getByLabel('DOUBLE JAB, CROSS, LOW KICK', { exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.getByRole('img', { name: 'MEDIUM' })).toBeVisible()
  await expect(row.locator('.lib-dots, .lib-glove, .lib-anvil')).toHaveCount(0)
  await row.tap()
  await expect(page.locator('.lib-from')).toContainText('From your class')
})

test('The same note again: NOT NOW is not offered again; nothing found says so', async ({ page, api }) => {
  const cls = await insertSession(api, 'mt_class', 'pm')
  const box = await finishClass(page, cls.id)
  await box.getByRole('textbox', { name: 'What you learned' }).fill(NOTE)
  await box.getByRole('button', { name: 'FIND COMBOS' }).tap()
  const found = page.getByRole('dialog', { name: "From tonight's class" })
  await expect(found.getByRole('img', { name: '2 FOUND' })).toBeVisible()
  await expect(found).not.toContainText('Jab, Jab, Teep')
  await expect(found.locator('.cl-fl').nth(1).getByRole('img', { name: 'IN YOUR BAG' })).toBeVisible()
  await found.getByRole('button', { name: 'DONE' }).tap()
  await page.getByRole('button', { name: /^Well traveled\./ }).tap()
})

test('Skipped: + What you learned on that evening\'s class row; strikes it doesn\'t know are named', async ({ page, api }) => {
  const cls = await insertSession(api, 'mt_class', 'pm')
  const box = await finishClass(page, cls.id)
  await box.getByRole('button', { name: 'Skip ›' }).tap()
  await page.getByRole('button', { name: /^Well traveled\./ }).tap()

  // The opened class row: one small line.
  await gotoToday(page)
  const row = todayRow(page, cls.id)
  await openRow(row)
  const learned = row.getByRole('button', { name: '+ What you learned' })
  await expect(learned).toBeVisible()
  await learned.tap()

  // The same box. Strikes the app has no record of: NO COMBOS FOUND, named once.
  const again = page.getByRole('dialog', { name: 'What you learned' })
  await again.getByRole('textbox', { name: 'What you learned' }).fill('Superman punch, spinning elbow. Superman punch, spinning elbow.')
  await again.getByRole('button', { name: 'FIND COMBOS' }).tap()
  const none = page.getByRole('dialog', { name: 'No combos found' })
  await expect(none.getByRole('img', { name: 'NO COMBOS FOUND' })).toBeVisible()
  await expect(none).toContainText("These strikes aren't in the app, so there's no combo to add.")
  await expect(none).toContainText('Superman punch, spinning elbow.')
  await expect(none).toHaveScreenshot('class-none-unknown.png')

  // EDIT keeps the words; a plain note: no combo, saved with the class.
  await none.getByRole('button', { name: 'EDIT' }).tap()
  const edit = page.getByRole('dialog', { name: 'What you learned' })
  await expect(edit.getByRole('textbox')).toHaveValue('Superman punch, spinning elbow. Superman punch, spinning elbow.')
  await edit.getByRole('textbox').fill('Partner work, good class.')
  await edit.getByRole('button', { name: 'FIND COMBOS' }).tap()
  await expect(page.getByRole('dialog', { name: 'No combos found' })).toContainText("No combo in that note. It's saved with tonight's class.")
  await page.getByRole('button', { name: 'DONE', exact: true }).tap()
  await expect(row.getByRole('button', { name: '+ What you learned' })).toHaveCount(0)
  const workout = await api.get<{ mtLog: { learnedNote: string | null } }>(`/api/sessions/${cls.id}/mt-class-workout`)
  expect(workout.mtLog.learnedNote).toBe('Partner work, good class.')
})
