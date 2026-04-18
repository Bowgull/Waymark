// Block Zero entry assessment. Sonnet with extended thinking.
// Called once when Block Zero starts. Reads onboarding answers, produces
// a 6-week plan overview and starting weight estimates.

import { desc, eq } from 'drizzle-orm'
import { coachingOutputs, exercises, trainingMaxes, userProfile } from '../../db/schema'
import { anthropicCall, getToolInput, type Tool } from '../../lib/anthropic'
import { buildSystemPrompt, type UserProfileContext } from '../../lib/prompts/system'
import type { createDB } from '../../db/client'

type DB = ReturnType<typeof createDB>

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

const BLOCK_ZERO_TOOL: Tool = {
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
          'Starting weight estimates for main compound lifts. Conservative. Block Zero loads at 40-55% of these numbers. Based on training history and current detraining state.',
        items: {
          type: 'object',
          properties: {
            exerciseName: { type: 'string' },
            startingWeightKg: {
              type: 'number',
              description:
                'Estimated training max. Block Zero week 1 will work at 40% of this. Must be realistic given current state.',
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

function buildAssessmentPrompt(profile: UserProfileContext): string {
  const lines: string[] = [
    'Block Zero is starting. Assess this user and produce a Block Zero plan overview.',
    '',
    'Block Zero structure:',
    '  Weeks 1-2: Foundation, corrective work, light loading (40% weights). No MT class.',
    '  Weeks 3-4: MT class returns. Weights climb to 50-55%.',
    '  Weeks 5-6: Full schedule. Weights at 55-60%. Ready for Block 1.',
    '',
    'User profile is in the system prompt.',
    '',
    'For calibrationStarts: estimate training maxes for main compound lifts (squat, deadlift, bench press, overhead press, barbell row). Be conservative. If training history indicates a long gap or no strength training, use detrained intermediate baselines.',
    '',
    'For mtCapPerWeek: this is the cap for the entire block. Set based on injury risk and recovery needs. The user has access to MT most evenings and will overtrain without enforcement.',
    '',
    'Call blockZeroAssessment.',
  ]

  if (!profile.trainingHistory && !profile.goals) {
    lines.push('', 'No onboarding data available. Use defaults appropriate for a returning adult athlete.')
  }

  return lines.join('\n')
}

export async function runBlockZeroAssessment(
  db: DB,
  apiKey: string,
  blockId: string,
): Promise<BlockZeroAssessmentOutput | null> {
  const [profileRow] = await db.select().from(userProfile).where(eq(userProfile.id, 'default'))

  const tmRows = await db
    .select({ weightKg: trainingMaxes.weightKg, name: exercises.name })
    .from(trainingMaxes)
    .innerJoin(exercises, eq(trainingMaxes.exerciseId, exercises.id))

  const profile: UserProfileContext = {
    goals: profileRow?.goals ?? null,
    injuries: profileRow?.injuries ?? null,
    postureIssues: profileRow?.postureIssues ?? null,
    trainingHistory: profileRow?.trainingHistory ?? null,
    mtGymAccessDays: profileRow?.mtGymAccessDays ?? null,
    mtCapPerWeek: profileRow?.mtCapPerWeek ?? null,
    weeklyDayTarget: profileRow?.weeklyDayTarget ?? null,
    constraints: profileRow?.constraints ?? null,
    trainingMaxes: tmRows.map(t => ({ exerciseName: t.name, weightKg: t.weightKg })),
  }

  const systemBlocks = buildSystemPrompt(profile, null)

  const result = await anthropicCall(apiKey, {
    model: 'claude-sonnet-4-6',
    max_tokens: 12000,
    thinking: { type: 'enabled', budget_tokens: 8000 },
    system: systemBlocks,
    messages: [{ role: 'user', content: buildAssessmentPrompt(profile) }],
    tools: [BLOCK_ZERO_TOOL],
    tool_choice: { type: 'tool', name: 'blockZeroAssessment' },
  })

  if (result.offline) {
    console.warn('[blockZero] offline during assessment')
    return null
  }

  const output = getToolInput<BlockZeroAssessmentOutput>(result, 'blockZeroAssessment')
  if (!output) {
    console.warn('[blockZero] no tool output from assessment')
    return null
  }

  await db.insert(coachingOutputs).values({
    id: crypto.randomUUID(),
    kind: 'block_zero_assessment',
    model: 'claude-sonnet-4-6',
    scopeWeekPlanId: null,
    scopeSessionId: null,
    inputHash: blockId,
    outputJson: JSON.stringify(output),
    tokensIn: result.usage.input_tokens,
    tokensOut: result.usage.output_tokens,
    cachedTokensIn: result.usage.cache_read_input_tokens ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  })

  console.log(`[blockZero] assessment complete for block ${blockId}`)
  return output
}

export async function getStoredBlockZeroAssessment(
  db: DB,
): Promise<BlockZeroAssessmentOutput | null> {
  const [row] = await db
    .select({ outputJson: coachingOutputs.outputJson })
    .from(coachingOutputs)
    .where(eq(coachingOutputs.kind, 'block_zero_assessment'))
    .orderBy(desc(coachingOutputs.createdAt))
    .limit(1)

  if (!row) return null

  try {
    return JSON.parse(row.outputJson) as BlockZeroAssessmentOutput
  } catch {
    console.warn('[blockZero] malformed stored assessment')
    return null
  }
}
