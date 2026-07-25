// Pure serializer: AthleteContext -> prompt body for the Phase 2 reasoning pass.
// Kept separate from assembly so it can be unit-tested without a DB.
import type { AthleteContext } from './types'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dow(epochDay: number): string {
  return DAY_NAMES[new Date(epochDay * 86400000).getUTCDay()]
}

export function serializeAthleteContext(ctx: AthleteContext): string {
  const lines: string[] = [
    `Today: ${DAY_NAMES[ctx.todayDow]} (dow=${ctx.todayDow}). Recent window: last ${ctx.todayEpochDay - (ctx.weekStart)} days of the current week plus prior sessions.`,
  ]

  if (ctx.priorState) {
    lines.push('', 'Your previous read (for continuity, may be stale):')
    lines.push(`  readiness=${ctx.priorState.readiness}; weekShape=${ctx.priorState.weekShape}. ${ctx.priorState.note}`)
    if (ctx.priorState.lifts.length > 0) {
      lines.push(`  prior lift verdicts: ${ctx.priorState.lifts.map(l => `${l.exerciseName}=${l.verdict}`).join(', ')}`)
    }
    lines.push('  Compare what actually happened since against that read.')
  }

  // Strength trends
  lines.push('', 'Strength trends (newest session first per lift):')
  if (ctx.lifts.length === 0) {
    lines.push('  No completed strength sessions in window.')
  } else {
    for (const l of ctx.lifts) {
      const seq = l.sessions.map(s => s.signal).join(' < ')
      lines.push(`  ${l.exerciseName}: direction=${l.direction}, baseline verdict=${l.verdict} (loadFactor ${l.loadFactor}). Sessions: ${seq || 'none'}.`)
    }
  }

  // Effort
  if (ctx.effort.length > 0) {
    lines.push('', 'Effort (RPE/difficulty), newest first:')
    for (const e of ctx.effort.slice(0, 8)) {
      const bits = [`${dow(e.epochDay)} ${e.type}`]
      if (e.rpe != null) bits.push(`RPE ${e.rpe}/10`)
      if (e.difficulty != null) bits.push(`difficulty ${e.difficulty}`)
      lines.push(`  ${bits.join(' · ')}`)
    }
  }

  // Wellness
  if (ctx.wellness.length > 0) {
    lines.push('', 'Wellness, newest first:')
    for (const w of ctx.wellness.slice(0, 7)) {
      const bits: string[] = [dow(w.epochDay)]
      if (w.sleepHours != null) bits.push(`sleep ${w.sleepHours}h`)
      if (w.soreness != null) bits.push(`soreness ${w.soreness}/5`)
      if (w.alcoholScale != null) bits.push(`alcohol ${w.alcoholScale}/5`)
      lines.push(`  ${bits.join(', ')}`)
    }
  }

  // Run quality
  if (ctx.runs.length > 0) {
    lines.push('', 'Runs, newest first:')
    for (const r of ctx.runs.slice(0, 5)) {
      const bits: string[] = [dow(r.epochDay)]
      if (r.completionStatus) bits.push(r.completionStatus)
      if (r.paceSecKm != null) bits.push(`${r.paceSecKm}s/km`)
      if (r.avgHr != null) bits.push(`avgHR ${r.avgHr}`)
      if (r.shortReason) bits.push(`cut: ${r.shortReason}`)
      lines.push(`  ${bits.join(', ')}`)
    }
  }

  // Notes (the underused pain/mood signal)
  if (ctx.notes.length > 0) {
    lines.push('', 'Notes (scan for pain, soreness, stiffness, hip/shoulder/back, mood):')
    for (const n of ctx.notes.slice(0, 8)) {
      lines.push(`  ${dow(n.epochDay)} (${n.source}): "${n.text}"`)
    }
  }

  // Combo ratings
  if (ctx.comboRatings.length > 0) {
    const avg = ctx.comboRatings.reduce((s, c) => s + c.rating, 0) / ctx.comboRatings.length
    lines.push('', `Bag combo ratings: ${ctx.comboRatings.length} rated, avg ${Math.round(avg * 10) / 10}.`)
  }

  // Body + maxes
  if (ctx.bodyweightKg != null) lines.push('', `Latest bodyweight: ${ctx.bodyweightKg} kg.`)
  if (ctx.trainingMaxes.length > 0) {
    lines.push(`Training maxes: ${ctx.trainingMaxes.map(t => `${t.exerciseName} ${t.weightKg}kg`).join(', ')}.`)
  }

  // Reused blocks
  if (ctx.adherenceBlock) lines.push('', ctx.adherenceBlock)
  if (ctx.hrBlock) lines.push('', ctx.hrBlock)

  lines.push('')
  lines.push('Form one coherent read. Compound the signals: high effort + poor sleep + a strength shortfall together mean under-recovered, not three separate nudges. Honor the deterministic baseline verdicts above; only override a lift with a stated reason.')

  return lines.join('\n')
}
