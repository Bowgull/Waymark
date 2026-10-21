import type { Tool } from '../anthropic'
import { lbsToKgStored } from '../units'

// ─── Output types (used with getToolInput<T>) ─────────────────────

export type SessionType =
  | 'foundation_run'
  | 'strength'
  | 'mt_class'
  | 'bag_work'
  | 'running'
  | 'skip_rope'
  | 'active_recovery'
  | 'mobility'

export type TimeSlot = 'am' | 'pm'
export type RunCategory = 'zone2' | 'progression'

export interface PlannedSession {
  type: SessionType
  timeSlot: TimeSlot
  label: string
  estimatedMin: number
  runCategory?: RunCategory
  notes?: string
}

export interface PlannedDay {
  dayOfWeek: number
  sessions: PlannedSession[]
}

export interface BodyIssueDetection {
  region: string
  context: string
  severity: 'mild' | 'moderate' | 'severe'
}

export interface WeekPlanOutput {
  narrative: string
  days: PlannedDay[]
  mtSessionsThisWeek: number
  adjustmentNotes?: string
  bodyIssuesDetected?: BodyIssueDetection[]
}

export type RecommendedAction = 'add' | 'swap' | 'reduce_intensity' | 'add_recovery' | 'maintain'

export interface WeekRecommendation {
  action: RecommendedAction
  sessionType: string
  reason: string
  dayOfWeek?: number
  timeSlot?: TimeSlot
}

export interface WeekReviewOutput {
  summary: string
  wellnessNote?: string
  performanceNote?: string
  recommendations: WeekRecommendation[]
}

export type TransitionDecision = 'proceed' | 'hold' | 'adjust'
export type CalibrationConfidence = 'high' | 'medium' | 'low'

export interface CalibrationTarget {
  exerciseId: string
  exerciseName: string
  estimatedMaxKg: number
  confidence: CalibrationConfidence
}

export interface BlockTransitionOutput {
  decision: TransitionDecision
  rationale: string
  calibrationTargets: CalibrationTarget[]
  nextBlockNotes?: string
}

/**
 * The transition as the model writes it: targets in lb (estimatedMaxLb), the
 * unit of every weight in the prompt. transitionFromModel turns it into the
 * kg shape the rules and guards read. estimatedMaxKg is read only from an
 * older reply with no lb field.
 */
export interface BlockTransitionModelOutput extends Omit<BlockTransitionOutput, 'calibrationTargets'> {
  calibrationTargets?: Array<Omit<CalibrationTarget, 'estimatedMaxKg'> & { estimatedMaxLb?: number; estimatedMaxKg?: number }>
}

/** Model reply (lb) -> transition output (kg). Pure. */
export function transitionFromModel(raw: BlockTransitionModelOutput): BlockTransitionOutput {
  const targets = Array.isArray(raw.calibrationTargets) ? raw.calibrationTargets : []
  return {
    ...raw,
    calibrationTargets: targets.map(({ estimatedMaxLb, estimatedMaxKg, ...rest }) => ({
      ...rest,
      estimatedMaxKg: typeof estimatedMaxLb === 'number' ? lbsToKgStored(estimatedMaxLb) : (estimatedMaxKg ?? 0),
    })),
  }
}

export type SessionFlag = 'none' | 'wellness_concern' | 'pr_hit' | 'form_note' | 'intensity_mismatch'

export interface SessionReviewOutput {
  line: string
  flag: SessionFlag
}

export type InsightKind = 'trend' | 'milestone' | 'warning' | 'pattern'

export interface InsightOutput {
  text: string
  kind: InsightKind
  priority: 1 | 2 | 3
}

export type SkipAction = 'hold' | 'move' | 'swap' | 'recover'

export interface SkipResponseOutput {
  coachLine: string
  action: SkipAction
  targetDayOfWeek?: number
  targetTimeSlot?: TimeSlot
  swapToType?: SessionType
  swapToLabel?: string
  weekImpact?: string
}

export type ReactiveShiftAction =
  | 'hold'
  | 'swap'
  | 'reduce_intensity'
  | 'add_recovery'
  | 'move'

export interface ReactiveReplanOutput {
  note: string
  shiftAction: ReactiveShiftAction
  shiftReason: string
  targetSessionType: SessionType
  targetLabel: string
  targetDay: number
  targetTimeSlot: TimeSlot
  originalSessionId?: string
}

// ─── Tool definitions ─────────────────────────────────────────────

export const TOOL_BLOCK_TRANSITION: Tool = {
  name: 'blockTransition',
  description:
    'End-of-block assessment using Sonnet with extended thinking. Decides proceed, hold, or adjust based on 4 weeks of wellness, Drive ratings, adherence, and calibration data.',
  input_schema: {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        enum: ['proceed', 'hold', 'adjust'],
        description: 'proceed: advance to next block. hold: repeat current week. adjust: modify plan before advancing.',
      },
      rationale: {
        type: 'string',
        description: 'One to two sentences. Voice canon: plain, no hype, no congratulations. Weights in lb only, never kg.',
      },
      calibrationTargets: {
        type: 'array',
        description: 'Estimated training maxes based on Block Zero performance. Seeds next block percentages.',
        items: {
          type: 'object',
          properties: {
            exerciseId: { type: 'string' },
            exerciseName: { type: 'string' },
            estimatedMaxLb: { type: 'number', description: 'Estimated training max in pounds (lb), the same unit as every weight in the prompt.' },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'high: observed near-max effort. medium: inferred from working sets. low: insufficient data.',
            },
          },
          required: ['exerciseId', 'exerciseName', 'estimatedMaxLb', 'confidence'],
        },
      },
      nextBlockNotes: {
        type: 'string',
        description: 'Optional context for the first week of the next block. Omit if nothing specific to flag.',
      },
    },
    required: ['decision', 'rationale', 'calibrationTargets'],
  },
}

export const TOOL_SESSION_REVIEW: Tool = {
  name: 'sessionReview',
  description:
    'Post-session one-line review stored on the session record. Voice canon: acknowledge what happened, never congratulate. flag controls ledger surfacing.',
  input_schema: {
    type: 'object',
    properties: {
      line: {
        type: 'string',
        description: 'One line. Voice canon style. Numbers stated plainly. No exclamation marks.',
      },
      flag: {
        type: 'string',
        enum: ['none', 'wellness_concern', 'pr_hit', 'form_note', 'intensity_mismatch'],
        description: 'none: nothing to surface. pr_hit: new personal record. wellness_concern: body signal worth noting. form_note: technique observation. intensity_mismatch: prescribed run intensity did not match heart-rate evidence.',
      },
    },
    required: ['line', 'flag'],
  },
}

export const TOOL_INSIGHT: Tool = {
  name: 'insight',
  description:
    'Ledger insight. Short observation about a trend, pattern, or milestone. Replaces placeholder insightEngine output. Voice canon: plain, no hype.',
  input_schema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'One observation. Voice canon: numbers stated plainly, observation before conclusion.',
      },
      kind: {
        type: 'string',
        enum: ['trend', 'milestone', 'warning', 'pattern'],
        description: 'trend: directional change. milestone: threshold crossed. warning: something needs attention. pattern: recurring behavior.',
      },
      priority: {
        type: 'integer',
        enum: [1, 2, 3],
        description: '1=surface first, 3=surface last.',
      },
    },
    required: ['text', 'kind', 'priority'],
  },
}

export type BagRoundType =
  | 'warmup'
  | 'technical_flow'
  | 'drill_isolation'
  | 'combo_practice'
  | 'power'
  | 'conditioning'

export interface BagPrescribedRound {
  roundNumber: number
  roundType: BagRoundType
  rationale: string
  comboIds: string[]
}

export interface BagPrescriptionOutput {
  sessionIntent: string
  rounds: BagPrescribedRound[]
}

export const TOOL_BAG_PRESCRIPTION: Tool = {
  name: 'bagPrescription',
  description:
    'Prescribe a structured heavy-bag session as a coach would. 4 to 6 rounds, each with a typed role and a one-sentence rationale in voice canon. No freestyle rounds. Round 1 is always warmup. Finisher is conditioning or power based on today state. Choose combos from the supplied available list by id only. Do not invent ids.',
  input_schema: {
    type: 'object',
    properties: {
      sessionIntent: {
        type: 'string',
        description: 'One-line coach framing for the whole session. Voice canon: observation first, then intent. No hype, no exclamation marks.',
      },
      rounds: {
        type: 'array',
        minItems: 4,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            roundNumber: { type: 'integer', description: '1-indexed. Must match position in the array.' },
            roundType: {
              type: 'string',
              enum: ['warmup', 'technical_flow', 'drill_isolation', 'combo_practice', 'power', 'conditioning'],
              description: 'warmup: first round, light, loosen up. technical_flow: mechanics focus, foundation combos. drill_isolation: one combo ID repeated, cite the Fagan or Sylvie protocol from its form_tips. combo_practice: run prescribed combos at moderate intensity. power: hardest working round, max output. conditioning: Fagan-style finisher, 100-strike burnout.',
            },
            rationale: {
              type: 'string',
              description: 'One sentence, under 120 chars, voice canon. Why this round exists for this athlete today. Observation before instruction. No exclamation marks.',
            },
            comboIds: {
              type: 'array',
              minItems: 1,
              maxItems: 4,
              items: { type: 'string' },
              description: 'IDs from the available combos list. For drill_isolation, supply exactly one id. For warmup, 1 or 2 ids. For combo_practice, 2 to 4. For power and conditioning, 1 to 3.',
            },
          },
          required: ['roundNumber', 'roundType', 'rationale', 'comboIds'],
        },
      },
    },
    required: ['sessionIntent', 'rounds'],
  },
}

// ─── Athlete-State assessment (Phase 2) ───────────────────────────

export type AthleteReadiness = 'fresh' | 'normal' | 'taxed' | 'overreached'
export type AthleteWeekShape = 'as_planned' | 'pull_back' | 'add_recovery' | 'push_volume'
export type AthleteLiftVerdict = 'push' | 'hold' | 'deload'
export type AthleteFlagKind = 'pain' | 'plateau' | 'overreach' | 'undertrained'

export interface AthleteLiftAssessmentOutput {
  exerciseId: string
  verdict: AthleteLiftVerdict
  loadFactor: number
  rationale: string
}

export interface AthleteAssessmentOutput {
  readiness: AthleteReadiness
  readinessRationale: string
  lifts: AthleteLiftAssessmentOutput[]
  weekShape: AthleteWeekShape
  weekShapeRationale: string
  flags?: Array<{ kind: AthleteFlagKind; detail: string }>
  note: string
}

export const ALL_TOOLS: Tool[] = [
  TOOL_BLOCK_TRANSITION,
  TOOL_SESSION_REVIEW,
  TOOL_INSIGHT,
  TOOL_BAG_PRESCRIPTION,
]

export const TOOL_BY_NAME: Record<string, Tool> = Object.fromEntries(
  ALL_TOOLS.map(t => [t.name, t])
)
