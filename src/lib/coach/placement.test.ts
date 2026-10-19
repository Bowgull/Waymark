// Run: tsx src/lib/coach/placement.test.ts
// Every placement rule, and that every safe alternative offered passes them all.
import { checkSessionChange, easierOptions, touchesRegion, type PlacementContext, type PlacementResult, type SessionChange } from './placement'
import { MON, assert, ctx, s } from './testUtil'

const add = (type: string, epochDay: number, extra: Partial<SessionChange> = {}): SessionChange => ({ kind: 'add', type, epochDay, timeSlot: 'am', ...extra })

function refused(r: PlacementResult, code: string): r is Extract<PlacementResult, { ok: false }> {
  return !r.ok && r.code === code
}

/** Every alternative must itself pass the rules. */
function alternativesSafe(r: PlacementResult, change: SessionChange, c: PlacementContext): boolean {
  if (r.ok) return true
  return r.safeAlternatives.every(a => {
    const next: SessionChange = a.kind === 'day'
      ? { ...change, epochDay: a.epochDay, timeSlot: a.timeSlot }
      : { ...change, kind: change.kind === 'move' ? 'replace' : change.kind, type: a.type, label: a.label, notes: a.notes ?? null, estimatedMin: null, epochDay: a.epochDay, timeSlot: a.timeSlot }
    return checkSessionChange(next, c, { alternatives: false }).ok
  })
}

function expectRefusal(name: string, change: SessionChange, c: PlacementContext, code: string): Extract<PlacementResult, { ok: false }> {
  const r = checkSessionChange(change, c)
  assert(refused(r, code), `${name}: refused with ${code}${r.ok ? ' (was ok)' : ` (got ${r.code})`}`)
  assert(!/[!—–]/.test((r as { reason: string }).reason), `${name}: reason in the house voice`)
  assert(alternativesSafe(r, change, c), `${name}: every safe alternative passes the rules`)
  return r as Extract<PlacementResult, { ok: false }>
}

// ─── Basic validation ────────────────────────────────────────

expectRefusal('unknown type', add('yoga_rave', MON), ctx(), 'unknown_type')
const past = expectRefusal('past day', add('skip_rope', MON - 1), ctx(), 'past_day')
assert(past.safeAlternatives.some(a => a.kind === 'day' && a.epochDay >= MON), 'past day: offers days from today on')
expectRefusal('move to another week', { kind: 'move', type: 'skip_rope', epochDay: MON + 8, timeSlot: 'am', sessionId: 'x', fromEpochDay: MON + 1 }, ctx(), 'other_week')

// ─── Flags ───────────────────────────────────────────────────

const knee = expectRefusal('knee flag blocks a run', add('running', MON + 2, { notes: 'zone2' }), ctx({ injury: { region: 'knee', reason: 'Knee flagged on Mon.' } }), 'injury_flag')
assert(knee.safeAlternatives.some(a => a.kind === 'swap' && a.type === 'active_recovery'), 'knee flag: offers an easy walk or bike')
assert(touchesRegion('running', 'knee') && !touchesRegion('running', 'shoulder') && touchesRegion('strength', 'shoulder') && !touchesRegion('mobility', 'back'), 'region mapping')

const bz = (over: Partial<PlacementContext> = {}) => ctx({ blockType: 'block_zero', weekNumber: 3, ...over })
expectRefusal('Block Zero Sunday', add('strength', MON + 6, { label: 'Strength A' }), bz(), 'rest_day')

const easeCtx = ctx({ readinessEase: true, easeReason: 'Check-ins are off trend for 2 days.' })
const ease = expectRefusal('ease day', add('strength', MON), easeCtx, 'ease_day')
assert(ease.safeAlternatives.some(a => a.kind === 'day' && a.epochDay > MON), 'ease day: offers a later day this week')
assert(ease.safeAlternatives.some(a => a.kind === 'swap' && a.type === 'active_recovery'), 'ease day: offers the easy swap')
expectRefusal('coach-eased day', add('bag_work', MON + 2), ctx({ easeDays: [MON + 2] }), 'ease_day')
expectRefusal('load flag', add('mt_class', MON + 3, { timeSlot: 'pm', label: 'MT Class' }), ctx({ loadFlag: true }), 'load_flag')

// ─── Stacking and interference ───────────────────────────────

const mtMon = s('mt_class', MON, { timeSlot: 'pm', label: 'MT Class' })
const stacked = expectRefusal('two hard sessions on a day', add('bag_work', MON), ctx({ sessions: [mtMon] }), 'stacked_hard')
assert(stacked.safeAlternatives.some(a => a.kind === 'day' && a.epochDay !== MON), 'stacked: offers another day')
assert(checkSessionChange(add('mobility', MON), ctx({ sessions: [mtMon] })).ok, 'back care next to a class is fine')

expectRefusal('heavy legs 14 h after a class', add('strength', MON + 1), ctx({ sessions: [mtMon] }), 'legs_24h')
const longRun = s('running', MON + 5, { notes: 'progression' })
expectRefusal('heavy legs the evening before a long run', add('strength', MON + 4, { timeSlot: 'pm' }), ctx({ sessions: [longRun] }), 'legs_24h')
expectRefusal('a class within 24 h of heavy legs', add('mt_class', MON + 1, { timeSlot: 'am', label: 'MT Class' }), ctx({ sessions: [s('strength', MON + 1 - 1, { timeSlot: 'pm' })] }), 'legs_24h')
assert(checkSessionChange(add('strength', MON + 2), ctx({ sessions: [mtMon] })).ok, 'heavy legs 38 h after a class: ok')
assert(checkSessionChange(add('mt_class', MON + 1, { timeSlot: 'pm', label: 'MT Technique' }), ctx({ sessions: [s('strength', MON + 1, { timeSlot: 'am' })] })).ok, 'a technique class is not hard interval work')

expectRefusal('Block Zero strength back to back', add('strength', MON + 1, { label: 'Strength C' }), bz({ sessions: [s('strength', MON, { label: 'Strength A' })] }), 'strength_back_to_back')
expectRefusal('Block Zero strength after a morning run', add('strength', MON + 1, { label: 'Strength C', timeSlot: 'pm' }), bz({ sessions: [s('foundation_run', MON + 1)] }), 'strength_order')
const runAfter = checkSessionChange(add('foundation_run', MON + 2), bz({ sessions: [s('strength', MON + 2, { label: 'Strength B' })] }))
assert(runAfter.ok && runAfter.change.timeSlot === 'pm', 'Block Zero: a run next to strength moves after it')

// ─── Runs (F11) ──────────────────────────────────────────────

expectRefusal('one run a day', add('running', MON + 1, { notes: 'zone2' }), ctx({ sessions: [s('foundation_run', MON + 1)] }), 'run_same_day')
expectRefusal('single run cap', add('running', MON + 1, { notes: 'zone2' }), ctx({ run: { longestLast30Sec: 8 * 60, lastWeekRunSec: 60 * 60, thisWeekRunSec: 0 } }), 'run_single_cap')
const shortened = checkSessionChange(add('running', MON + 1, { notes: 'zone2' }), ctx({ run: { longestLast30Sec: 15 * 60, lastWeekRunSec: 120 * 60, thisWeekRunSec: 0 } }))
assert(shortened.ok && shortened.change.estimatedMin === 16 && shortened.notes.length === 1, 'a run over the 110% cap is shortened when there is room')
expectRefusal('weekly run cap', add('running', MON + 5, { notes: 'zone2' }), ctx({
  run: { longestLast30Sec: 40 * 60, lastWeekRunSec: 35 * 60, thisWeekRunSec: 45 * 60 },
  sessions: [s('foundation_run', MON + 1), s('foundation_run', MON + 3)],
}), 'run_weekly_cap')
// D2: a short last week (one 23-min run) floors the allowance at week-1 volume, so week 1's runs fit.
const floored = checkSessionChange(add('foundation_run', MON + 5), bz({ weekNumber: 1, run: { longestLast30Sec: 23 * 60, lastWeekRunSec: 23 * 60, thisWeekRunSec: 0 }, sessions: [s('foundation_run', MON + 1), s('foundation_run', MON + 3)] }))
assert(floored.ok && floored.change.estimatedMin == null, 'run cap floor: after a lead-in run, week 1 keeps its third full run-walk')

// ─── Muay thai ramp and cap ──────────────────────────────────

expectRefusal('sparring in the first weeks back', add('mt_class', MON + 1, { timeSlot: 'pm', label: 'MT Sparring' }), ctx({ mt: { weeksSinceRampStart: null, profileCap: null } }), 'mt_ramp')
expectRefusal('Block Zero class cap', add('mt_class', MON + 3, { timeSlot: 'pm', label: 'MT Technique' }), bz({ mt: { weeksSinceRampStart: 0, profileCap: null }, sessions: [s('mt_class', MON, { timeSlot: 'pm', label: 'MT Technique' }), s('mt_class', MON + 1, { timeSlot: 'pm', label: 'MT Technique' })] }), 'mt_cap')
expectRefusal('Fighter class cap', add('mt_class', MON + 4, { timeSlot: 'pm', label: 'MT Class' }), ctx({ mt: { weeksSinceRampStart: 8, profileCap: 2 }, sessions: [s('mt_class', MON, { timeSlot: 'pm' }), s('mt_class', MON + 2, { timeSlot: 'pm' })] }), 'mt_cap')
assert(checkSessionChange(add('mt_class', MON + 4, { timeSlot: 'pm', label: 'MT Sparring' }), ctx({ mt: { weeksSinceRampStart: 8, profileCap: null } })).ok, 'Fighter past the ramp: the class is allowed (sparring criteria are E2)')

// ─── No cramming (F14) ───────────────────────────────────────

const full = ctx({ planWeekLoad: 1200, sessions: [s('strength', MON + 1), s('mt_class', MON + 2, { timeSlot: 'pm' })] })
expectRefusal('over the planned week load', add('bag_work', MON + 4), full, 'over_plan')
assert(checkSessionChange({ kind: 'move', type: 'strength', epochDay: MON + 4, timeSlot: 'am', sessionId: full.sessions[0].id, fromEpochDay: MON + 1 }, full).ok, 'a move inside the week adds no load')
const missedRoom = ctx({ planWeekLoad: 1200, sessions: [s('strength', MON + 1, { status: 'missed' }), s('mt_class', MON + 2, { timeSlot: 'pm' })] })
assert(checkSessionChange(add('strength', MON + 4), missedRoom).ok, 'a missed session frees its load: putting it back fits the plan')
assert(checkSessionChange(add('mobility', MON + 4), full).ok, 'back care never counts against the plan')
assert(checkSessionChange(add('mt_class', MON + 2, { timeSlot: 'pm', label: 'MT Technique' }), bz({ planWeekLoad: 10, mt: { weeksSinceRampStart: 0, profileCap: null } })).ok, 'Block Zero classes are governed by the ramp, not the template load')

// ─── Replace takes the original out ─────────────────────────

const orig = s('strength', MON + 1)
assert(checkSessionChange({ kind: 'replace', type: 'bag_work', epochDay: MON + 1, timeSlot: 'am', sessionId: orig.id }, ctx({ sessions: [orig] })).ok, 'replace: the replaced session does not stack with its replacement')

// Earlier bug 22: with a knee (ankle, shin) flag, rope is not the easier option for bag work.
assert(easierOptions({ type: 'bag_work', label: null, notes: null }, 'block_zero', { region: 'knee', since: MON, reason: 'Knee flagged on Monday.' }).every(o => o.type !== 'skip_rope'), 'bug 22: knee flag, no rope offered')
assert(easierOptions({ type: 'bag_work', label: null, notes: null }, 'block_zero', null).some(o => o.type === 'skip_rope'), 'no flag: easy rope still offered')

console.log('coach placement tests passed')
