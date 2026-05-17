import {
  computeAerobicFitness,
  computeWeeklyZones,
  parseZoneSeconds,
} from './historyHrMetrics'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const todayEpochDay = Math.floor(Date.now() / 86400000)
const recentMonday = todayEpochDay - ((new Date(todayEpochDay * 86400000).getUTCDay() + 6) % 7)

const sessions = [
  { id: 'easy-1', status: 'completed', scheduledDate: recentMonday, completedAt: recentMonday * 86400 },
  { id: 'quality-1', status: 'completed', scheduledDate: recentMonday + 1, completedAt: (recentMonday + 1) * 86400 },
  { id: 'planned', status: 'planned', scheduledDate: recentMonday + 2, completedAt: null },
]

const runs = [
  {
    sessionId: 'easy-1',
    runType: 'easy',
    distanceKm: 5,
    paceSecKm: 360,
    avgHr: 140,
    zoneSeconds: '{"z1":120,"z2":1200,"z3":300,"z4":0,"z5":0}',
  },
  {
    sessionId: 'quality-1',
    runType: 'quality',
    distanceKm: 6,
    paceSecKm: 340,
    avgHr: 154,
    zoneSeconds: '{"z1":60,"z2":300,"z3":600,"z4":240,"z5":60}',
  },
  {
    sessionId: 'planned',
    runType: 'easy',
    distanceKm: 4,
    paceSecKm: 390,
    avgHr: 138,
    zoneSeconds: '{"z2":1200}',
  },
]

const parsed = parseZoneSeconds('{"z1":10,"z2":20,"z3":30,"z4":40,"z5":50}')
assert(parsed.z1 === 10 && parsed.z5 === 50, 'parses zone seconds')
assert(parseZoneSeconds('bad-json').z2 === 0, 'invalid zone JSON returns zero zones')

const weekly = computeWeeklyZones({ sessions, runs, weeks: 4 })
assert(weekly.weeks.length === 1, 'groups completed runs into weeks')
assert(weekly.summary.sampleCount === 2, 'counts completed HR zone runs')
assert(weekly.weeks[0].z2 === 1500, 'sums zone 2 seconds')
assert(weekly.weeks[0].z4 === 240, 'sums higher zones')
assert(weekly.weeks[0].totalSec === 2880, 'sums total zone seconds')

const aerobic = computeAerobicFitness({ sessions, runs, lowHr: 135, highHr: 145, days: 90 })
assert(aerobic.dataPoints.length === 1, 'filters fixed-HR aerobic samples')
assert(aerobic.dataPoints[0].sessionId === 'easy-1', 'keeps the matching run')
assert(aerobic.summary.sampleCount === 1, 'counts aerobic samples')
assert(aerobic.summary.avgPaceSecKm === 360, 'averages aerobic pace')
assert(aerobic.summary.avgHr === 140, 'averages heart rate')

console.log('historyHrMetrics tests passed')
