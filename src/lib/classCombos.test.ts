// Run: tsx src/lib/classCombos.test.ts
import assert from 'node:assert/strict'

import {
  categoriesFor,
  classifyFound,
  comboLine,
  comboTextFor,
  deriveTechniques,
  lookupTechnique,
  guardAiExtraction,
  matchKey,
  mergeExtractions,
  parseCombos,
  tierFor,
  unknownLine,
  applyFix,
  comboLevel,
  gradeLevel,
  leaveOut,
  levelOfTier,
  nudgeLevel,
  readStrikes,
  readTypedCombo,
  LEVELS,
  type BagCombo,
} from './classCombos'

// A slice of the real library (src/db/seed.ts and the combo migrations).
const LIBRARY: BagCombo[] = [
  { id: 'combo-f01', text: 'Jab → Cross', tier: 'foundation', unlocked: 1 },
  { id: 'combo-f02', text: 'Jab → Cross → Hook', tier: 'foundation', unlocked: 1 },
  { id: 'combo-f03', text: 'Double Jab → Cross', tier: 'foundation', unlocked: 1 },
  { id: 'combo-f06', text: 'Lead Hook → Cross', tier: 'foundation', unlocked: 1 },
  { id: 'combo-f08', text: 'Jab × 3', tier: 'foundation', unlocked: 1 },
  { id: 'combo-w03', text: 'Jab → Cross → Low Kick', tier: 'weapons', unlocked: 0 },
  { id: 'combo-w05', text: 'Jab → Jab → Teep', tier: 'weapons', unlocked: 0 },
  { id: 'combo-w10', text: 'Jab → Cross → Rear Knee', tier: 'weapons', unlocked: 1 },
  { id: 'combo-fl02', text: 'Double Jab → Cross → Right Kick', tier: 'flow', unlocked: 0 },
  { id: 'combo-m07', text: 'Jab → Cross → Hook → Lead Elbow → Rear Knee → Reset', tier: 'mastery', unlocked: 1 },
]
const TECH = deriveTechniques(LIBRARY.map(c => c.text))
const ALL_ON = new Set(['boxing', 'kicks', 'defensive', 'knees', 'elbows'])
const DEFAULT_ON = new Set(['boxing', 'kicks', 'defensive'])

// ─── the technique list comes from the combos ──
{
  const keys = TECH.map(t => t.key)
  for (const k of ['jab', 'cross', 'hook', 'double jab', 'lead hook', 'low kick', 'teep', 'rear knee', 'right kick', 'lead elbow', 'reset']) assert.ok(keys.includes(k), `knows ${k}`)
  assert.ok(!keys.some(k => k.includes('×')), '"Jab × 3" counts as Jab')
  assert.equal(TECH.find(t => t.key === 'lead hook')?.name, 'Lead hook', 'named as a found line prints it')
  assert.equal(TECH.find(t => t.key === 'rear knee')?.category, 'knees')
  assert.equal(TECH.find(t => t.key === 'teep')?.category, 'defensive')
  assert.equal(TECH.find(t => t.key === 'low kick')?.category, 'kicks')
  assert.equal(TECH.find(t => t.key === 'lead elbow')?.category, 'elbows')
}

// ─── page 49's note, with no AI ──
const NOTE = 'Teeps to the body to start. Then jab, cross, lead hook on the pads. Coach had us double jab, cross, low kick. Last drill: jab, jab, teep. Partner work catching the kick.'
{
  const x = parseCombos(NOTE, TECH, DEFAULT_ON)
  assert.deepEqual(x.combos.map(c => comboLine(c.strikes)), ['Jab, Cross, Lead hook', 'Double jab, Cross, Low kick', 'Jab, Jab, Teep'])
  assert.deepEqual(x.unknown, [], 'prose about a kick is not a strike name')
  // against the bag: IN YOUR BAG (as the library names it), NEW, LOCKED
  const lines = classifyFound(x.combos, LIBRARY)
  assert.deepEqual(lines.map(l => l.status), ['in_bag', 'new', 'locked'])
  assert.equal(lines[0].sub, 'as Jab › Cross › Hook')
  assert.equal(lines[1].sub, 'Not in the library')
  assert.equal(lines[2].sub, 'In Weapons, locked')
  assert.equal(lines[2].comboId, 'combo-w05')
  // NOT NOW is remembered: not offered again
  const again = classifyFound(x.combos, LIBRARY, new Set([matchKey(['Double jab', 'Cross', 'Low kick'])]))
  assert.deepEqual(again.map(l => l.status), ['in_bag', 'locked'])
}

// ─── typed lines ──
{
  assert.deepEqual(parseCombos('Combo: Jab, Cross, Lead hook', TECH, DEFAULT_ON).combos, [{ strikes: ['Jab', 'Cross', 'Lead hook'] }])
  assert.deepEqual(parseCombos('jab → cross → low kick', TECH, DEFAULT_ON).combos, [{ strikes: ['Jab', 'Cross', 'Low kick'] }])
  assert.deepEqual(parseCombos('Jab, Cross, Lead hook\nJab, Cross, Lead hook', TECH, DEFAULT_ON).combos.length, 1, 'one line per combo')
  assert.deepEqual(parseCombos('Teeps to the body. Lots of jabs.', TECH, DEFAULT_ON).combos, [], 'a single strike is not a combo')
  assert.deepEqual(parseCombos('Felt good, tired after', TECH, DEFAULT_ON), { combos: [], unknown: [], off: [] }, 'plain prose finds nothing')
  assert.deepEqual(parseCombos('Jab and cross were sharp, kicks slow', TECH, DEFAULT_ON).unknown, [], 'prose about strikes names nothing')
}

// ─── strikes the app doesn't know: named once, left out ──
{
  const x = parseCombos('Superman punch, spinning elbow. Superman punch, cross.', TECH, ALL_ON)
  assert.deepEqual(x.combos, [])
  assert.deepEqual(x.unknown, ['Superman punch', 'Spinning elbow'], 'each named once')
  assert.equal(unknownLine(x.unknown), 'Superman punch, spinning elbow.')
}

// ─── a technique switched off in Settings ──
{
  const x = parseCombos('Jab, cross, rear knee', TECH, DEFAULT_ON)
  assert.deepEqual(x.combos, [], 'knees off: left out')
  assert.deepEqual(x.off, ['Rear knee'])
  assert.deepEqual(parseCombos('Jab, cross, rear knee', TECH, ALL_ON).combos, [{ strikes: ['Jab', 'Cross', 'Rear knee'] }])
}

// ─── the AI's answer held to known, switched-on techniques ──
{
  const ai = guardAiExtraction({
    combos: [
      { strikes: ['Jab', 'Cross', 'Lead hook'] },
      { strikes: ['Double jab', 'Cross', 'Low kick'] },
      { strikes: ['Jab', 'Superman punch'] },
      { strikes: ['Jab', 'Cross', 'Rear knee'] },
      { strikes: ['Hook', 'Uppercut'] },
      { strikes: ['Jab'] },
      { strikes: 'nope' },
    ],
    unknownStrikes: ['catching the kick', 'flying knee', 7],
  }, NOTE + ' Jab, superman punch. Jab, cross, rear knee.', TECH, DEFAULT_ON)
  assert.ok(ai)
  assert.deepEqual(ai.combos.map(c => c.strikes.join('|')), ['Jab|Cross|Lead hook', 'Double jab|Cross|Low kick'])
  assert.deepEqual(ai.unknown, ['Superman punch', 'Catching the kick'], 'a name the note never mentions is dropped (uppercut, flying knee)')
  assert.deepEqual(ai.off, ['Rear knee'])
  assert.equal(guardAiExtraction(null, NOTE, TECH, DEFAULT_ON), null, 'offline: the parser alone')
  const merged = mergeExtractions(parseCombos(NOTE, TECH, DEFAULT_ON), ai, TECH)
  assert.equal(merged.combos.length, 3, 'the same combo found twice is one line')
  assert.deepEqual(merged.unknown, ['Superman punch', 'Catching the kick'])
}

// ─── a new class combo in the library ──
{
  assert.equal(comboTextFor(['Double jab', 'Cross', 'Low kick']), 'Double Jab → Cross → Low Kick')
  assert.equal(categoriesFor(['Double jab', 'Cross', 'Low kick']), 'boxing,kicks')
  assert.equal(tierFor(['Double jab', 'Cross', 'Low kick']), 'weapons')
  assert.equal(tierFor(['Jab', 'Cross', 'Hook']), 'foundation')
  assert.equal(tierFor(['Double jab', 'Cross', 'Hook', 'Cross']), 'flow', 'five strikes or more')
  assert.equal(matchKey(['Lead hook', 'Cross']), matchKey(['Hook', 'Cross']), 'the lead hook is the hook')
  assert.equal(matchKey(['Jab × 3']), matchKey(['Jab', 'Jab', 'Jab']))
}

// the library names kicks and teeps by leg (0050): what he writes in class still means them
{
  const LIB = deriveTechniques(['Jab → Jab → Lead Teep', 'Jab → Body Kick', 'Jab → Cross → Low Kick', 'Inside Low Kick → Cross → Hook → Low Kick'])
  for (const typed of ['teep', 'right kick', 'roundhouse', 'rear roundhouse', 'rear kick', 'right low kick', 'left leg kick']) {
    assert.ok(lookupTechnique(typed, LIB), `"${typed}" is a strike the library knows`)
  }
  assert.equal(matchKey(['Jab', 'Jab', 'Teep']), matchKey(['Jab', 'Jab', 'Lead Teep']), 'a teep is the lead teep')
  assert.equal(matchKey(['Jab', 'Right kick']), matchKey(['Jab', 'Body Kick']), 'the right kick is the body kick')
  assert.equal(lookupTechnique('overhand', LIB), null, 'no overhands (0051)')
}

// ─── tiers: feints and defensive moves (page 80 grades by these) ──
{
  assert.equal(tierFor(['Feint jab', 'Cross', 'Left kick', 'Step out']), 'deception', 'a feint: Deception (combo-d01)')
  assert.equal(tierFor(['Slip', 'Cross', 'Hook', 'Low kick']), 'deception', 'a slip: Deception (combo-d07)')
  assert.equal(tierFor(['Jab', 'Cross', 'Hook', 'Check', 'Teep']), 'mastery', 'five with a check: Mastery (combo-m02)')
  assert.equal(tierFor(['Jab', 'Jab', 'Teep']), 'weapons', 'a teep alone is no trick')
}

// ─── a combo typed in words (page 80) ──
{
  const LIB2 = [...LIBRARY, { id: 'combo-w02', text: 'Jab → Cross → Switch Kick', tier: 'weapons', unlocked: 0 }, { id: 'combo-x', text: 'Teep → Cross → Rear Knee', tier: 'weapons', unlocked: 0 }]
  const T2 = deriveTechniques(LIB2.map(c => c.text))
  const names = (ts: ReturnType<typeof readTypedCombo>) => ts.map(t => (t.kind === 'strike' ? t.name : `?${t.raw}`))

  // known strikes, the longest name first, little words skipped
  const ok = readTypedCombo('jab then cross and switch kick', T2, ALL_ON)
  assert.deepEqual(names(ok), ['Jab', 'Cross', 'Switch kick'])
  assert.deepEqual(readStrikes(ok), ['Jab', 'Cross', 'Switch kick'])
  assert.deepEqual(names(readTypedCombo('Double jab, cross → lead hook', T2, ALL_ON)), ['Double jab', 'Cross', 'Lead hook'])

  // a misspelt word stays in place, unknown, with its likely fix (it and the word after: "swich kick")
  const typo = readTypedCombo('jab cross swich kick', T2, ALL_ON)
  assert.deepEqual(names(typo), ['Jab', 'Cross', '?swich', '?kick'])
  assert.equal(readStrikes(typo), null, 'ADD waits while an unknown remains')
  const unk = typo[2]
  assert.ok(unk.kind === 'unknown')
  assert.equal(unk.fixes[0].name, 'Switch kick')
  assert.equal(unk.fixes[0].span, 2, 'the fix stands for "swich kick"')
  const fixed = applyFix(typo, 2, unk.fixes[0])
  assert.deepEqual(names(fixed), ['Jab', 'Cross', 'Switch kick'])
  assert.deepEqual(readStrikes(fixed), ['Jab', 'Cross', 'Switch kick'])

  // LEAVE IT OUT: the word goes
  const extra = readTypedCombo('jab cross superman', T2, ALL_ON)
  assert.deepEqual(names(extra), ['Jab', 'Cross', '?superman'])
  assert.ok(extra[2].kind === 'unknown' && extra[2].fixes.length === 0, 'nothing close: only LEAVE IT OUT')
  assert.deepEqual(readStrikes(leaveOut(extra, 2)), ['Jab', 'Cross'])

  // a side word on a strike the app knows plainly: the strike is offered
  const side = readTypedCombo('lead teep cross', T2, ALL_ON)
  assert.deepEqual(names(side), ['?lead', 'Teep', 'Cross'])
  assert.ok(side[0].kind === 'unknown' && side[0].fixes[0].name === 'Teep' && side[0].fixes[0].span === 2)
  assert.deepEqual(names(applyFix(side, 0, side[0].fixes[0])), ['Teep', 'Cross'])

  // a strike switched off in Settings is unknown with no fixes (Settings decides)
  const off = readTypedCombo('jab cross rear knee', T2, DEFAULT_ON)
  assert.ok(off[2].kind === 'unknown' && off[2].off && off[2].fixes.length === 0)
  assert.equal(readTypedCombo('', T2, ALL_ON).length, 0)
  assert.equal(readStrikes([]), null)
}

// ─── the grade in plain words, and the nudge ──
{
  assert.deepEqual([...LEVELS], ['EASY', 'MEDIUM', 'HARD', 'EXPERT'])
  assert.deepEqual(['foundation', 'weapons', 'flow', 'deception', 'mastery'].map(levelOfTier), [0, 1, 2, 2, 3])
  assert.equal(gradeLevel(['Jab', 'Cross']), 0, 'hands only: EASY')
  assert.equal(gradeLevel(['Jab', 'Cross', 'Switch kick']), 1, 'a kick: MEDIUM')
  assert.equal(gradeLevel(['Teep', 'Cross', 'Rear knee', 'Switch kick', 'Cross']), 2, 'five strikes: HARD')
  assert.equal(gradeLevel(['Jab', 'Cross', 'Hook', 'Check', 'Teep']), 3, 'Mastery: EXPERT')
  assert.equal(nudgeLevel(1, 1), 2)
  assert.equal(nudgeLevel(3, 1), 3, 'never past EXPERT')
  assert.equal(nudgeLevel(0, -1), 0, 'never below EASY')
  assert.equal(comboLevel({ tier: 'weapons' }), 1)
  assert.equal(comboLevel({ tier: 'weapons', difficultyOverride: 'expert' }), 3, 'his nudge wins')
  assert.equal(comboLevel({ tier: 'flow', difficultyOverride: 'nonsense' }), 2)
}

console.log('classCombos tests passed')
