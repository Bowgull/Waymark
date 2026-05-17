import { computeRoadBootcampMetrics } from './roadBootcampMetrics'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const metrics = computeRoadBootcampMetrics({
  sessions: [
    { id: 'easy', type: 'foundation_run', status: 'completed', scheduledDate: 1, completedAt: 1, durationSec: 1800, blockType: 'road_bootcamp', contextJson: null },
    { id: 'quality', type: 'running', status: 'completed', scheduledDate: 2, completedAt: 2, durationSec: 1500, blockType: 'road_bootcamp', contextJson: null },
    { id: 'strength', type: 'strength', status: 'completed', scheduledDate: 3, completedAt: 3, durationSec: 1800, blockType: 'road_bootcamp', contextJson: '{"roadBootcamp":{"timeAvailable":"45_plus","prescribedTime":"30","equipment":"hotel_gym"}}' },
    { id: 'rope', type: 'skip_rope', status: 'completed', scheduledDate: 4, completedAt: 4, durationSec: 600, blockType: 'road_bootcamp', contextJson: null },
    { id: 'missed', type: 'mobility', status: 'missed', scheduledDate: 5, completedAt: null, durationSec: null, blockType: 'road_bootcamp', contextJson: null },
    { id: 'fighter', type: 'strength', status: 'completed', scheduledDate: 6, completedAt: 6, durationSec: 1800, blockType: 'fighter', contextJson: null },
  ],
  runs: [
    { sessionId: 'easy', runType: 'zone2', durationSec: 1800 },
    { sessionId: 'quality', runType: 'easy', durationSec: 1500 },
  ],
  logs: [
    { logDate: 1, sleepHours: 6, soreness: 2 },
    { logDate: 2, sleepHours: 8, soreness: 4 },
  ],
})

assert(metrics.runMinutes === 55, 'sums run minutes')
assert(metrics.easyRunMinutes === 30, 'sums easy minutes')
assert(metrics.qualityRunMinutes === 25, 'sums quality minutes')
assert(metrics.strengthCompleted === 1, 'counts strength')
assert(metrics.strengthTimeDistribution['30'] === 1, 'uses prescribed time')
assert(metrics.equipmentDistribution.hotel_gym === 1, 'counts equipment')
assert(metrics.ropeCompleted === 1, 'counts rope')
assert(metrics.avgSleep === 7, 'averages sleep')
assert(metrics.avgSoreness === 3, 'averages soreness')
assert(metrics.completionRate === 80, 'completion rate ignores planned')

console.log('roadBootcampMetrics tests passed')
