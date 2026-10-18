// The Ledger (page 32, "The Ledger · together"): the week's flap-segment rings, Aerobic Base
// (pace at 140 bpm), Strength (top set per week for the main lifts), Sleep + soreness, Body weight
// and Consistency. Pure functions over plain rows so the server and the tests share them.

export type LedgerRange = 'week' | 'month' | 'season'
export type RingState = 'done' | 'todo' | 'skip'
export type RingKey = 'strength' | 'condition' | 'recovery'

export interface LedgerSessionRow {
  id: string
  type: string
  status: string
  scheduledDate: number | null
  timeSlot?: string | null
}

export interface LedgerRing {
  key: RingKey
  label: string
  /** Session icon key for the centre (page 32: strength, zone2, foundation). */
  icon: 'strength' | 'zone2' | 'foundation'
  /** One per planned session in the range, in date order. */
  list: RingState[]
}

/** Ring colours by type (page 32 WEEK): strength brass, condition orange, recovery teal. */
export const RING_COLOUR: Record<RingKey, string> = { strength: '#c9a656', condition: '#c8844e', recovery: '#5fa08c' }

const RING_TYPES: Record<RingKey, readonly string[]> = {
  strength: ['strength'],
  condition: ['foundation_run', 'running', 'mt_class', 'bag_work', 'skip_rope'],
  recovery: ['mobility', 'active_recovery'],
}
const RING_META: Record<RingKey, Pick<LedgerRing, 'label' | 'icon'>> = {
  strength: { label: 'Strength', icon: 'strength' },
  condition: { label: 'Condition', icon: 'zone2' },
  recovery: { label: 'Recovery', icon: 'foundation' },
}

/** The Monday on or before an epoch day (1970-01-01 was a Thursday). */
export function mondayOf(epochDay: number): number {
  return epochDay - ((epochDay + 3) % 7)
}

/** The day range the rings count for each toggle: this week (Mon–Sun), this calendar month, the last 13 weeks. */
export function ringWindow(range: LedgerRange, todayEpochDay: number): { from: number; to: number } {
  const mon = mondayOf(todayEpochDay)
  if (range === 'week') return { from: mon, to: mon + 6 }
  if (range === 'month') {
    const d = new Date(todayEpochDay * 86400000)
    const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86400000
    const last = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / 86400000
    return { from: first, to: last }
  }
  return { from: mon - 12 * 7, to: mon + 6 }
}

/** How many weeks the charts cover for each toggle (page 32 draws 10 weeks on WEEK). */
export const CHART_WEEKS: Record<LedgerRange, number> = { week: 10, month: 26, season: 52 }

export function ringState(status: string): RingState | null {
  if (status === 'completed') return 'done'
  if (status === 'skipped' || status === 'missed') return 'skip'
  if (status === 'planned' || status === 'in_progress') return 'todo'
  return null
}

const SLOT_ORDER: Record<string, number> = { am: 0, pm: 1 }

export function buildRings(rows: LedgerSessionRow[], range: LedgerRange, todayEpochDay: number): LedgerRing[] {
  const { from, to } = ringWindow(range, todayEpochDay)
  const inRange = rows
    .filter(r => r.scheduledDate != null && r.scheduledDate >= from && r.scheduledDate <= to)
    .sort((a, b) => (a.scheduledDate! - b.scheduledDate!) || ((SLOT_ORDER[a.timeSlot ?? ''] ?? 2) - (SLOT_ORDER[b.timeSlot ?? ''] ?? 2)))
  return (Object.keys(RING_TYPES) as RingKey[]).map(key => ({
    key,
    ...RING_META[key],
    list: inRange
      .filter(r => RING_TYPES[key].includes(r.type))
      .map(r => ringState(r.status))
      .filter((s): s is RingState => s != null),
  }))
}

/** How the range has gone for the pond: done of (done + skipped); null when nothing is decided yet. */
export function pondReaction(rings: LedgerRing[]): number | null {
  let done = 0
  let skip = 0
  for (const r of rings) for (const s of r.list) { if (s === 'done') done++; else if (s === 'skip') skip++ }
  return done + skip ? done / (done + skip) : null
}

export interface WeeklyPoint { weekStart: number; value: number }

// ── Aerobic Base: pace at 140 bpm ──

export interface LedgerRunRow { epochDay: number; paceSecKm: number | null; avgHr: number | null; completed: boolean }

/** Runs close to 140 bpm count; each is normalised to 140 (pace × HR ÷ 140, the same work per beat). */
export const AEROBIC_HR = { target: 140, low: 130, high: 150 } as const

export function paceAt140(paceSecKm: number, avgHr: number): number {
  return paceSecKm * avgHr / AEROBIC_HR.target
}

/** One point per week that had a run near 140 bpm: the mean of that week's normalised paces. */
export function aerobicWeekly(runs: LedgerRunRow[], weeks: number, todayEpochDay: number): { points: WeeklyPoint[]; runs: number } {
  const lastMon = mondayOf(todayEpochDay)
  const firstMon = lastMon - (weeks - 1) * 7
  const byWeek = new Map<number, number[]>()
  let count = 0
  for (const r of runs) {
    if (!r.completed || r.paceSecKm == null || r.avgHr == null || r.paceSecKm <= 0) continue
    if (r.avgHr < AEROBIC_HR.low || r.avgHr > AEROBIC_HR.high) continue
    const mon = mondayOf(r.epochDay)
    if (mon < firstMon || mon > lastMon) continue
    count++
    const arr = byWeek.get(mon) ?? []
    arr.push(paceAt140(r.paceSecKm, r.avgHr))
    byWeek.set(mon, arr)
  }
  const points = [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekStart, v]) => ({ weekStart, value: Math.round(v.reduce((s, x) => s + x, 0) / v.length) }))
  return { points, runs: count }
}

// ── Strength: top set per week for the main lifts ──

export interface LedgerSetRow { epochDay: number; exerciseName: string; weightLbs: number }
export interface LiftSeries { name: string; short: string; points: WeeklyPoint[] }

/** Page 32's two lines: the main squat, the front squat (bone), and the bench (grey). */
const MAIN_LIFTS: { short: string; match: RegExp }[] = [
  { short: 'front squat', match: /^front squat/i },
  { short: 'bench', match: /bench press/i },
]

export function strengthWeekly(sets: LedgerSetRow[], weeks: number, todayEpochDay: number): { lifts: LiftSeries[]; sets: number } {
  const lastMon = mondayOf(todayEpochDay)
  const firstMon = lastMon - (weeks - 1) * 7
  let count = 0
  const lifts = MAIN_LIFTS.map(({ short, match }) => {
    const byWeek = new Map<number, number>()
    let name = ''
    for (const s of sets) {
      if (!match.test(s.exerciseName) || !(s.weightLbs > 0)) continue
      const mon = mondayOf(s.epochDay)
      if (mon < firstMon || mon > lastMon) continue
      count++
      name = s.exerciseName
      byWeek.set(mon, Math.max(byWeek.get(mon) ?? 0, s.weightLbs))
    }
    return { name, short, points: [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([weekStart, value]) => ({ weekStart, value })) }
  })
  return { lifts: lifts.filter(l => l.points.length > 0), sets: count }
}

// ── Sleep + soreness: the last seven mornings ──

export interface LedgerDailyRow { logDate: number; sleepHours: number | null; soreness: number | null }
export interface SleepDay { epochDay: number; letter: string; sleepHours: number | null; soreness: number | null }

const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function dayLetter(epochDay: number): string {
  return DAY_LETTER[(epochDay + 4) % 7]
}

export function sleepWeek(logs: LedgerDailyRow[], todayEpochDay: number): { days: SleepDay[]; avg: number | null } {
  const byDay = new Map(logs.map(l => [l.logDate, l]))
  const days: SleepDay[] = []
  for (let d = todayEpochDay - 6; d <= todayEpochDay; d++) {
    const l = byDay.get(d)
    const sore = l?.soreness != null && l.soreness >= 1 && l.soreness <= 5 ? Math.round(l.soreness) : null
    days.push({ epochDay: d, letter: dayLetter(d), sleepHours: l?.sleepHours ?? null, soreness: sore })
  }
  const hrs = days.map(d => d.sleepHours).filter((h): h is number => h != null)
  return { days, avg: hrs.length ? Math.round(hrs.reduce((s, h) => s + h, 0) / hrs.length * 10) / 10 : null }
}

// ── Body weight: the last weigh-in of each week ──

export interface LedgerWeightRow { epochDay: number; weightLbs: number }

export function weightWeekly(rows: LedgerWeightRow[], weeks: number, todayEpochDay: number): { points: WeeklyPoint[]; weighIns: number } {
  const lastMon = mondayOf(todayEpochDay)
  const firstMon = lastMon - (weeks - 1) * 7
  const byWeek = new Map<number, { day: number; w: number }>()
  let count = 0
  for (const r of rows) {
    if (!(r.weightLbs > 0)) continue
    const mon = mondayOf(r.epochDay)
    if (mon < firstMon || mon > lastMon) continue
    count++
    const cur = byWeek.get(mon)
    if (!cur || r.epochDay >= cur.day) byWeek.set(mon, { day: r.epochDay, w: r.weightLbs })
  }
  return {
    points: [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([weekStart, v]) => ({ weekStart, value: Math.round(v.w * 10) / 10 })),
    weighIns: count,
  }
}

// ── Consistency: days in a row with a completed session ──

export function currentStreak(rows: LedgerSessionRow[], todayEpochDay: number): number {
  const done = new Set(rows.filter(r => r.status === 'completed' && r.scheduledDate != null).map(r => r.scheduledDate!))
  // today still counts as open: the streak runs up to yesterday when nothing is done yet today
  let d = done.has(todayEpochDay) ? todayEpochDay : todayEpochDay - 1
  let n = 0
  while (done.has(d)) { n++; d-- }
  return n
}

// ── formatting for the flaps and legends ──

/** The weeks a line spans, first point to last ("· 10 weeks" on page 32's legends). */
export function spanWeeks(points: WeeklyPoint[]): number {
  return points.length ? Math.round((points[points.length - 1].weekStart - points[0].weekStart) / 7) + 1 : 0
}

export function paceFlap(secKm: number): string {
  const s = Math.round(secKm)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/KM @140`
}

/** "▲ 47 s faster" (lower pace is fitter) or "▼ 12 s slower"; null when there is no change to report. */
export function paceDelta(points: WeeklyPoint[]): { text: string; up: boolean } | null {
  if (points.length < 2) return null
  const d = Math.round(points[0].value - points[points.length - 1].value)
  if (d === 0) return null
  return d > 0 ? { text: `▲ ${d} s faster`, up: true } : { text: `▼ ${-d} s slower`, up: false }
}

/** "▼ 2.8 lb" / "▲ 1.2 lb" over the range. */
export function weightDelta(points: WeeklyPoint[]): { text: string; down: boolean } | null {
  if (points.length < 2) return null
  const d = Math.round((points[points.length - 1].value - points[0].value) * 10) / 10
  if (d === 0) return null
  return d < 0 ? { text: `▼ ${(-d).toFixed(1)} lb`, down: true } : { text: `▲ ${d.toFixed(1)} lb`, down: false }
}

/** Where each point sits in a chart box (page 32's LINE: pad, min..max, optional invert so lower is higher). */
export function linePoints(values: number[], w: number, h: number, pad: number, invert: boolean, domain?: { min: number; max: number }): { x: number; y: number }[] {
  if (values.length === 0) return []
  const mn = domain?.min ?? Math.min(...values)
  const mx = domain?.max ?? Math.max(...values)
  const xs = (i: number) => values.length === 1 ? w / 2 : pad + i * (w - pad * 2) / (values.length - 1)
  const ys = (v: number) => pad + (invert ? (v - mn) : (mx - v)) / (mx - mn || 1) * (h - pad * 2)
  return values.map((v, i) => ({ x: Math.round(xs(i) * 10) / 10, y: Math.round(ys(v) * 10) / 10 }))
}
