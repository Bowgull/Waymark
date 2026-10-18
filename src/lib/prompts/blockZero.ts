// Block Zero assessment and transition prompts. Pure builders so the prompt
// assembly can be tested without a DB or an API call. The routes gather the
// data (src/server/routes/blockZero.ts) and call these.

import { jsonInstructionFor, type Tool } from '../anthropic'
import { serializeAdherenceForPrompt, type AdherenceGuidance, type AdherenceSnapshot } from '../adherence'
import type { BackTrend, FixedResult, TestDelta } from '../blockZero'
import type { UserProfileContext } from './system'
import { TOOL_BLOCK_TRANSITION } from './tools'

export interface BlockZeroWeekTheme {
  weekNumber: number
  focus: string
}

export interface BlockZeroCalibrationStart {
  exerciseName: string
  startingWeightKg: number
  rationale: string
}

export interface BlockZeroAssessmentOutput {
  narrative: string
  weekThemes: BlockZeroWeekTheme[]
  calibrationStarts: BlockZeroCalibrationStart[]
  mtCapPerWeek: number
  coachNote?: string
}

export const BLOCK_ZERO_TOOL: Tool = {
  name: 'blockZeroAssessment',
  description:
    'Block Zero entry assessment. Reads onboarding answers and produces a 6-week plan overview with starting weight estimates. Voice canon applies to all user-facing strings: short sentences, no exclamation marks, no congratulations, observation before instruction.',
  input_schema: {
    type: 'object',
    properties: {
      narrative: {
        type: 'string',
        description:
          'Two to three sentences. Voice canon: what this block is for and what the user should expect. No congratulations. No exclamation marks. No em dashes. Example tone: "Four weeks. Corrective work, light loading, habit building. Skip this block and the next one breaks you."',
      },
      weekThemes: {
        type: 'array',
        description: '6 items, one per Block Zero week.',
        items: {
          type: 'object',
          properties: {
            weekNumber: { type: 'integer', description: '1 through 6' },
            focus: {
              type: 'string',
              description: 'One short phrase. What this week emphasizes. No exclamation marks.',
            },
          },
          required: ['weekNumber', 'focus'],
        },
        minItems: 6,
        maxItems: 6,
      },
      calibrationStarts: {
        type: 'array',
        description:
          'Starting weight estimates for main compound lifts, saved as training maxes. Conservative. Block Zero suggests ~55% of these for sets of 8 in week 1, rising to ~65% by week 5, then autoregulates by RPE. Based on training history and current detraining state.',
        items: {
          type: 'object',
          properties: {
            exerciseName: { type: 'string' },
            startingWeightKg: {
              type: 'number',
              description:
                'Estimated training max. Block Zero week 1 suggests about 55% of this for a set of 8 at RPE 6-7. Must be realistic given current state.',
            },
            rationale: {
              type: 'string',
              description:
                'One sentence. Voice canon: plain, factual. State the data point behind the estimate. Example: "No recent strength data. Estimate from typical detrained intermediate baseline."',
            },
          },
          required: ['exerciseName', 'startingWeightKg', 'rationale'],
        },
      },
      mtCapPerWeek: {
        type: 'integer',
        description:
          'Recommended MT sessions cap for Block Zero. Must account for recovery needs during reintroduction phase. Typically 1-2 for weeks 1-2, up to 3 for weeks 5-6.',
      },
      coachNote: {
        type: 'string',
        description:
          'Optional. One sentence flagging a specific concern from onboarding (injury, posture issue, long training gap). Voice canon: state the fact plainly. Omit if nothing specific to flag.',
      },
    },
    required: ['narrative', 'weekThemes', 'calibrationStarts', 'mtCapPerWeek'],
  },
}

// ─── Assessment ───────────────────────────────────────────────

export interface AssessmentTestLift {
  exerciseId: string
  name: string
  e1rmKg: number
  /** Highest training max the rules allow from this test (90% of e1RM). */
  ceilingKg: number
  source: 'test' | 'workup'
  workup: { weightKg: number; reps: number; rir: number } | null
}

export interface AssessmentTestData {
  lifts: AssessmentTestLift[]
  fixed: FixedResult[]
}

function kg(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function fixedLine(r: FixedResult): string {
  return `${r.label} ${kg(r.value)} ${r.unit}`
}

export function serializeAssessmentTests(tests: AssessmentTestData): string[] {
  const lines = ['Week 1 test results. These are real numbers. Base calibrationStarts on them:']
  for (const l of tests.lifts) {
    const from = l.source === 'test'
      ? `logged e1RM ${kg(l.e1rmKg)} kg`
      : `work-up ${kg(l.workup?.weightKg ?? 0)} kg x ${l.workup?.reps ?? 8}, ${(l.workup?.rir ?? 3) >= 3 ? '3+' : l.workup?.rir} left, e1RM about ${kg(l.e1rmKg)} kg`
    lines.push(`  ${l.name} (id: ${l.exerciseId}): ${from}. Ceiling ${kg(l.ceilingKg)} kg.`)
  }
  if (tests.fixed.length > 0) lines.push(`  ${tests.fixed.map(fixedLine).join('. ')}.`)
  lines.push(
    'HARD LIMIT: no calibrationStart above its lift\'s ceiling (90% of the week-1 e1RM). The app clamps anything above it.',
    'Lifts with no test: estimate conservatively from the tested lifts. They are not saved until tested.',
    'Name the test number behind each estimate in its rationale.',
  )
  return lines
}

export function buildAssessmentPrompt(
  profile: Pick<UserProfileContext, 'trainingHistory' | 'goals'>,
  tests: AssessmentTestData | null = null,
): string {
  const hasTests = tests != null && (tests.lifts.length > 0 || tests.fixed.length > 0)
  const lines: string[] = [
    hasTests
      ? 'Block Zero week 1 tests are in. Reassess this user and produce a Block Zero plan overview from the test results.'
      : 'Block Zero is starting. Assess this user and produce a Block Zero plan overview.',
    '',
    'Block Zero structure (6 weeks, up to 2 extension weeks):',
    '  Week 1: each main lift works up to a set of 8 at RPE 6-7. The first easy run-walk logs the talk-test HR. No test week.',
    '  Weeks 2-5: build. 2-3 sets of 8, RPE 6-7 then 7-8, never to failure. Week 3 adds a 3-5 rep check set.',
    '  Week 6: consolidate. Volume down 30-50%, intensity held. The check sets give the front squat estimate; the first easy run-walk logs the talk-test HR again.',
    '  Weekly: Strength A/B/C, 3 run-walks, daily Foundation (type mobility: back and neck, ~12 min), durability twice a week, 1 rest day.',
    '  No MT classes are scheduled. The athlete adds them: technique and pads only for the first 2 weeks back, light clinch from week 3, no hard sparring.',
    '',
    'User profile is in the system prompt.',
    '',
    'For calibrationStarts: estimate training maxes for the main compound lifts. Use these exact exercise names: Front Squat, Romanian Deadlift, Block Pull, Conventional Deadlift, Bench Press, Overhead Press, Bent Over Row. Be conservative. If training history indicates a long gap or no strength training, use detrained intermediate baselines.',
  ]

  if (hasTests) lines.push('', ...serializeAssessmentTests(tests as AssessmentTestData))

  lines.push(
    '',
    'For mtCapPerWeek: this is the cap for the entire block, 0 to 3. Set based on injury risk and recovery needs. The user has access to MT most evenings and will overtrain without enforcement.',
    '',
    jsonInstructionFor(BLOCK_ZERO_TOOL),
  )

  if (!profile.trainingHistory && !profile.goals && !hasTests) {
    lines.push('', 'No onboarding data available. Use defaults appropriate for a returning adult athlete.')
  }

  return lines.join('\n')
}

// ─── Transition ───────────────────────────────────────────────

export const DIFFICULTY_LABELS = ['Too Easy', 'Easy', 'Just Right', 'Hard', 'Too Hard']

export interface TransitionWeekSummary {
  weekNumber: number
  planned: number
  completed: number
  avgRpe: number | null
  avgDifficulty: number | null
  avgSleepHours: number | null
  avgSoreness: number | null
}

export interface TransitionPromptData {
  weeks: TransitionWeekSummary[]
  mainLifts: Array<{ id: string; name: string; currentMaxKg: number | null }>
  adherence: AdherenceSnapshot
  guidance: AdherenceGuidance
  hrBlock: string | null
}

export interface TransitionTestData {
  deltas: TestDelta[]
  backTrend: BackTrend
  /** Per lift with a retest e1RM: the training-max ceilings (90% / 85% on adjust). */
  ceilings: Array<{ exerciseId: string; name: string; retestE1rmKg: number; ceilingKg: number; adjustCeilingKg: number }>
}

function deltaLine(d: TestDelta): string {
  const a = d.week1 != null ? kg(d.week1) : 'none'
  const b = d.retest != null ? kg(d.retest) : 'none'
  const change = d.change != null ? ` (${d.change >= 0 ? '+' : ''}${kg(d.change)})` : ''
  return `  ${d.label}: ${a} -> ${b} ${d.unit}${change}.`
}

export function serializeTransitionTests(tests: TransitionTestData): string[] {
  const lines: string[] = ['Week 1 vs retest (real test numbers):']
  for (const d of tests.deltas) lines.push(deltaLine(d))
  lines.push(`  Back today trend (first week vs last week): ${tests.backTrend}.`)
  lines.push('The talk-test HR is the Zone 2 ceiling; a higher number at the same talk test means the aerobic base improved.')
  if (tests.ceilings.length > 0) {
    lines.push('Retest ceilings for calibrationTargets (90% of retest e1RM, 85% on adjust):')
    for (const c of tests.ceilings) lines.push(`  ${c.name} (id: ${c.exerciseId}): e1RM ${kg(c.retestE1rmKg)} kg. Ceiling ${kg(c.ceilingKg)} kg, ${kg(c.adjustCeilingKg)} kg on adjust.`)
    lines.push('HARD LIMIT: no calibrationTarget above its ceiling. The app clamps anything above it.')
  }
  return lines
}

export function buildTransitionPrompt(data: TransitionPromptData, tests: TransitionTestData | null = null): string {
  const lines: string[] = [
    `Block Zero transition readiness check. ${data.weeks.length} weeks of data available.`,
    '',
    'Week summary:',
  ]

  for (const w of data.weeks) {
    const rpeStr = w.avgRpe != null ? `RPE ${w.avgRpe.toFixed(1)}` : 'no RPE data'
    const diffStr = w.avgDifficulty != null
      ? `difficulty ${DIFFICULTY_LABELS[Math.round(w.avgDifficulty)] ?? w.avgDifficulty.toFixed(1)}`
      : 'no difficulty data'
    const sleepStr = w.avgSleepHours != null ? `sleep ${w.avgSleepHours.toFixed(1)}h` : 'no sleep data'
    const sorenessStr = w.avgSoreness != null ? `soreness ${w.avgSoreness.toFixed(1)}/5` : 'no soreness data'
    lines.push(
      `  Week ${w.weekNumber}: ${w.completed}/${w.planned} sessions completed. ${rpeStr}. ${diffStr}. ${sleepStr}. ${sorenessStr}.`,
    )
  }

  lines.push('')
  lines.push('Main lifts (with database IDs for calibrationTargets):')
  for (const lift of data.mainLifts) {
    const maxStr = lift.currentMaxKg != null ? `current max ${lift.currentMaxKg}kg` : 'no max set'
    lines.push(`  ${lift.name} (id: ${lift.id}): ${maxStr}`)
  }

  if (tests && (tests.deltas.length > 0 || tests.ceilings.length > 0)) {
    lines.push('', ...serializeTransitionTests(tests))
  }

  lines.push('')
  lines.push(serializeAdherenceForPrompt(data.adherence, data.guidance))

  if (data.hrBlock) {
    lines.push('')
    lines.push(data.hrBlock)
    lines.push('HR signal is a tiebreaker. Over-paced zone-2 runs across Block Zero means the aerobic base work got skipped in favor of conditioning, so lean toward hold and prescribe stricter HR ceilings next block.')
  }

  lines.push('')
  lines.push('Decide: proceed (advance to Fighter Block 1), hold (extend Block Zero by one week), or adjust (advance with modified starting loads).')
  lines.push('Adherence floor: if block completion is below 70% or there is a recent gap of 7+ days, lean toward hold or adjust. Block Zero builds base through exposure, not calendar time. A block where half the sessions never happened has not built the base, no matter how many weeks passed.')
  lines.push('A rules gate (completion, recent gaps, back trend, and the week-6 front squat estimate or talk test logged) makes the final call. Your decision can only be more cautious than the gate.')
  lines.push('The athlete never sees this decision. They will just experience the next week. Do not ask for input. Do not soften with praise. State the decision and move.')
  lines.push(tests && tests.ceilings.length > 0
    ? 'Set calibrationTargets from the retest e1RMs above, at or under each ceiling. Use the exact exercise IDs from above. Lifts with no retest: keep estimates conservative (low confidence).'
    : 'Set calibrationTargets with updated training max estimates based on observed Block Zero performance. Use the exact exercise IDs from above. If adherence was poor, keep estimates conservative (low confidence).')
  lines.push('Voice canon applies to rationale and nextBlockNotes: short sentences, no exclamation marks, no congratulations, no em dashes. The rationale is the one-line why.')
  lines.push('')
  lines.push(jsonInstructionFor(TOOL_BLOCK_TRANSITION))

  return lines.join('\n')
}
