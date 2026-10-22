// Run: tsx src/lib/brain/picks.test.ts
// The coach picks on REPLACE and + add (page 73): the new brain's readiness,
// the week's limits and spacing, the week so far, his eases and his skips for
// time, the knee flag and the weather at the hour.
import assert from 'node:assert/strict'
import { MAX_PICKS, rankPicks, type PicksIn, type PickOption } from './picks'
import type { OutlineSession } from './outline'

const MON = 20822 // Monday 2027-01-04
const THU = MON + 3

const OPTIONS: PickOption[] = [
  { key: 'skip_rope', type: 'skip_rope', label: 'Skip Rope' },
  { key: 'bag_work', type: 'bag_work', label: 'Bag Work' },
  { key: 'mt_class', type: 'mt_class', label: 'MT Class' },
  { key: 'strength', type: 'strength', label: 'Strength' },
  { key: 'foundation_run', type: 'foundation_run', label: 'Run-Walk' },
  { key: 'running:progression', type: 'running', label: 'Zone 2 Run', runCategory: 'progression' },
  { key: 'mobility', type: 'mobility', label: 'Foundation' },
  { key: 'active_recovery', type: 'active_recovery', label: 'Reset' },
]
const MIN: Record<string, number> = { skip_rope: 20, bag_work: 16, mt_class: 60, strength: 45, foundation_run: 25, 'running:progression': 30, mobility: 12, active_recovery: 25 }

const s = (id: string, type: string, day: number, slot: 'am' | 'pm' = 'pm', over: Partial<OutlineSession> = {}): OutlineSession => ({ id, type, label: null, day, slot, status: 'planned', source: 'template', locked: false, ...over })

function base(over: Partial<PicksIn> = {}): PicksIn {
  const week = [
    s('fd', 'mobility', THU, 'am'), s('run', 'foundation_run', THU, 'pm'),
    s('str1', 'strength', MON, 'am', { label: 'Strength A', status: 'completed' }), s('str2', 'strength', MON + 5, 'am', { label: 'Strength B' }),
    s('cls', 'mt_class', MON + 4, 'pm'),
  ]
  return {
    mode: 'replace', day: THU, today: THU, slot: 'pm',
    replacing: { id: 'run', type: 'foundation_run', label: 'Run-Walk', notes: null },
    week, monday: MON, blockType: 'block_zero', state: 'GREEN', stateWhy: null,
    ownEases: [], scheduleSkips: [], trainedDays: new Set([MON]),
    options: OPTIONS.filter(o => o.type !== 'foundation_run'), minutes: MIN, weather: null, kneeFlag: false,
    ...over,
  }
}

// ─── Picks: 1 to 3, each with one short reason, the rest in the list's order ──
{
  const out = rankPicks(base())
  assert.ok(out.picks.length >= 1 && out.picks.length <= MAX_PICKS, `1-3 picks (${out.picks.length})`)
  for (const p of out.picks) assert.ok(p.reason.length > 0 && p.reason.length <= 60, `a short reason: "${p.reason}"`)
  assert.equal(out.picks.length + out.rest.length, base().options.length, 'every option is on the list once')
  const restKeys = out.rest.map(r => r.key)
  assert.deepEqual(restKeys, base().options.map(o => o.key).filter(k => restKeys.includes(k)), 'everything else keeps the list order')
}

// ─── Readiness: a RED morning leads with the easy ones and says why ──
{
  const out = rankPicks(base({ state: 'RED', stateWhy: 'Slept 4 h.' }))
  assert.ok(['mobility', 'active_recovery'].includes(out.picks[0].key), `RED: easy first (${out.picks[0].key})`)
  assert.equal(out.picks[0].reason, 'Slept 4 h: go gentle.')
  assert.ok(!out.picks.some(p => p.key === 'mt_class' || p.key === 'strength'), 'no hard pick on a RED day')
}

// ─── The week's limits: a pick never breaks one (heavy legs before Friday's class) ──
{
  const out = rankPicks(base())
  assert.ok(!out.picks.some(p => p.key === 'strength'), 'no strength the evening before a class day with legs (or a second key session)')
  assert.ok(out.rest.find(r => r.key === 'strength')?.breaks, 'it is still on the list, marked as breaking a limit')
}

// ─── Weather at the hour: rain at 6 brings the indoor work up ──
{
  const out = rankPicks(base({ weather: { kind: 'rain', hour: '6 PM' } }))
  const bag = out.picks.find(p => p.key === 'bag_work' || p.key === 'skip_rope')
  assert.ok(bag, `an indoor pick on a rainy evening: ${out.picks.map(p => p.key).join(', ')}`)
  assert.match(bag!.reason, /^Rain at 6 PM: /)
  assert.ok(!out.picks.some(p => p.key === 'running:progression'), 'no outdoor run in the rain')
}

// ─── The knee: no rope ──
{
  const out = rankPicks(base({ kneeFlag: true, weather: { kind: 'rain', hour: '6 PM' } }))
  assert.ok(!out.picks.some(p => p.key === 'skip_rope'), 'no rope with a knee flag')
}

// ─── His skips for time: something short ──
{
  const out = rankPicks(base({ scheduleSkips: [{ day: THU - 2, type: 'strength' }] }))
  assert.ok(out.picks.some(p => /^Short: \d+ min\.$/.test(p.reason)), `a short pick says so: ${out.picks.map(p => p.reason).join(' | ')}`)
}

// ─── Days in a row: an easy one after three ──
{
  const out = rankPicks(base({ trainedDays: new Set([THU - 1, THU - 2, THU - 3]) }))
  assert.ok(out.picks.some(p => /^Three training days in a row: an easy one\.$/.test(p.reason)), out.picks.map(p => p.reason).join(' | '))
}

// ─── + add: Foundation-like easy picks lead; a second key session never does ──
{
  const out = rankPicks(base({ mode: 'add', replacing: null, options: OPTIONS }))
  assert.ok(!out.picks.some(p => p.key === 'bag_work' || p.key === 'strength'), `no second key session on an add: ${out.picks.map(p => p.key).join(', ')}`)
  assert.ok(out.picks.length >= 1)
}

console.log('picks: ok')
