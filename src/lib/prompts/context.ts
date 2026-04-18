export interface SessionRecord {
  id: string
  type: string
  status: string
  scheduledDate: number
  rpe: number | null
  difficulty: number | null
  durationSec: number | null
  notes: string | null
}

export interface DailyLogRecord {
  logDate: number
  sleepHours: number | null
  soreness: number | null
  weedGrams: number | null
  alcoholScale: number | null
}

export interface WeekContext {
  weekStart: number
  weekNumber: number
  sessions: SessionRecord[]
  dailyLogs: DailyLogRecord[]
}

export interface CompressedWeekSummary {
  weekNumber: number
  summary: string
}

function epochDayToDateStr(epochDay: number): string {
  return new Date(epochDay * 86400000).toISOString().slice(0, 10)
}

function formatSession(s: SessionRecord): string {
  const date = epochDayToDateStr(s.scheduledDate)
  const parts = [`${date} ${s.type} (${s.status})`]
  if (s.rpe != null) parts.push(`RPE ${s.rpe}`)
  if (s.difficulty != null) parts.push(`difficulty ${s.difficulty}`)
  if (s.durationSec != null) parts.push(`${Math.round(s.durationSec / 60)}min`)
  return parts.join(' | ')
}

function formatDailyLog(l: DailyLogRecord): string {
  const date = epochDayToDateStr(l.logDate)
  const parts: string[] = [date]
  if (l.sleepHours != null) parts.push(`sleep ${l.sleepHours}h`)
  if (l.soreness != null) parts.push(`soreness ${l.soreness}/5`)
  if (l.weedGrams != null && l.weedGrams > 0) parts.push(`cannabis ${l.weedGrams}g`)
  if (l.alcoholScale != null && l.alcoholScale > 0) parts.push(`alcohol ${l.alcoholScale}/5`)
  return parts.join(' | ')
}

function formatWeek(week: WeekContext): string {
  const dateStr = epochDayToDateStr(week.weekStart)
  const lines: string[] = [`## Week ${week.weekNumber} (starts ${dateStr})`]

  if (week.sessions.length > 0) {
    lines.push('Sessions:')
    for (const s of week.sessions) {
      lines.push(`  ${formatSession(s)}`)
    }
  } else {
    lines.push('Sessions: none logged')
  }

  if (week.dailyLogs.length > 0) {
    lines.push('Wellness:')
    for (const l of week.dailyLogs) {
      lines.push(`  ${formatDailyLog(l)}`)
    }
  }

  return lines.join('\n')
}

export function buildContextBlock(
  recentWeeks: WeekContext[],
  compressedOlderWeeks: CompressedWeekSummary[],
): string {
  const lines: string[] = ['# Training History']

  if (compressedOlderWeeks.length > 0) {
    lines.push('## Older weeks (compressed)')
    for (const w of compressedOlderWeeks) {
      lines.push(`Week ${w.weekNumber}: ${w.summary}`)
    }
    lines.push('')
  }

  if (recentWeeks.length > 0) {
    lines.push('## Recent weeks (full detail)')
    for (const week of recentWeeks) {
      lines.push(formatWeek(week))
    }
  } else {
    lines.push('No training history yet.')
  }

  return lines.join('\n')
}
