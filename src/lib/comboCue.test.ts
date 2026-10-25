import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

import { COMBO_CUES, CUE_MAX_CHARS, CUE_MAX_WORDS, comboCue, deriveCue } from './comboCue'
import { COMBO_CUE_CONTENT } from './comboCueContent'

// ── Derivation (the fallback for a combo with no hand-picked cue) ──

assert.equal(deriveCue('Rotate the hip fully on the cross. Power comes from the ground, not the arm.'), 'ROTATE THE HIP FULLY', 'first clause, upper case')
assert.equal(deriveCue('Keep the hook tight at 90 degrees. Don\'t let the elbow flare wide.'), 'KEEP THE HOOK TIGHT', 'cut to four words')
assert.equal(deriveCue('Turn the hip, then drive.'), 'TURN THE HIP', 'stops at the comma')
assert.equal(deriveCue('Plant then kick.'), 'PLANT', 'stops at "then"')
assert.equal(deriveCue('The feint drops their guard low. Attack high off their reaction.'), 'ATTACK HIGH', 'skips a describing sentence, drops a dangling "off"')
assert.equal(deriveCue('Fagan canon. Do not overcommit the overhand.'), 'DO NOT OVERCOMMIT', 'skips the source note; never ends on a dangling word')
assert.equal(deriveCue('Drill protocol (Fagan): 50 per leg.'), '', 'a source note alone gives nothing')
assert.equal(deriveCue('Drive through with the hip.'), 'DRIVE THROUGH', 'never ends on "with" or "the"')
assert.equal(deriveCue('The second jab sets up range.'), 'THE SECOND JAB SETS', 'no imperative: the first sentence still gives a cue')
assert.equal(deriveCue('Chamber high — drop the heel.'), 'CHAMBER HIGH', 'stops at a dash')
assert.equal(deriveCue('  '), '')
assert.equal(deriveCue(null), '')
assert.equal(deriveCue(undefined), '')
assert.equal(deriveCue('Absolutely-gigantically-long-hyphenated words keep going on'), '', 'a first word too long for the flap: no cue, never a cut word')
assert.equal(deriveCue('Snap the switch fast and hard.'), 'SNAP THE SWITCH FAST')

// ── comboCue: the approved Library content (page 60) wins, then the hand-picked cue, then the tip ──

assert.equal(comboCue({ id: 'combo-f01', formTips: 'anything at all' }), 'TURN THE REAR HIP', 'page 60 content')
assert.equal(comboCue({ id: 'combo-w11', formTips: 'x' }), 'CLOSE THE GAP', "page 60's example")
assert.equal(comboCue({ id: 'combo-new', formTips: 'Snap the foot back fast.' }), 'SNAP THE FOOT BACK')
assert.equal(comboCue({ id: 'combo-new', formTips: '' }), '')
assert.equal(comboCue(null), '')

// ── Every hand-picked cue fits the flap ──

for (const [id, cue] of Object.entries(COMBO_CUES)) {
  assert.ok(cue.length > 0, `${id}: empty cue`)
  assert.equal(cue, cue.toUpperCase(), `${id}: upper case`)
  assert.ok(cue.split(' ').length <= CUE_MAX_WORDS, `${id}: at most ${CUE_MAX_WORDS} words (${cue})`)
  assert.ok(cue.length <= CUE_MAX_CHARS, `${id}: at most ${CUE_MAX_CHARS} characters (${cue})`)
}

// ── Every combo in the seed and the migrations has a hand-picked cue ──

const seedIds = [...readFileSync('src/db/seed.ts', 'utf8').matchAll(/id: '(combo-[a-z0-9]+)'/g)].map(m => m[1])
const migrationIds = readdirSync('drizzle').filter(f => f.endsWith('.sql'))
  .flatMap(f => [...readFileSync(`drizzle/${f}`, 'utf8').matchAll(/INTO combos[^;]*?VALUES\s*\(\s*'(combo-[a-z0-9]+)'/g)].map(m => m[1]))
const allIds = new Set([...seedIds, ...migrationIds])
assert.ok(allIds.size >= 55, `found every combo (${allIds.size})`)
for (const id of allIds) assert.ok(COMBO_CUES[id], `${id} has no cue in COMBO_CUES`)
for (const id of Object.keys(COMBO_CUES)) assert.ok(allIds.has(id), `${id} in COMBO_CUES is not a combo`)

// ── Every approved cue (page 60) fits the flap and names a real combo ──

for (const [id, cue] of Object.entries(COMBO_CUE_CONTENT)) {
  assert.equal(cue, cue.toUpperCase(), `${id}: upper case`)
  assert.ok(cue.split(' ').length <= CUE_MAX_WORDS && cue.length <= CUE_MAX_CHARS, `${id}: fits the flap (${cue})`)
  assert.ok(allIds.has(id), `${id} is a combo`)
}
assert.equal(Object.keys(COMBO_CUE_CONTENT).length, 74)

console.log(`comboCue: ok (${allIds.size} combos)`)
