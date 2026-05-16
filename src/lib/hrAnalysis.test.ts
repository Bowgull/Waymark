import { computeHrSnapshot, serializeHrForPrompt } from './hrAnalysis'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const easyRuns = [
  { runType: 'zone2', avgHr: 145, maxHr: 160, distanceKm: 4, durationSec: 1680, paceSecKm: 420, completedAt: 4, scheduledDate: 4 },
  { runType: 'zone2', avgHr: 144, maxHr: 159, distanceKm: 4, durationSec: 1680, paceSecKm: 420, completedAt: 3, scheduledDate: 3 },
  { runType: 'zone2', avgHr: 143, maxHr: 158, distanceKm: 4, durationSec: 1680, paceSecKm: 420, completedAt: 2, scheduledDate: 2 },
  { runType: 'zone2', avgHr: 142, maxHr: 157, distanceKm: 4, durationSec: 1680, paceSecKm: 420, completedAt: 1, scheduledDate: 1 },
]

const profileBased = computeHrSnapshot(easyRuns, 5, { maxHr: 188 })
assert(profileBased.z2CeilingBpm === 132, 'uses profile max HR for Zone 2 ceiling')
assert(profileBased.z2Compliance === 'over_paced', 'profile-based ceiling catches over-paced easy runs')

const prompt = serializeHrForPrompt(profileBased)
assert(prompt?.includes('target <=132') ?? false, 'prompt states profile-based Zone 2 ceiling')
assert(prompt?.includes('walk if HR climbs above 132') ?? false, 'prompt uses profile-based walk ceiling')

const fallback = computeHrSnapshot(easyRuns, 5)
assert(fallback.z2CeilingBpm === 145, 'falls back to legacy Zone 2 ceiling without profile max HR')
assert(fallback.z2Compliance === 'on_target', 'fallback preserves legacy behavior without profile max HR')

console.log('hrAnalysis tests passed')
