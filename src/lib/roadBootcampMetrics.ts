export interface RoadBootcampMetricSession {
  id: string
  type: string
  status: string
  scheduledDate: number | null
  completedAt: number | null
  durationSec: number | null
  blockType: string
  contextJson: string | null
}

export interface RoadBootcampMetricRun {
  sessionId: string
  runType: string | null
  durationSec: number | null
}

export interface RoadBootcampMetricLog {
  logDate: number
  sleepHours: number | null
  soreness: number | null
}

export interface RoadBootcampMetrics {
  runMinutes: number
  easyRunMinutes: number
  qualityRunMinutes: number
  strengthCompleted: number
  strengthTimeDistribution: Record<string, number>
  equipmentDistribution: Record<string, number>
  ropeCompleted: number
  avgSleep: number | null
  avgSoreness: number | null
  completionRate: number
}

type RoadContext = {
  roadBootcamp?: {
    timeAvailable?: string | null
    prescribedTime?: string | null
    equipment?: string | null
  }
}

function parseRoadContext(value: string | null): RoadContext | null {
  if (!value) return null
  try {
    return JSON.parse(value) as RoadContext
  } catch {
    return null
  }
}

export function computeRoadBootcampMetrics(params: {
  sessions: RoadBootcampMetricSession[]
  runs: RoadBootcampMetricRun[]
  logs: RoadBootcampMetricLog[]
}): RoadBootcampMetrics {
  const sessions = params.sessions.filter(s => s.blockType === 'road_bootcamp')
  const runBySessionId = new Map(params.runs.map(r => [r.sessionId, r]))
  const planned = sessions.filter(s => s.status !== 'planned')
  const completed = sessions.filter(s => s.status === 'completed')
  const completedRunSessions = completed.filter(s => s.type === 'foundation_run' || s.type === 'running')

  let runMinutes = 0
  let easyRunMinutes = 0
  let qualityRunMinutes = 0

  for (const session of completedRunSessions) {
    const run = runBySessionId.get(session.id)
    const durationSec = run?.durationSec ?? session.durationSec ?? 0
    const minutes = Math.round(durationSec / 60)
    runMinutes += minutes
    if (session.type === 'foundation_run') {
      easyRunMinutes += minutes
    } else {
      qualityRunMinutes += minutes
    }
  }

  const strengthTimeDistribution: Record<string, number> = {}
  const equipmentDistribution: Record<string, number> = {}
  for (const session of completed.filter(s => s.type === 'strength')) {
    const ctx = parseRoadContext(session.contextJson)?.roadBootcamp
    const time = ctx?.prescribedTime ?? ctx?.timeAvailable
    if (time) strengthTimeDistribution[time] = (strengthTimeDistribution[time] ?? 0) + 1
    if (ctx?.equipment) equipmentDistribution[ctx.equipment] = (equipmentDistribution[ctx.equipment] ?? 0) + 1
  }

  const sleepValues = params.logs.map(l => l.sleepHours).filter((n): n is number => n != null)
  const sorenessValues = params.logs.map(l => l.soreness).filter((n): n is number => n != null)

  return {
    runMinutes,
    easyRunMinutes,
    qualityRunMinutes,
    strengthCompleted: completed.filter(s => s.type === 'strength').length,
    strengthTimeDistribution,
    equipmentDistribution,
    ropeCompleted: completed.filter(s => s.type === 'skip_rope').length,
    avgSleep: sleepValues.length > 0
      ? Math.round((sleepValues.reduce((sum, n) => sum + n, 0) / sleepValues.length) * 10) / 10
      : null,
    avgSoreness: sorenessValues.length > 0
      ? Math.round((sorenessValues.reduce((sum, n) => sum + n, 0) / sorenessValues.length) * 10) / 10
      : null,
    completionRate: planned.length > 0
      ? Math.round((completed.length / planned.length) * 100)
      : 0,
  }
}
