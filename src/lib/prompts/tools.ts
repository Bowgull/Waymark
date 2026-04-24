import type { Tool } from '../anthropic'

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

export type SessionFlag = 'none' | 'wellness_concern' | 'pr_hit' | 'form_note'

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

export interface ReplaceSuggestion {
  type: SessionType
  label: string
  timeSlot: TimeSlot
  estimatedMin: number
  runCategory?: RunCategory
}

export interface ReplaceSuggestionsOutput {
  coachLine: string
  suggestions: ReplaceSuggestion[]
}

export interface AddSuggestion {
  type: SessionType
  label: string
  timeSlot: TimeSlot
  estimatedMin: number
  runCategory?: RunCategory
  rationale: string
}

export interface AddSuggestionsOutput {
  suggestions: AddSuggestion[]
}

// ─── Tool definitions ─────────────────────────────────────────────

const SESSION_TYPE_ENUM = [
  'foundation_run',
  'strength',
  'mt_class',
  'bag_work',
  'running',
  'skip_rope',
  'active_recovery',
  'mobility',
]

export const TOOL_WEEK_PLAN: Tool = {
  name: 'weekPlan',
  description:
    'Structured weekly training plan. Sessions keyed by day of week (0=Sun, 6=Sat). Respects MT cap from user profile. narrative follows voice canon: short, no exclamation marks, no congratulations.',
  input_schema: {
    type: 'object',
    properties: {
      narrative: {
        type: 'string',
        description: 'One-line plan summary. Voice canon: short sentence, no hype, no exclamation marks.',
      },
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dayOfWeek: { type: 'integer', description: '0=Sun, 1=Mon, ..., 6=Sat' },
            sessions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: SESSION_TYPE_ENUM },
                  timeSlot: { type: 'string', enum: ['am', 'pm'] },
                  label: { type: 'string' },
                  estimatedMin: { type: 'integer' },
                  runCategory: { type: 'string', enum: ['zone2', 'progression'] },
                  notes: { type: 'string' },
                },
                required: ['type', 'timeSlot', 'label', 'estimatedMin'],
              },
            },
          },
          required: ['dayOfWeek', 'sessions'],
        },
      },
      mtSessionsThisWeek: {
        type: 'integer',
        description: 'Count of mt_class sessions in this plan. Target is mtCapPerWeek. May exceed by one if soreness is low and overall week load is light.',
      },
      adjustmentNotes: {
        type: 'string',
        description: 'Why this week differs from the default template. Omit if no deviation.',
      },
      bodyIssuesDetected: {
        type: 'array',
        description: 'Body regions the athlete mentioned in wellness notes or session notes from the previous week. One entry per distinct region mentioned. Omit entirely if nothing body-related surfaced.',
        items: {
          type: 'object',
          properties: {
            region: {
              type: 'string',
              description: 'Normalized body region, lowercase. Examples: "lower_back", "left_knee", "right_shoulder", "neck", "hip", "wrist". Prefer the same wording across weeks so rolled-up counts work.',
            },
            context: {
              type: 'string',
              description: 'Short phrase quoting or paraphrasing the note that triggered the detection. No interpretation, just the signal.',
            },
            severity: {
              type: 'string',
              enum: ['mild', 'moderate', 'severe'],
              description: 'mild: mentioned in passing. moderate: recurring or limiting. severe: explicit pain or stopped a session.',
            },
          },
          required: ['region', 'context', 'severity'],
        },
      },
    },
    required: ['narrative', 'days', 'mtSessionsThisWeek'],
  },
}

export const TOOL_WEEK_REVIEW: Tool = {
  name: 'weekReview',
  description:
    'Review of a completed training week. summary is voice canon: observation first, no praise. Recommendations flow into the next week plan.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One-line week summary. Voice canon style. Acknowledge and raise the bar, never congratulate.',
      },
      wellnessNote: {
        type: 'string',
        description: 'One observation on sleep, soreness, or recovery. Omit if nothing notable.',
      },
      performanceNote: {
        type: 'string',
        description: 'One observation on effort or completion rate. Omit if nothing notable.',
      },
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['add', 'swap', 'reduce_intensity', 'add_recovery', 'maintain'],
            },
            sessionType: { type: 'string' },
            reason: {
              type: 'string',
              description: 'Voice canon: state the observation first, then the adjustment.',
            },
            dayOfWeek: { type: 'integer', description: '0=Sun..6=Sat. Omit if not day-specific.' },
            timeSlot: { type: 'string', enum: ['am', 'pm'] },
          },
          required: ['action', 'sessionType', 'reason'],
        },
      },
    },
    required: ['summary', 'recommendations'],
  },
}

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
        description: 'One to two sentences. Voice canon: plain, no hype, no congratulations.',
      },
      calibrationTargets: {
        type: 'array',
        description: 'Estimated training maxes based on Block Zero performance. Seeds next block percentages.',
        items: {
          type: 'object',
          properties: {
            exerciseId: { type: 'string' },
            exerciseName: { type: 'string' },
            estimatedMaxKg: { type: 'number' },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'high: observed near-max effort. medium: inferred from working sets. low: insufficient data.',
            },
          },
          required: ['exerciseId', 'exerciseName', 'estimatedMaxKg', 'confidence'],
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
        enum: ['none', 'wellness_concern', 'pr_hit', 'form_note'],
        description: 'none: nothing to surface. pr_hit: new personal record. wellness_concern: body signal worth noting. form_note: technique observation.',
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

export const TOOL_SKIP_RESPONSE: Tool = {
  name: 'skipResponse',
  description:
    'One-line coach response when the athlete skips a session. Decide the single best next move given the skip reason, wellness, day of week, and what is left in the week. Voice canon: plain, no hype, observation before conclusion.',
  input_schema: {
    type: 'object',
    properties: {
      coachLine: {
        type: 'string',
        description: 'One sentence, under 140 chars. Voice canon. Observation first, then the call. No exclamation marks, no congratulations, no second-guessing the skip.',
      },
      action: {
        type: 'string',
        enum: ['hold', 'move', 'swap', 'recover'],
        description: 'hold: accept the skip, no redistribution. move: reschedule the same session later in the week. swap: replace with a different session type better suited to current state. recover: prescribe rest or active recovery instead.',
      },
      targetDayOfWeek: {
        type: 'integer',
        description: 'Required when action is "move" or "swap". 0=Sun..6=Sat. Must be today or later in the current week.',
      },
      targetTimeSlot: {
        type: 'string',
        enum: ['am', 'pm'],
        description: 'Required when action is "move" or "swap".',
      },
      swapToType: {
        type: 'string',
        enum: SESSION_TYPE_ENUM,
        description: 'Required when action is "swap". The session type to substitute.',
      },
      swapToLabel: {
        type: 'string',
        description: 'Required when action is "swap". Short human label for the substitute (e.g. "Reset", "Zone 2").',
      },
      weekImpact: {
        type: 'string',
        description: 'Optional one-line note on how this affects the rest of the week. Omit if no downstream change.',
      },
    },
    required: ['coachLine', 'action'],
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

export const TOOL_REACTIVE_REPLAN: Tool = {
  name: 'reactiveReplan',
  description:
    'Mid-week silent adjustment. Triggered when a meaningful signal changes (HR drift, repeated missed days, sleep or soreness overreach, MT class diverging from prescribed type). Produces one adjustment at a time. Never address the user directly. Voice canon: observation before conclusion, no hype, no decision prompts.',
  input_schema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: 'One-line silent summary of what shifted. Under 140 chars. Voice canon. Observation before conclusion. No second person, no decision prompts.',
      },
      shiftAction: {
        type: 'string',
        enum: ['hold', 'swap', 'reduce_intensity', 'add_recovery', 'move'],
        description: 'hold: accept the signal, no change. swap: replace an upcoming session type. reduce_intensity: keep type, soften prescription. add_recovery: insert a recovery block. move: push an upcoming session to a different day.',
      },
      shiftReason: {
        type: 'string',
        description: 'Exactly one sentence. Under 140 chars. Reads as a standalone coach note — the session/day context is rendered separately, so the sentence must stand on its own without relying on a prefix. Name the observation AND the shift in that single sentence. Voice canon: observation before conclusion, no hype, no exclamation, no em dashes. Do NOT include multiple sentences or a lead-in observation as its own sentence. Used verbatim as weekAdjustments.reason. Example: "Effort has been moderate-to-low and completion sits at 50%, so Thursday strength holds its slot but pulls intensity back one notch."',
      },
      targetSessionType: {
        type: 'string',
        enum: SESSION_TYPE_ENUM,
      },
      targetLabel: {
        type: 'string',
        description: 'Short human label for the target session (e.g. "Reset", "Zone 2", "Mobility").',
      },
      targetDay: { type: 'integer', description: '0=Sun..6=Sat. Today or later this week.' },
      targetTimeSlot: { type: 'string', enum: ['am', 'pm'] },
      originalSessionId: {
        type: 'string',
        description: 'Optional. The planned session this adjustment replaces or moves. Omit if adding a new session.',
      },
    },
    required: ['note', 'shiftAction', 'shiftReason', 'targetSessionType', 'targetLabel', 'targetDay', 'targetTimeSlot'],
  },
}

export const TOOL_REPLACE_SUGGESTIONS: Tool = {
  name: 'replaceSuggestions',
  description:
    'Triggered when the athlete taps Replace on a planned session. Rank the three best-fit alternatives for right now, using the reason, wellness (sleep, soreness, alcohol), recent HR, adherence so far, and what is left in the week. First suggestion is the top pick. Voice canon: plain, observation before conclusion, no hype.',
  input_schema: {
    type: 'object',
    properties: {
      coachLine: {
        type: 'string',
        description: 'One sentence, under 140 chars, explaining the #1 pick. Voice canon. No exclamation marks, no second-person scolding.',
      },
      suggestions: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        description: 'Exactly three alternatives, ordered best to worst for right now.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: SESSION_TYPE_ENUM },
            label: {
              type: 'string',
              description: 'Short human label (e.g. "Reset", "Zone 2", "Mobility").',
            },
            timeSlot: { type: 'string', enum: ['am', 'pm'] },
            estimatedMin: { type: 'integer' },
            runCategory: { type: 'string', enum: ['zone2', 'progression'] },
          },
          required: ['type', 'label', 'timeSlot', 'estimatedMin'],
        },
      },
    },
    required: ['coachLine', 'suggestions'],
  },
}

export const TOOL_ADD_SUGGESTIONS: Tool = {
  name: 'addSuggestions',
  description:
    'Triggered when the athlete opens the Add Session picker on Today. Rank the three best-fit additions for right now, using wellness (sleep, soreness, alcohol), recent HR, adherence so far, what is already done and left in the week, and the block goal. Each pick carries a short rationale. Voice canon: plain, observation before conclusion, no hype.',
  input_schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        description: 'Exactly three additions, ordered best to worst for right now.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: SESSION_TYPE_ENUM },
            label: {
              type: 'string',
              description: 'Short human label (e.g. "Zone 2", "Strength", "Mobility").',
            },
            timeSlot: { type: 'string', enum: ['am', 'pm'] },
            estimatedMin: { type: 'integer' },
            runCategory: { type: 'string', enum: ['zone2', 'progression'] },
            rationale: {
              type: 'string',
              description: 'One sentence, under 100 chars, plain reason this pick fits right now. Voice canon.',
            },
          },
          required: ['type', 'label', 'timeSlot', 'estimatedMin', 'rationale'],
        },
      },
    },
    required: ['suggestions'],
  },
}

export const ALL_TOOLS: Tool[] = [
  TOOL_WEEK_PLAN,
  TOOL_WEEK_REVIEW,
  TOOL_BLOCK_TRANSITION,
  TOOL_SESSION_REVIEW,
  TOOL_INSIGHT,
  TOOL_SKIP_RESPONSE,
  TOOL_BAG_PRESCRIPTION,
  TOOL_REACTIVE_REPLAN,
  TOOL_REPLACE_SUGGESTIONS,
  TOOL_ADD_SUGGESTIONS,
]

export const TOOL_BY_NAME: Record<string, Tool> = Object.fromEntries(
  ALL_TOOLS.map(t => [t.name, t])
)
