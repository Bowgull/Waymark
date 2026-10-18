// Morning summary (plan §9). No push on a free Apple account, so the app
// schedules its local morning alarm with "N changes, M questions" whenever it
// is opened, and Today shows the lines. Pure: the server passes the rows.
//
// Changes: what the coach applied on its own (auto rows, with their reason)
// and weeks it prepared, since the athlete last opened the app.
// Questions: asks still open (not answered, not lapsed). Listed first.

export interface SummaryAdjustmentRow {
  id: string
  adjustmentType: string
  status: string
  auto: number | null
  reason: string
  createdAt: number
  expiresAt: number | null
  sourceData?: string | null
}

export interface SummaryWeekRow {
  id: string
  weekNumber: number
  whyLine: string | null
  preparedAt: number | null
}

export interface CoachSummaryLine {
  id: string
  kind: string
  line: string
  /** "was X", for a changed row. */
  was?: string | null
  /** The Coach board on Today (page 36): a bold lead ("Strength C eased") and the rest of the line after it. */
  lead?: string | null
  body?: string | null
  createdAt: number
}

export interface CoachSummary {
  since: number
  changes: number
  questions: number
  /** Questions first, then changes. */
  questionLines: CoachSummaryLine[]
  changeLines: CoachSummaryLine[]
  /** "2 changes, 1 question", or null when there is nothing. */
  line: string | null
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** "2 changes, 1 question"; null when both are 0. */
export function morningLine(changes: number, questions: number): string | null {
  const parts: string[] = []
  if (changes > 0) parts.push(plural(changes, 'change'))
  if (questions > 0) parts.push(plural(questions, 'question'))
  return parts.length > 0 ? parts.join(', ') : null
}

function sourceField(sourceData: string | null | undefined, key: 'was' | 'lead' | 'body'): string | null {
  if (!sourceData) return null
  try {
    const v = (JSON.parse(sourceData) as Record<string, unknown>)[key]
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}

/**
 * The words after an ease's bold lead, from its colon (page 36: "Strength C
 * eased: one set, 10% lighter. Soreness was 4 this morning."): what it is
 * now, then the cause (the first sentence of the reason).
 */
export function easeBody(now: string, reason: string): string {
  const first = reason.split(/(?<=\.)\s+/)[0] ?? reason
  const n = now.charAt(0).toLowerCase() + now.slice(1)
  return `: ${n.replace(/\.$/, '')}. ${first}`
}

export function buildCoachSummary(adjustments: SummaryAdjustmentRow[], weeks: SummaryWeekRow[], since: number, nowSec: number): CoachSummary {
  const questionLines = adjustments
    .filter(a => a.status === 'proposed' && (a.expiresAt == null || a.expiresAt > nowSec))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(a => ({ id: a.id, kind: a.adjustmentType, line: a.reason, createdAt: a.createdAt }))
  const changeLines: CoachSummaryLine[] = [
    ...weeks
      .filter(w => w.preparedAt != null && w.preparedAt > since)
      .map(w => ({ id: w.id, kind: 'week_prepared', line: w.whyLine ? `Week ${w.weekNumber} is ready. ${w.whyLine}` : `Week ${w.weekNumber} is ready.`, createdAt: w.preparedAt as number })),
    ...adjustments
      .filter(a => a.auto === 1 && a.status === 'accepted' && a.createdAt > since)
      .map(a => ({ id: a.id, kind: a.adjustmentType, line: a.reason, was: sourceField(a.sourceData, 'was'), lead: sourceField(a.sourceData, 'lead'), body: sourceField(a.sourceData, 'body'), createdAt: a.createdAt })),
  ].sort((a, b) => a.createdAt - b.createdAt)
  return {
    since,
    changes: changeLines.length,
    questions: questionLines.length,
    questionLines,
    changeLines,
    line: morningLine(changeLines.length, questionLines.length),
  }
}
