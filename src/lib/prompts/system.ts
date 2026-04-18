import { cachedSystem, system, type SystemBlock } from '../anthropic'

export interface TrainingMax {
  exerciseName: string
  weightKg: number
}

export interface UserProfileContext {
  goals: string | null
  injuries: string | null
  postureIssues: string | null
  trainingHistory: string | null
  mtGymAccessDays: string | null
  mtCapPerWeek: number | null
  weeklyDayTarget: number | null
  constraints: string | null
  trainingMaxes: TrainingMax[]
}

const IDENTITY_AND_VOICE = `You are a training coach embedded in a personal training app. You produce structured JSON outputs only via tool use. You never write conversational text. You never address the user directly in your outputs.

Voice rules (apply to all user-facing strings in your structured outputs):
- Short sentences. Fragments allowed.
- No exclamation marks. No emoji.
- Observation before instruction. State the fact, then the action.
- Never congratulate. Acknowledge, then raise the bar.
- Never apologize for app behavior. State the fact.
- Numbers stated plainly: "Deadlift 145", not "You hit 145lb on the deadlift!"
- No em dashes. Use periods, commas, or parentheses instead.

Approved copy examples:
- Three of five. The week didn't kill you. Next one has to try harder.
- Noted. We'll make it up Saturday if the body cooperates.
- Sleep slipping, soreness climbing. Volume drops this week. The body's honest.
- Deadlift 145. That was your ceiling last month. It's your floor now.
- No marks yet. Show up a few more times and they start showing up.
- Four weeks. Corrective work, light loading, habit building. Skip this block and the next one breaks you.
- Cleared. The groundwork held. Next block expects more.

Muay Thai hard cap: all generated plans must schedule MT sessions at or below mtCapPerWeek. Non-negotiable. The user has access to MT class almost every night and will overtrain without enforcement.`

function serializeProfile(profile: UserProfileContext): string {
  const lines: string[] = ['# User Profile']

  if (profile.goals) lines.push(`Goals: ${profile.goals}`)
  if (profile.injuries) lines.push(`Injuries: ${profile.injuries}`)
  if (profile.postureIssues) lines.push(`Posture issues: ${profile.postureIssues}`)
  if (profile.trainingHistory) lines.push(`Training history: ${profile.trainingHistory}`)
  if (profile.constraints) lines.push(`Constraints: ${profile.constraints}`)
  if (profile.mtGymAccessDays) lines.push(`MT gym access days: ${profile.mtGymAccessDays}`)
  if (profile.mtCapPerWeek != null) lines.push(`MT cap per week: ${profile.mtCapPerWeek} sessions`)
  if (profile.weeklyDayTarget != null) lines.push(`Weekly training days target: ${profile.weeklyDayTarget}`)

  if (profile.trainingMaxes.length > 0) {
    lines.push('')
    lines.push('# Training Maxes')
    for (const max of profile.trainingMaxes) {
      lines.push(`${max.exerciseName}: ${max.weightKg}kg`)
    }
  }

  return lines.join('\n')
}

export function buildSystemPrompt(
  profile: UserProfileContext,
  compressedHistory: string | null,
): SystemBlock[] {
  const blocks: SystemBlock[] = [
    cachedSystem(IDENTITY_AND_VOICE),
    cachedSystem(serializeProfile(profile)),
  ]

  if (compressedHistory) {
    blocks.push(system(compressedHistory))
  }

  return blocks
}

export function emptyProfile(): UserProfileContext {
  return {
    goals: null,
    injuries: null,
    postureIssues: null,
    trainingHistory: null,
    mtGymAccessDays: null,
    mtCapPerWeek: null,
    weeklyDayTarget: null,
    constraints: null,
    trainingMaxes: [],
  }
}
