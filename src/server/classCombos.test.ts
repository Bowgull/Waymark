// Run: tsx src/server/classCombos.test.ts
// Class to combo (page 49) on a real (in-memory) database with every
// migration, 0037 included: the note is saved with the class, the found lines
// are checked against the bag, ADD TO BAG adds a new combo or unlocks a locked
// one (both marked from class with the class's day), NOT NOW is remembered.
// No AI: the empty key stops lib/anthropic before any fetch, so the parser runs alone.
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'

import { combos, mtClassLogs, sessions, settings } from '../db/schema'
import { isoToEpochDay } from '../lib/dates'
import { addToBag, bagLibrary, declineCombo, learnedFor } from './routes/classCombos'
import { bagPool, listRoutines, saveRoutine } from './routes/bagBuilder'
import { testDb } from './testDb'

const TUE20 = isoToEpochDay('2026-10-20')

async function main() {
  const db = testDb()
  const now = Math.floor(Date.now() / 1000)
  const lib = [
    ['combo-f02', 'Jab → Cross → Hook', 'foundation', 1, 'boxing'],
    ['combo-w05', 'Jab → Jab → Teep', 'weapons', 0, 'boxing,defensive'],
    ['combo-w03', 'Jab → Cross → Low Kick', 'weapons', 0, 'boxing,kicks'],
    ['combo-f03', 'Double Jab → Cross', 'foundation', 1, 'boxing'],
    ['combo-w10', 'Jab → Cross → Rear Knee', 'weapons', 1, 'boxing,knees'],
  ] as const
  // the migrations' own combos out of the way: this test's bag only
  await db.delete(combos)
  await db.delete(settings)
  for (const [id, text, tier, unlocked, techniques] of lib) {
    await db.insert(combos).values({ id, text, tier, level: tier, unlocked, techniques, createdAt: now })
  }
  await db.insert(settings).values({ id: 'default', enabledTechniques: 'boxing,kicks,defensive', createdAt: now, updatedAt: now })
  await db.insert(sessions).values({ id: 's-class', type: 'mt_class', scheduledDate: TUE20, status: 'completed', createdAt: now })
  await db.insert(mtClassLogs).values({ id: 'mt-1', sessionId: 's-class', classType: 'technical', durationMin: 60 })

  const note = 'Teeps to the body to start. Then jab, cross, lead hook on the pads. Coach had us double jab, cross, low kick. Last drill: jab, jab, teep. Superman punch, spinning elbow.'
  const out = await learnedFor(db, '', 'mt-1', note)
  assert.ok(out)
  assert.equal(out.by, 'parser', 'no key: no AI call, the parser alone')
  assert.deepEqual(out.lines.map(l => [l.strikes.join(', '), l.status, l.sub]), [
    ['Jab, Cross, Lead hook', 'in_bag', 'as Jab › Cross › Hook'],
    ['Double jab, Cross, Low kick', 'new', 'Not in the library'],
    ['Jab, Jab, Teep', 'locked', 'In Weapons, locked'],
  ])
  assert.deepEqual(out.unknown, ['Superman punch', 'Spinning elbow'])
  const [log] = await db.select().from(mtClassLogs).where(eq(mtClassLogs.id, 'mt-1'))
  assert.equal(log.learnedNote, note, 'the note is saved with the class')
  assert.ok(log.learnedAt)
  assert.equal(await learnedFor(db, '', 'nope', note), null)

  // ADD TO BAG on NEW: a new combo, in the library's own words, from class, Tuesday's class.
  const added = await addToBag(db, ['Double jab', 'Cross', 'Low kick'], 's-class')
  assert.ok(!('error' in added))
  assert.equal(added.status, 'added')
  assert.equal(added.combo.text, 'Double Jab → Cross → Low Kick')
  assert.equal(added.combo.tier, 'weapons')
  assert.equal(added.combo.techniques, 'boxing,kicks')
  assert.equal(added.combo.unlocked, 1)
  assert.equal(added.combo.masteryScore, 0)
  assert.equal(added.combo.source, 'class')
  assert.equal(added.combo.classDate, TUE20)
  const twice = await addToBag(db, ['Double jab', 'Cross', 'Low kick'], 's-class')
  assert.ok(!('error' in twice) && twice.status === 'in_bag' && twice.combo.id === added.combo.id, 'a second tap adds nothing')

  // ADD TO BAG on LOCKED: unlocks it, glove from now on.
  const unlocked = await addToBag(db, ['Jab', 'Jab', 'Teep'], 's-class')
  assert.ok(!('error' in unlocked))
  assert.equal(unlocked.status, 'unlocked')
  assert.equal(unlocked.combo.id, 'combo-w05')
  assert.equal(unlocked.combo.unlocked, 1)
  assert.equal(unlocked.combo.source, 'class')

  // Strikes it doesn't know, or that are switched off, are refused.
  assert.ok('error' in await addToBag(db, ['Jab', 'Superman punch'], 's-class'))
  assert.ok('error' in await addToBag(db, ['Jab', 'Cross', 'Rear knee'], 's-class'), 'knees are off')

  // Now all three are in the bag.
  const after = await learnedFor(db, '', 'mt-1', note)
  assert.deepEqual(after?.lines.map(l => l.status), ['in_bag', 'in_bag', 'in_bag'])

  // NOT NOW is remembered: the same combo isn't offered again (twice is fine).
  await declineCombo(db, ['Jab', 'Cross', 'Low kick'], 's-class')
  await declineCombo(db, ['Jab', 'Cross', 'Low kick'], 's-class')
  const again = await learnedFor(db, '', 'mt-1', 'Jab, cross, low kick. Jab, cross, hook.')
  assert.deepEqual(again?.lines.map(l => l.strikes.join(', ')), ['Jab, Cross, Hook'])
  const bag = await bagLibrary(db)
  assert.equal(bag.declined.length, 1)
  assert.deepEqual(bag.enabled, ['boxing', 'kicks', 'defensive'])
  assert.ok(bag.combos.some(c => c.source === 'class'))

  // Nothing found: the note is still saved.
  const none = await learnedFor(db, '', 'mt-1', 'Partner work. Good class.')
  assert.deepEqual(none?.lines, [])
  assert.deepEqual(none?.unknown, [])

  // Page 80: a combo he typed: his ('mine'), no class day, his nudged grade; one strike is fine.
  const mine = await addToBag(db, ['Jab', 'Cross', 'Hook', 'Cross', 'Hook'], null, TUE20, { source: 'mine', difficulty: 'expert' })
  assert.ok(!('error' in mine))
  assert.equal(mine.status, 'added')
  assert.match(mine.combo.id, /^combo-m-/)
  assert.equal(mine.combo.source, 'mine')
  assert.equal(mine.combo.classDate, null)
  assert.equal(mine.combo.tier, 'flow', 'graded by the Library\'s rules')
  assert.equal(mine.combo.difficultyOverride, 'expert', 'his nudge kept')
  assert.equal(mine.combo.unlocked, 1, 'in his pool')
  const ungraded = await addToBag(db, ['Jab', 'Cross', 'Low kick', 'Hook'], null, TUE20, { source: 'mine' })
  assert.ok(!('error' in ungraded) && ungraded.combo.difficultyOverride == null, 'no nudge: the tier\'s grade')
  // a locked library combo he types: unlocked as his
  const typedLocked = await addToBag(db, ['Jab', 'Cross', 'Low kick'], null, TUE20, { source: 'mine' })
  assert.ok(!('error' in typedLocked) && typedLocked.status === 'unlocked' && typedLocked.combo.source === 'mine')
  assert.ok('error' in await addToBag(db, ['Jab', 'Swich kick'], null, TUE20, { source: 'mine' }), 'an unknown strike is refused')

  // His pool for the bag builder: unlocked, switched on; knees off leaves the knee combo out.
  const pool = await bagPool(db)
  assert.ok(pool.some(p => p.id === mine.combo.id && p.source === 'mine' && p.difficultyOverride === 'expert'))
  assert.ok(!pool.some(p => p.id === 'combo-w10'), 'knees are off in Settings')
  assert.ok(pool.every(p => p.id !== 'combo-w03' || p.source === 'mine'))

  // SAVE ROUTINE: saved, then the same name updates it; newest first.
  const r1 = await saveRoutine(db, { name: 'Tuesday kicks', mode: 'hybrid', rounds: [[], [mine.combo.id], [], []], roundSec: 180, restSec: 60 }, 100)
  assert.equal(r1.name, 'Tuesday kicks')
  assert.deepEqual(r1.rounds, [[], [mine.combo.id], [], []])
  const r1b = await saveRoutine(db, { name: 'tuesday kicks', mode: 'custom', rounds: [['combo-f02']], roundSec: 120, restSec: 60 }, 200)
  assert.equal(r1b.id, r1.id, 'the same name: updated')
  assert.equal(r1b.mode, 'custom')
  await saveRoutine(db, { name: 'Quick hands', mode: 'custom', rounds: [['combo-f02'], []], roundSec: 120, restSec: 60 }, 300)
  assert.deepEqual((await listRoutines(db)).map(r => r.name), ['Quick hands', 'tuesday kicks'])

  console.log('server classCombos tests passed')
}

main().catch(e => { console.error(e); process.exit(1) })
