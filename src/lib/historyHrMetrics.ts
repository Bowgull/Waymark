export interface HistoryMetricSession {
  id: string
  status: string
  scheduledDate: number | null
  completedAt: number | null
  createdAt?: number | null
}

export interface HistoryMetricRun {
  sessionId: string
  runType: string | null
  distanceKm: number | null
  paceSecKm: number | null
  avgHr: number | null
  zoneSeconds: string | null
}

export interface ZoneSeconds {
  z1: number
  z2: number
  z3: number
  z4: number
  z5: number
}

export interface WeeklyZonePoint extends ZoneSeconds {
  weekStart: string
  totalSec: number
}

export interface AerobicFitnessPoint {
  sessionId: string
  date: string
  distanceKm: number
  paceSecKm: number
  avgHr: number
  runType: string | null
}

const SECONDS_PER_DAY = 86400
const MS_PER_DAY = 86400000
const ZERO_ZONES: ZoneSeconds = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }

function safeNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export function parseZoneSeconds(value: string | null): ZoneSeconds {
  if (!value) return { ...ZERO_ZONES }
  try {
    const parsed = JSON.parse(value) as Partial<Record<keyof ZoneSeconds, unknown>>
    return {
      z1: safeNumber(parsed.z1),
      z2: safeNumber(parsed.z2),
      z3: safeNumber(parsed.z3),
      z4: safeNumber(parsed.z4),
      z5: safeNumber(parsed.z5),
    }
  } catch {
    return { ...ZERO_ZONES }
  }
}

function sessionEpochDay(session: HistoryMetricSession): number | null {
  if (session.scheduledDate != null) return session.scheduledDate
  const timestamp = session.completedAt ?? session.createdAt ?? null
  return timestamp == null ? null : Math.floor(timestamp / SECONDS_PER_DAY)
}

function dateFromEpochDay(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().split('T')[0]
}

function mondayStart(epochDay: number): number {
  const utcDay = new Date(epochDay * MS_PER_DAY).getUTCDay()
  const offset = utcDay === 0 ? -6 : 1 - utcDay
  return epochDay + offset
}

export function computeWeeklyZones(params: {
  sessions: HistoryMetricSession[]
  runs: HistoryMetricRun[]
  weeks: number
}): { weeks: WeeklyZonePoint[]; summary: { sampleCount: number } } {
  const sessionMap = new Map(params.sessions.map(session => [session.id, session]))
  const nowEpochDay = Math.floor(Date.now() / MS_PER_DAY)
  const cutoffWeek = mondayStart(nowEpochDay - Math.max(1, params.weeks) * 7)
  const byWeek = new Map<number, ZoneSeconds>()
  let sampleCount = 0

  for (const run of params.runs) {
    const session = sessionMap.get(run.sessionId)
    if (!session || session.status !== 'completed') continue
    const epochDay = sessionEpochDay(session)
    if (epochDay == null) continue
    const weekStart = mondayStart(epochDay)
    if (weekStart < cutoffWeek) continue

    const zones = parseZoneSeconds(run.zoneSeconds)
    const total = zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5
    if (total === 0) continue
    sampleCount += 1

    const current = byWeek.get(weekStart) ?? { ...ZERO_ZONES }
    byWeek.set(weekStart, {
      z1: current.z1 + zones.z1,
      z2: current.z2 + zones.z2,
      z3: current.z3 + zones.z3,
      z4: current.z4 + zones.z4,
      z5: current.z5 + zones.z5,
    })
  }

  const weeks = Array.from(byWeek.entries())
    .sort(([a], [b]) => a - b)
    .map(([weekStart, zones]) => ({
      weekStart: dateFromEpochDay(weekStart),
      ...zones,
      totalSec: zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5,
    }))

  return { weeks, summary: { sampleCount } }
}

export function computeAerobicFitness(params: {
  sessions: HistoryMetricSession[]
  runs: HistoryMetricRun[]
  lowHr: number
  highHr: number
  days: number
}): {
  dataPoints: AerobicFitnessPoint[]
  summary: {
    sampleCount: number
    avgPaceSecKm: number | null
    bestPaceSecKm: number | null
    avgHr: number | null
  }
} {
  const sessionMap = new Map(params.sessions.map(session => [session.id, session]))
  const nowEpochDay = Math.floor(Date.now() / MS_PER_DAY)
  const cutoffEpochDay = nowEpochDay - Math.max(1, params.days)
  const dataPoints: AerobicFitnessPoint[] = []

  for (const run of params.runs) {
    const session = sessionMap.get(run.sessionId)
    if (!session || session.status !== 'completed') continue
    if (run.avgHr == null || run.paceSecKm == null || run.distanceKm == null) continue
    if (run.avgHr < params.lowHr || run.avgHr > params.highHr) continue

    const epochDay = sessionEpochDay(session)
    if (epochDay == null || epochDay < cutoffEpochDay) continue

    dataPoints.push({
      sessionId: run.sessionId,
      date: dateFromEpochDay(epochDay),
      distanceKm: run.distanceKm,
      paceSecKm: run.paceSecKm,
      avgHr: run.avgHr,
      runType: run.runType,
    })
  }

  dataPoints.sort((a, b) => a.date.localeCompare(b.date))

  const paces = dataPoints.map(point => point.paceSecKm)
  const hrs = dataPoints.map(point => point.avgHr)

  return {
    dataPoints,
    summary: {
      sampleCount: dataPoints.length,
      avgPaceSecKm: paces.length > 0 ? Math.round(paces.reduce((sum, n) => sum + n, 0) / paces.length) : null,
      bestPaceSecKm: paces.length > 0 ? Math.min(...paces) : null,
      avgHr: hrs.length > 0 ? Math.round(hrs.reduce((sum, n) => sum + n, 0) / hrs.length) : null,
    },
  }
}
