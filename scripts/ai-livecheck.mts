// Live check for the Block Zero Phase D AI calls. NOT part of any test run:
// it spends real money. Sends the five changed Block Zero requests to the real
// API with a FAKE athlete and fake data, runs each output through the
// guardrails, and prints model, tokens, pass/fail, clamps and an approximate cost.
//
//   npx tsx scripts/ai-livecheck.mts            five live calls (about 1-2 minutes)
//   npx tsx scripts/ai-livecheck.mts --dry-run  builds every request and runs the
//                                              guardrails on stub outputs, no API call
//
// Reads ANTHROPIC_API_KEY from .dev.vars at the repo root at run time (or the
// file named in WAYMARK_DEV_VARS). Never prints the key.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { anthropicCall, getStructuredOutput, getToolInput, jsonFormatFor, type AnthropicRequest, type AnthropicResult } from '../src/lib/anthropic'
import { MODELS } from '../src/lib/models'
import { buildSystemPrompt, type UserProfileContext } from '../src/lib/prompts/system'
import {
  TOOL_BLOCK_TRANSITION,
  TOOL_REACTIVE_REPLAN,
  TOOL_REPLACE_SUGGESTIONS,
  TOOL_WEEK_PLAN,
  type BlockTransitionOutput,
  type ReactiveReplanOutput,
  type ReplaceSuggestionsOutput,
  type WeekPlanOutput,
} from '../src/lib/prompts/tools'
import { BLOCK_ZERO_TOOL, buildAssessmentPrompt, buildTransitionPrompt, type BlockZeroAssessmentOutput, type TransitionPromptData } from '../src/lib/prompts/blockZero'
import {
  calibrationCeilingKg,
  getBlockZeroWeekTemplate,
  guardCalibrationWrites,
  guardReactiveReplan,
  guardReplaceSuggestions,
  guardWeekPlan,
  planTransition,
  retestCeilingKg,
  serializeBlockZeroContext,
  week1LiftBaselines,
  type BlockZeroAiContextInput,
  type BlockZeroGuardContext,
  type Clamp,
  type GuardSession,
  type TestRow,
  type WorkupSet,
} from '../src/lib/blockZero'
import { buildWeekPlanPrompt, type WeekPlanParams } from '../src/lib/weeklyPlanAI'
import { buildReactivePrompt, buildReplacePrompt, type SignalBundle } from '../src/lib/reactiveCoach'
import { assessmentTestData, guardAssessment, transitionTestData } from '../src/server/routes/blockZero'
import type { BlockTestData } from '../src/server/blockZeroData'

const DRY = process.argv.includes('--dry-run')

// ─── Key (live only) ─────────────────────────────────────────────

function readKey(): string {
  const path = process.env.WAYMARK_DEV_VARS ?? fileURLToPath(new URL('../.dev.vars', import.meta.url))
  if (!existsSync(path)) {
    console.error(`No ${path}. Put ANTHROPIC_API_KEY=... in .dev.vars at the repo root (or point WAYMARK_DEV_VARS at a file), or run with --dry-run.`)
    process.exit(1)
  }
  const line = readFileSync(path, 'utf8').split(/\r?\n/).find(l => /^\s*ANTHROPIC_API_KEY\s*=/.test(l))
  const key = line?.replace(/^\s*ANTHROPIC_API_KEY\s*=\s*/, '').trim().replace(/^["']|["']$/g, '') ?? ''
  if (!key) {
    console.error(`${path} has no ANTHROPIC_API_KEY line.`)
    process.exit(1)
  }
  return key
}

const apiKey = DRY ? '' : readKey()

// ─── Pricing (USD per million tokens, approximate) ──────────────

const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}

function cost(model: string, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }): number {
  const p = PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, '')] ?? PRICES['claude-sonnet-5-5']
  return (u.input_tokens * p.input + u.output_tokens * p.output + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1e6
}

// ─── Fake athlete and fake data (no personal data) ──────────────

const profile: UserProfileContext = {
  goals: 'Fake test athlete. Rebuild the training habit, get strong, get fit for muay thai.',
  injuries: 'Stiff lower back, no radiating pain.',
  postureIssues: null,
  trainingHistory: 'Lifted and ran for several years. Mostly stopped for 6 months.',
  mtGymAccessDays: 'Mon-Fri evenings',
  mtCapPerWeek: 2,
  weeklyDayTarget: 6,
  constraints: 'Full gym. 60-90 min sessions.',
  trainingMaxes: [],
  latestBodyweightKg: 80,
}

let MON = 21000
while (new Date(MON * 86400000).getUTCDay() !== 1) MON++
const WED = MON + 2
const dowOf = (d: number) => new Date(d * 86400000).getUTCDay()

const aiContext: BlockZeroAiContextInput = {
  weekNumber: 3,
  totalWeeks: 6,
  readiness: {
    checkedIn: true,
    readinessEase: true,
    reason: 'Sleep and energy are off your 7-day trend for 2 days.',
    items: [
      { item: 'sleepHours', today: 5.5, mean7: 7.3, worse: true },
      { item: 'energy', today: 2, mean7: 3.8, worse: true },
      { item: 'soreness', today: 3, mean7: 2.4, worse: false },
      { item: 'stress', today: 3, mean7: 2.6, worse: false },
      { item: 'backToday', today: 3, mean7: 3.4, worse: false },
    ],
  },
  load: { last7: 1380, prev7: 1240, change: 0.113, flagged: false, applies: true },
  lifts: [
    { name: 'Goblet Squat', topSet: { weightKg: 26, reps: 8, rir: 3 }, next: { weightKg: 27.5, change: 'increase' } },
    { name: 'Bench Press', topSet: { weightKg: 52.5, reps: 8, rir: 2 }, next: { weightKg: 52.5, change: 'hold' } },
    { name: 'DB Romanian Deadlift', topSet: { weightKg: 24, reps: 8, rir: 3 }, next: { weightKg: 25, change: 'increase' } },
    { name: 'Overhead Press', topSet: { weightKg: 32.5, reps: 8, rir: 2 }, next: { weightKg: 32.5, change: 'hold' } },
  ],
  backScores: [4, 4, 3, 4, 3, 3, 3],
  backTrend: 'stable',
  run: { longestLast30Sec: 24 * 60 + 15, lastWeekRunSec: 72 * 60 },
  hrCeilingBpm: 142,
  mt: { weeksSinceFirstClass: null, classesThisWeek: 0, profileCap: 2 },
}
const contextText = serializeBlockZeroContext(aiContext)

function weekSessions(week: number, today: number): GuardSession[] {
  const t = getBlockZeroWeekTemplate(week)
  const out: GuardSession[] = []
  for (let k = 0; k < 7; k++) {
    const d = MON + k
    t[dowOf(d)].forEach((s, j) => out.push({ id: `fake-${d}-${j}`, type: s.type, epochDay: d, timeSlot: s.timeSlot, status: d < today ? 'completed' : 'planned', label: s.label }))
  }
  return out
}

const guardCtx: BlockZeroGuardContext = {
  weekNumber: 3,
  todayEpochDay: WED,
  sessions: weekSessions(3, WED),
  readinessEase: true,
  loadFlag: false,
  easeReason: aiContext.readiness?.reason ?? null,
  run: { longestLast30Sec: 24 * 60 + 15, lastWeekRunSec: 72 * 60, thisWeekRunSec: 26 * 60 },
  mt: { weeksSinceFirstClass: null, classesThisWeek: 0, profileCap: 2 },
}

const exerciseRows = [
  { id: 'ex-front-squat', name: 'Front Squat' },
  { id: 'ex-rdl', name: 'Romanian Deadlift' },
  { id: 'ex-block-pull', name: 'Block Pull' },
  { id: 'ex-deadlift', name: 'Conventional Deadlift' },
  { id: 'ex-bench-press', name: 'Bench Press' },
  { id: 'ex-ohp', name: 'Overhead Press' },
  { id: 'ex-bent-over-row', name: 'Bent Over Row' },
  { id: 'ex-goblet-squat', name: 'Goblet Squat' },
  { id: 'ex-db-rdl', name: 'DB Romanian Deadlift' },
  { id: 'ex-db-row', name: 'Dumbbell Row' },
]
const names = new Map(exerciseRows.map(e => [e.id, e.name]))

const testRows: TestRow[] = [
  { week: 1, testKey: 'talk_test_hr', value: 142, unit: 'bpm' },
  { week: 1, testKey: 'fixed_effort_hr', value: 152, unit: 'bpm' },
  { week: 1, testKey: 'pushups_max', value: 21, unit: 'reps' },
  { week: 1, testKey: 'side_plank_sec_l', value: 40, unit: 's' },
  { week: 1, testKey: 'side_plank_sec_r', value: 44, unit: 's' },
  { week: 1, testKey: 'calf_raise_reps_l', value: 18, unit: 'reps' },
  { week: 1, testKey: 'calf_raise_reps_r', value: 20, unit: 'reps' },
  { week: 1, testKey: 'mobility:thoracic', value: 3, unit: 'score' },
  { week: 6, testKey: 'fixed_effort_hr', value: 143, unit: 'bpm' },
  { week: 6, testKey: 'pushups_max', value: 27, unit: 'reps' },
  { week: 6, testKey: 'side_plank_sec_l', value: 55, unit: 's' },
  { week: 6, testKey: 'side_plank_sec_r', value: 58, unit: 's' },
  { week: 6, testKey: 'calf_raise_reps_l', value: 24, unit: 'reps' },
  { week: 6, testKey: 'calf_raise_reps_r', value: 25, unit: 'reps' },
  { week: 6, testKey: 'e1rm:ex-bench-press', value: 72.5, unit: 'kg' },
  { week: 6, testKey: 'e1rm:ex-ohp', value: 47, unit: 'kg' },
]
const workups: WorkupSet[] = [
  { exerciseId: 'ex-bench-press', weightKg: 50, reps: 8, plannedReps: 8, rir: 3, completedAt: MON * 86400 - 20 * 86400, setNumber: 3, sessionId: 'fake-a' },
  { exerciseId: 'ex-ohp', weightKg: 30, reps: 8, plannedReps: 8, rir: 3, completedAt: MON * 86400 - 18 * 86400, setNumber: 3, sessionId: 'fake-b' },
  { exerciseId: 'ex-goblet-squat', weightKg: 24, reps: 8, plannedReps: 8, rir: 3, completedAt: MON * 86400 - 20 * 86400, setNumber: 3, sessionId: 'fake-a' },
  { exerciseId: 'ex-db-rdl', weightKg: 22, reps: 8, plannedReps: 8, rir: 3, completedAt: MON * 86400 - 18 * 86400, setNumber: 3, sessionId: 'fake-b' },
]
const baselines = week1LiftBaselines(testRows, workups)
const blockTests: BlockTestData = {
  rows: testRows.map(r => ({ ...r, unit: r.unit ?? '' })),
  baselines,
  names,
  testsExist: true,
  ceilings: new Map([...baselines.values()].map(b => [b.exerciseId, calibrationCeilingKg(b)])),
}

// ─── The five requests ──────────────────────────────────────────

const systemBlocks = buildSystemPrompt(profile, null, null)

interface Check {
  name: string
  req: AnthropicRequest
  timeoutMs?: number
  parse: (r: AnthropicResult) => unknown
  stub: unknown
  guard: (out: unknown) => { clamps: Clamp[]; pass: boolean; note: string }
}

const weekParams: WeekPlanParams = { blockId: 'fake-block', weekId: 'fake-week', weekNumber: 3, blockWeek: 3, isBlockZero: true, mtClassDays: new Set([1, 3, 5]), prevWeekStart: MON - 7, prevWeekEnd: MON - 1 }
const weekPrompt = buildWeekPlanPrompt(
  weekParams,
  [{ type: 'strength', status: 'completed', rpe: 6, notes: null }, { type: 'foundation_run', status: 'completed', rpe: 4, notes: 'Easy, calves tight.' }],
  [{ sleepHours: 7.5, soreness: 2, notes: null }],
  '',
  [],
  [],
  [],
  '# Adherence signal\nBlock completion: 18/20 (90%). Adherence label: strong.',
  null,
  contextText,
)

const bundle: SignalBundle = {
  trigger: 'wellness_logged',
  todayEpochDay: WED,
  todayDow: dowOf(WED),
  weekStart: WED - dowOf(WED),
  weekEnd: WED - dowOf(WED) + 6,
  justCompleted: null,
  recentMissed: [],
  recentCompleted: [{ type: 'strength', scheduledDate: MON, rpe: 7, notes: null }, { type: 'foundation_run', scheduledDate: MON + 1, rpe: 5, notes: 'Legs heavy.' }],
  wellnessToday: { sleepHours: 5.5, soreness: 3, alcoholScale: 0 },
  wellnessOverreach: true,
  adHocConflict: null,
}
const fakeWeekRows = guardCtx.sessions.map(s => ({ type: s.type, scheduledDate: s.epochDay, timeSlot: s.timeSlot, status: s.status }))
const reactivePrompt = buildReactivePrompt(bundle, 'Sleep or soreness crossed overreach threshold.', '', null, fakeWeekRows, contextText)

const replaced = guardCtx.sessions.find(s => s.epochDay === WED && s.type === 'strength') as GuardSession
const replacePrompt = buildReplacePrompt({
  session: { type: replaced.type, timeSlot: replaced.timeSlot },
  todayEpochDay: WED,
  reason: 'Slept badly, feel flat.',
  wellness: { sleepHours: 5.5, soreness: 3, alcoholScale: 0 },
  weekSessions: fakeWeekRows,
  adherenceBlock: '',
  hrBlock: null,
  blockZeroContext: contextText,
})

const assessmentPrompt = buildAssessmentPrompt(profile, assessmentTestData(blockTests))

const transitionData: TransitionPromptData = {
  weeks: [1, 2, 3, 4, 5, 6].map(w => ({ weekNumber: w, planned: 20, completed: w === 4 ? 15 : 18, avgRpe: 6, avgDifficulty: 2, avgSleepHours: 7.1, avgSoreness: 2.2 })),
  mainLifts: exerciseRows.slice(0, 7).map(e => ({ id: e.id, name: e.name, currentMaxKg: null })),
  adherence: {
    blockCompletionRate: 0.88, blockPlannedSoFar: 120, blockCompleted: 106, blockMissed: 10, blockSkipped: 4,
    last7DaysCompletionRate: 0.9, last14DaysCompletionRate: 0.89, last28DaysCompleted: 70,
    daysSinceLastCompleted: 1, longestGapDays: 3, currentGapDays: 1, acuteChronicRatio: 1.02, label: 'strong',
  },
  guidance: { returnDeload: 'none', blockProgression: 'proceed', rationale: 'Consistent block.' },
  hrBlock: null,
}
const retest = new Map([['ex-bench-press', 72.5], ['ex-ohp', 47]])
const transitionPrompt = buildTransitionPrompt(transitionData, transitionTestData(blockTests, retest, 'better'))

const sonnet = (tool: typeof TOOL_REACTIVE_REPLAN, content: string, effort: 'low' | 'high', max: number): AnthropicRequest => ({
  model: MODELS.reasoning,
  max_tokens: max,
  thinking: { type: 'adaptive' },
  output_config: { effort, format: jsonFormatFor(tool) },
  fallbacks: 'default',
  system: systemBlocks,
  messages: [{ role: 'user', content }],
})

const ok = (clamps: Clamp[]) => clamps.filter(c => c.code !== 'voice')

const checks: Check[] = [
  {
    name: 'week planner (Haiku, Block Zero context)',
    req: { model: MODELS.fast, max_tokens: 2048, system: systemBlocks, messages: [{ role: 'user', content: weekPrompt }], tools: [TOOL_WEEK_PLAN], tool_choice: { type: 'tool', name: 'weekPlan' } },
    parse: r => getToolInput<WeekPlanOutput>(r, 'weekPlan'),
    stub: { narrative: 'Stub.', days: [{ dayOfWeek: 2, sessions: [{ type: 'mt_class', timeSlot: 'pm', label: 'Sparring', estimatedMin: 90 }] }], mtSessionsThisWeek: 1 },
    guard: out => {
      const run = { longestLast30Sec: 24 * 60 + 15, lastWeekRunSec: 72 * 60 }
      const g = guardWeekPlan(out as WeekPlanOutput, { weekNumber: 3, run })
      const again = guardWeekPlan(g.output, { weekNumber: 3, run })
      const whys = g.output.days.flatMap(d => d.sessions).filter(s => s.notes).length
      return { clamps: g.clamps, pass: ok(again.clamps).length === 0, note: `${whys} session why(s); adjustmentNotes: ${g.output.adjustmentNotes ?? 'none'}` }
    },
  },
  {
    name: 'reactive replan (Sonnet, ease day)',
    req: sonnet(TOOL_REACTIVE_REPLAN, reactivePrompt, 'low', 4000),
    parse: r => getStructuredOutput<ReactiveReplanOutput>(r),
    stub: { note: 'Stub.', shiftAction: 'add_recovery', shiftReason: 'Stub!', targetSessionType: 'strength', targetLabel: 'Heavy', targetDay: 3, targetTimeSlot: 'pm' },
    guard: out => {
      const g = guardReactiveReplan(out as ReactiveReplanOutput, guardCtx)
      const again = guardReactiveReplan(g.output, guardCtx)
      return { clamps: g.clamps, pass: ok(again.clamps).length === 0, note: `${g.output.shiftAction} ${g.output.targetSessionType} day ${g.output.targetDay}: ${g.output.shiftReason}` }
    },
  },
  {
    name: 'replace suggestions (Sonnet, ease day)',
    req: sonnet(TOOL_REPLACE_SUGGESTIONS, replacePrompt, 'low', 4000),
    parse: r => getStructuredOutput<ReplaceSuggestionsOutput>(r),
    stub: { coachLine: 'Stub.', suggestions: [{ type: 'mt_class', label: 'Sparring', timeSlot: 'pm', estimatedMin: 90 }] },
    guard: out => {
      const rep = { id: replaced.id as string, type: replaced.type, epochDay: WED, timeSlot: replaced.timeSlot }
      const g = guardReplaceSuggestions(out as ReplaceSuggestionsOutput, rep, guardCtx)
      const again = guardReplaceSuggestions(g.output, rep, guardCtx)
      return { clamps: g.clamps, pass: g.output.suggestions.length > 0 && ok(again.clamps).length === 0, note: `${g.output.suggestions.map(s => `${s.type}:${s.label}:${s.estimatedMin}`).join(', ')} | ${g.output.coachLine}` }
    },
  },
  {
    name: 'assessment with week-1 tests (Sonnet)',
    req: { ...sonnet(BLOCK_ZERO_TOOL as typeof TOOL_REACTIVE_REPLAN, assessmentPrompt, 'high', 16000) },
    timeoutMs: 150_000,
    parse: r => getStructuredOutput<BlockZeroAssessmentOutput>(r),
    stub: { narrative: 'Stub.', weekThemes: [], calibrationStarts: [{ exerciseName: 'Bench Press', startingWeightKg: 90, rationale: 'Stub.' }], mtCapPerWeek: 4 },
    guard: out => {
      const g = guardAssessment(out as BlockZeroAssessmentOutput, exerciseRows, blockTests)
      const capped = g.writes.every(w => w.weightKg <= (blockTests.ceilings.get(w.exerciseId) ?? Infinity))
      return { clamps: g.clamps, pass: capped && (g.mtCap ?? 0) <= 3, note: `writes: ${g.writes.map(w => `${w.exerciseId}=${w.weightKg}`).join(', ') || 'none'}; MT cap ${g.mtCap}` }
    },
  },
  {
    name: 'transition with retest (Sonnet)',
    req: sonnet(TOOL_BLOCK_TRANSITION, transitionPrompt, 'high', 16000),
    timeoutMs: 150_000,
    parse: r => getStructuredOutput<BlockTransitionOutput>(r),
    stub: { decision: 'proceed', rationale: 'Stub.', calibrationTargets: [{ exerciseId: 'ex-bench-press', exerciseName: 'Bench Press', estimatedMaxKg: 100, confidence: 'high' }] },
    guard: out => {
      const o = out as BlockTransitionOutput
      const plan = planTransition({
        gate: { completionRate: 0.88, longestRecentGapDays: 3, backTrend: 'better', retestDone: true, extensionsUsed: 0 },
        aiDecision: o.decision,
        aiTargets: o.calibrationTargets ?? [],
        retestE1rms: retest,
        totalWeeks: 6,
        atEndBoundary: true,
      })
      const g = guardCalibrationWrites(plan.calibration, retest, plan.decision, retestCeilingKg)
      const capped = g.output.every(w => !retest.has(w.exerciseId) || w.weightKg <= retestCeilingKg(retest.get(w.exerciseId) as number, plan.decision))
      return { clamps: g.clamps, pass: capped, note: `rules=${plan.decision} ai=${o.decision}; ${g.output.map(w => `${w.exerciseId}=${w.weightKg}(${w.source})`).join(', ')}` }
    },
  },
]

// ─── Run ────────────────────────────────────────────────────────

console.log(`Block Zero AI livecheck${DRY ? ' (dry run, no API calls)' : ''}. Fake athlete, fake data.`)
console.log(`Context block: ${contextText.length} chars (about ${Math.ceil(contextText.length / 4)} tokens).\n`)

let total = 0
let failures = 0
for (const c of checks) {
  const promptChars = typeof c.req.messages[0].content === 'string' ? c.req.messages[0].content.length : 0
  let output: unknown = null
  let line = ''
  if (DRY) {
    output = c.stub
    line = `model=${c.req.model} prompt=${promptChars} chars (stub output)`
  } else {
    const started = Date.now()
    const result = await anthropicCall(apiKey, c.req, { timeoutMs: c.timeoutMs })
    if (result.offline) {
      failures++
      console.log(`FAIL ${c.name}: offline (no key, API error, refusal or timeout; see the log above)\n`)
      continue
    }
    output = c.parse(result)
    const usd = cost(result.model, result.usage)
    total += usd
    line = `model=${result.model} in=${result.usage.input_tokens} out=${result.usage.output_tokens} cache_read=${result.usage.cache_read_input_tokens ?? 0} cache_write=${result.usage.cache_creation_input_tokens ?? 0} stop=${result.stop_reason} ${((Date.now() - started) / 1000).toFixed(1)}s ~$${usd.toFixed(4)}`
  }
  if (output == null) {
    failures++
    console.log(`FAIL ${c.name}: no parseable output\n  ${line}\n`)
    continue
  }
  const g = c.guard(output)
  if (!g.pass) failures++
  console.log(`${g.pass ? 'PASS' : 'FAIL'} ${c.name}\n  ${line}\n  clamps applied: ${g.clamps.length}${g.clamps.map(x => `\n    - ${x.code} ${x.detail}: ${x.reason}`).join('')}\n  result: ${g.note}\n`)
}

console.log(`${checks.length - failures}/${checks.length} passed.${DRY ? '' : ` Approximate cost: $${total.toFixed(4)} (list prices, see PRICES).`}`)
process.exit(failures > 0 ? 1 : 0)
