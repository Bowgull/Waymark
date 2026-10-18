// Run: tsx src/lib/athleteState/guard.test.ts
// The athlete model decides within the rules: clamped loadFactor, no push on
// an ease day or after a gap, a one-line verdict, a 10-day expiry. Also the
// request: Sonnet 5.5 (MODELS.reasoning) with structured output, no forced tool.
import { guardAthleteState, isAthleteStateFresh, ATHLETE_STATE_TTL_SEC } from './guard'
import { athleteStateRequest, buildAthleteStatePrompt } from './runAthleteState'
import { MODELS } from '../models'
import type { AthleteContext, AthleteState } from './types'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
  console.log(`ok: ${msg}`)
}

const T = 1_700_000_000
const state: AthleteState = {
  readiness: 'fresh',
  readinessRationale: 'Sleep steady, effort low.',
  lifts: [
    { exerciseId: 'sq', exerciseName: 'Squat', verdict: 'push', loadFactor: 1.2, rationale: 'Moving well.', trendSummary: '' },
    { exerciseId: 'bp', exerciseName: 'Bench', verdict: 'deload', loadFactor: 0.5, rationale: 'Short twice.', trendSummary: '' },
  ],
  weekShape: 'push_volume',
  weekShapeRationale: 'Room to add.',
  flags: [],
  note: 'Squat moving well — bench stalls! Push the squat, hold the bench while it settles in over the next week or two of steady training and sleep.',
  computedAtEpoch: T,
  trigger: 'weekly_pass',
  modelVersion: 'athlete-state-v1',
}

const open = guardAthleteState(state, { noPush: false, easeActive: false })
assert(open.state.lifts[0].loadFactor === 1.05 && open.state.lifts[1].loadFactor === 0.85, 'loadFactor clamped to 0.85-1.05')
assert(open.state.lifts[0].verdict === 'push' && open.state.weekShape === 'push_volume', 'a normal day keeps the push (inside the clamp)')
assert(open.state.expiresAtEpoch === T + ATHLETE_STATE_TTL_SEC, 'expires 10 days after it was computed')
const v = open.state.verdict ?? ''
assert(v.length <= 140 && !v.includes('—') && !v.includes('!'), `one-line verdict in house voice: ${v}`)

const ease = guardAthleteState(state, { noPush: false, easeActive: true })
assert(ease.state.lifts[0].verdict === 'hold' && ease.state.lifts[0].loadFactor === 1, 'ease day: push becomes hold at 1.0')
assert(ease.state.weekShape === 'as_planned', 'ease day: no push_volume')
const gap = guardAthleteState(state, { noPush: true, easeActive: false })
assert(gap.state.lifts[0].verdict === 'hold' && gap.state.lifts[1].verdict === 'deload' && gap.state.lifts[1].loadFactor === 0.85, 'after a gap: no push, a deload stays')
assert(gap.clamps.length >= 2 && (gap.state.guardrails ?? []).length === gap.clamps.length, 'clamps stored with the state')

assert(isAthleteStateFresh(open.state, T + 9 * 86400), 'fresh at 9 days')
assert(!isAthleteStateFresh(open.state, T + 10 * 86400), 'stale at 10 days: never sets loads')
assert(!isAthleteStateFresh({ computedAtEpoch: T }, T + 11 * 86400), 'old rows without expiry use the 10-day rule')

const ctx: AthleteContext = { todayEpochDay: 20000, todayDow: 0, weekStart: 19994, weekEnd: 20000, lifts: [], effort: [], wellness: [], notes: [], runs: [], adherenceBlock: null, hrBlock: null, comboRatings: [], bodyweightKg: null, trainingMaxes: [], priorState: null }
const req = athleteStateRequest([], buildAthleteStatePrompt(ctx))
assert(req.model === MODELS.reasoning && req.model === 'claude-sonnet-5-5', 'model: MODELS.reasoning (Sonnet 5.5)')
assert(req.tool_choice == null && req.tools == null && req.output_config?.format?.type === 'json_schema', 'structured output, no forced tool_choice')
assert(typeof req.messages[0].content === 'string' && req.messages[0].content.includes('Reply with only the assessAthlete JSON object'), 'prompt asks for the JSON object')

console.log('athlete-state guard tests passed')
