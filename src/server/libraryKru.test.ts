// Run: tsx src/server/libraryKru.test.ts
// 0050, the kru pass (approved by Josh 2026-10-24), on a real in-memory
// database: every migration, then the seed (the Library as production has it),
// then 0050 once more, as wrangler would apply it on top (0051, 0052 and 0054
// after it). Kicks and teeps are
// named the way a kru calls them, 19 combos are added, Axe Kick and Spinning
// Back Kick are gone, and his mastery, favourites and unlocks are left alone.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { techniqueFor, type LibraryTechnique } from '../features/library/libraryModel'
import { categoryOf } from '../lib/classCombos'

const ROOT = process.cwd()
const MIGRATION = readFileSync(join(ROOT, 'drizzle/0050_kru_combos.sql'), 'utf8')
const statements = MIGRATION.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('--'))
for (const s of statements) assert.match(s, /^(UPDATE (combos|techniques) SET .+ WHERE id = '[a-z0-9-]+';|INSERT OR IGNORE INTO (combos|techniques) .+;|DELETE FROM (combos|techniques) WHERE id IN \(.+;)$/, `by id only: ${s.slice(0, 80)}`)
assert.doesNotMatch(MIGRATION, /\b(DROP|ALTER)\b/, 'no schema change')
const seed = readFileSync(join(ROOT, 'src/db/seed.sql'), 'utf8')
for (const s of statements) assert.ok(seed.includes(s), `seed.sql has: ${s.slice(0, 80)}`)
const files = readdirSync(join(ROOT, 'drizzle')).filter(n => n.endsWith('.sql')).sort()
assert.equal(files[files.indexOf('0049_combos_bag_builder.sql') + 1], '0050_kru_combos.sql', '0050 follows 0049')

const db = new Database(':memory:')
// as 0050 left it: 0051 (no overhands) and 0052 (only his level open) come after, at the end
const TRIM = readFileSync(join(ROOT, 'drizzle/0051_drop_overhand.sql'), 'utf8')
const trimLines = TRIM.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('--'))
const LEVELS = readFileSync(join(ROOT, 'drizzle/0052_close_combos_by_tier.sql'), 'utf8')
const levelLines = LEVELS.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('--'))
// and 0054 (two kick combos into Fundamentals) after those
const KICKS = readFileSync(join(ROOT, 'drizzle/0054_kick_combos_fundamentals.sql'), 'utf8')
const kickLines = KICKS.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('--'))
for (const f of files.filter(n => !['0051_drop_overhand.sql', '0052_close_combos_by_tier.sql', '0054_kick_combos_fundamentals.sql'].includes(n))) db.exec(readFileSync(join(ROOT, 'drizzle', f), 'utf8').replace(/--> statement-breakpoint/g, '').replace(/INSERT INTO `__new_\w+`[^;]*;/g, ''))
db.exec(seed.split(/\r?\n/).filter(l => !trimLines.includes(l) && !levelLines.includes(l) && !kickLines.includes(l)).join('\n'))
// his own progress on a combo the pass renames
db.prepare('UPDATE combos SET mastery_score = 7, is_favourite = 1, unlocked = 1 WHERE id = ?').run('combo-fl01')
const count = () => ['combos', 'techniques'].map(t => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n)
const before = count()
db.exec(MIGRATION)
assert.deepEqual(count(), before, 'applying it again adds or removes nothing')
assert.deepEqual(before, [72, 27], '55 - 2 + 19 combos, 23 - 2 + 6 techniques')

type Combo = { id: string; text: string; tier: string; unlocked: number; techniques: string; cue: string | null; mastery_score: number; is_favourite: number }
const combos = db.prepare('SELECT * FROM combos').all() as Combo[]
const byId = new Map(combos.map(c => [c.id, c]))
const techniques = db.prepare('SELECT * FROM techniques').all() as LibraryTechnique[]
const tech = (id: string) => techniques.find(t => t.id === id)

// his progress stays
const fl01 = byId.get('combo-fl01')!
assert.equal(fl01.text, 'Cross → Hook → Cross → Switch Kick')
assert.deepEqual([fl01.mastery_score, fl01.is_favourite, fl01.unlocked], [7, 1, 1], 'mastery, favourite and unlock untouched')

// dropped
assert.ok(!byId.has('combo-w17') && !byId.has('combo-m09'), 'Axe Kick and Spinning Back Kick are gone')
assert.ok(!tech('tech-axe-kick') && !tech('tech-spinning-back-kick'))

// the naming rule: one name per kick, teeps name the leg, Left Kick only where the feet do not swap
const strikes = (c: Combo) => c.text.split(' → ').map(s => s.trim())
for (const c of combos) {
  for (const s of strikes(c)) {
    assert.ok(!['Rear Roundhouse', 'Right Kick', 'Rear Kick', 'Left Body Kick', 'Left Leg Kick', 'Right Leg Kick', 'Heavy Rear Low Kick', 'Teep', 'Feint Teep', 'Feint'].includes(s), `${c.id}: "${s}" is an old name`)
  }
}
assert.deepEqual(combos.filter(c => strikes(c).includes('Left Kick')).map(c => c.id).sort(), ['combo-m12', 'combo-w12'], 'Left Kick: after the overhand and the step-back hook')
assert.ok(strikes(byId.get('combo-d01')!).includes('Switch Kick'), 'after a cross, the switch kick')
assert.deepEqual(strikes(byId.get('combo-d03')!).slice(-2), ['Hook', 'Body Kick'], 'after a hook, the right kick')
for (const c of combos) if (strikes(c).includes('Head Kick')) assert.equal(c.tier, 'mastery', `${c.id}: head kicks only in Mastery`)

// every strike names a technique page (footwork excepted), and Step In is no longer a knee
const FOOTWORK = new Set(['Step In'])
for (const c of combos) for (const s of strikes(c)) {
  if (FOOTWORK.has(s)) continue
  assert.ok(techniqueFor(s, techniques), `${c.id}: "${s}" has no technique`)
}
assert.notEqual(techniqueFor('Step In', techniques)?.id, 'tech-step-knee', 'Step In is not a step knee')
assert.equal(techniqueFor('Left Kick', techniques)?.id, 'tech-left-kick')
assert.equal(techniqueFor('Switch Kick', techniques)?.id, 'tech-switch-kick')
assert.equal(techniqueFor('Teep', techniques)?.id, 'tech-teep', 'a typed "Teep" still finds the lead teep')
assert.equal(tech('tech-roundhouse')!.name, 'Body Kick')
assert.equal(tech('tech-teep')!.name, 'Lead Teep')

// Settings' switches: a combo lists every group its strikes need, so knees and elbows stay behind theirs
for (const c of combos) {
  const groups = new Set(c.techniques.split(','))
  for (const s of strikes(c)) {
    const k = categoryOf(s)
    if (k === 'knees' || k === 'elbows' || k === 'kicks') assert.ok(groups.has(k) || (k === 'kicks' && /teep/i.test(s)), `${c.id}: "${s}" needs ${k} in "${c.techniques}"`)
  }
}

// the new combos: knees and elbows open (their switch gates them), the rest wait for the coach
const added = ['w19', 'w20', 'w21', 'w22', 'w23', 'w24', 'w25', 'fl09', 'fl10', 'fl11', 'fl12', 'fl13', 'fl14', 'fl15', 'd11', 'd12', 'm10', 'm11', 'm12'].map(s => byId.get(`combo-${s}`)!)
assert.equal(added.filter(Boolean).length, 19)
for (const c of added) {
  const close = /knees|elbows/.test(c.techniques)
  assert.equal(c.unlocked, close ? 1 : 0, `${c.id}: ${close ? 'open behind its switch' : 'locked until the coach offers it'}`)
  assert.ok(c.cue && c.cue.split(' ').length <= 4 && c.cue.length <= 20, `${c.id}: cue fits the flap`)
}

// ── 0051: no overhands (Josh, 2026-10-25) ──
for (const l of trimLines) assert.ok(seed.includes(l), `seed.sql has: ${l.slice(0, 80)}`)
db.exec(TRIM)
db.exec(TRIM)
const after = db.prepare('SELECT * FROM combos').all() as Combo[]
const techAfter = db.prepare('SELECT * FROM techniques').all() as LibraryTechnique[]
assert.deepEqual([after.length, techAfter.length], [70, 26], 'two combos and the Overhand page gone, twice applied')
assert.ok(after.every(c => !/overhand/i.test(c.text)), 'no combo throws an overhand')
assert.ok(!techAfter.some(t => t.id === 'tech-overhand'))
assert.deepEqual(after.filter(c => strikes(c).includes('Left Kick')).map(c => c.id), ['combo-m12'], 'Left Kick: after the step-back hook')
for (const c of after) for (const s of strikes(c)) if (!FOOTWORK.has(s)) assert.ok(techniqueFor(s, techAfter), `${c.id}: "${s}" has no technique`)

// ── 0052: only his level open; knees and elbows by tier, beginner ones in Fundamentals (Josh, 2026-10-25) ──
for (const l of levelLines) assert.ok(seed.includes(l), `seed.sql has: ${l.slice(0, 80)}`)
db.exec(LEVELS)
db.exec(LEVELS)
const lv = db.prepare('SELECT * FROM combos').all() as Combo[]
assert.equal(lv.length, 74, 'four beginner combos, applied twice')
const close = (c: Combo) => /knees|elbows/.test(c.techniques)
// a tier is open when the coach opened one of its other combos (here Flow, from fl01 above)
const openTiers = new Set(lv.filter(c => c.unlocked === 1 && !close(c)).map(c => c.tier))
assert.deepEqual([...openTiers].sort(), ['flow', 'foundation'])
for (const c of lv) {
  if (c.tier === 'foundation') assert.equal(c.unlocked, 1, `${c.id}: Fundamentals stay open`)
  else if (close(c)) assert.equal(c.unlocked, openTiers.has(c.tier) ? 1 : 0, `${c.id}: a ${c.tier} knee or elbow combo opens with its tier`)
}
assert.equal(lv.find(c => c.id === 'combo-m07')!.unlocked, 0, 'the Mastery elbow combo is shut')
assert.deepEqual(lv.filter(c => c.tier === 'foundation' && close(c)).map(c => c.text).sort(), ['Jab → Rear Elbow', 'Jab → Rear Knee', 'Rear Elbow', 'Rear Knee'])
assert.deepEqual([lv.find(c => c.id === 'combo-fl01')!.mastery_score, lv.find(c => c.id === 'combo-fl01')!.unlocked], [7, 1], 'his own unlock and mastery are kept')
for (const c of lv) for (const s of strikes(c)) if (!FOOTWORK.has(s)) assert.ok(techniqueFor(s, techAfter), `${c.id}: "${s}" has no technique`)

// ── 0054: Jab → Body Kick and Hook → Low Kick into Fundamentals (2026-10-26) ──
for (const l of kickLines) {
  assert.match(l, /^UPDATE combos SET .+ WHERE id = 'combo-w(01|13)';$/, `by id only: ${l.slice(0, 80)}`)
  assert.ok(seed.includes(l), `seed.sql has: ${l.slice(0, 80)}`)
}
assert.doesNotMatch(KICKS, /\b(DROP|ALTER|INSERT|DELETE)\b/, 'content only')
db.prepare('UPDATE combos SET mastery_score = 4, is_favourite = 1, unlocked = 0 WHERE id = ?').run('combo-w13')
db.exec(KICKS)
db.exec(KICKS)
const k = new Map((db.prepare('SELECT * FROM combos').all() as Array<Combo & { level: string; coach_hint: string | null }>).map(c => [c.id, c]))
assert.equal(k.size, 74, 'nothing added or removed')
for (const id of ['combo-w01', 'combo-w13']) {
  const c = k.get(id)!
  assert.deepEqual([c.tier, c.level, c.unlocked], ['foundation', 'foundation', 1], `${id}: in Fundamentals, open`)
  assert.equal(c.coach_hint, 'Open. In your Fundamentals rounds; rate it after each round to build mastery.')
}
assert.deepEqual([k.get('combo-w01')!.text, k.get('combo-w13')!.text], ['Jab → Body Kick', 'Hook → Low Kick'])
assert.deepEqual([k.get('combo-w13')!.mastery_score, k.get('combo-w13')!.is_favourite], [4, 1], 'his mastery and favourite are kept')
assert.ok(/kicks/.test(k.get('combo-w01')!.techniques) && /kicks/.test(k.get('combo-w13')!.techniques), 'still behind the KICKS switch')

console.log('libraryKru (0050, 0051, 0052, 0054) tests passed')
