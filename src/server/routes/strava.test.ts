import {
  bucketZones,
  mapStravaActivityToRunData,
  mapStravaSplits,
  tanakaMaxHrFromDob,
} from './strava'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const activity = {
  id: 12345,
  type: 'Run',
  sport_type: 'Run',
  start_date: '2026-05-16T12:04:00Z',
  start_date_local: '2026-05-16T08:04:00Z',
  distance: 2660,
  moving_time: 1086,
  total_elevation_gain: 6.4,
  average_heartrate: 143.4,
  max_heartrate: 160.2,
  trainer: false,
  splits_metric: [],
}

const run = mapStravaActivityToRunData(activity)

assert(run.localISO === '2026-05-16', 'uses Strava local activity date')
assert(run.distanceKm === 2.66, 'converts meters to km')
assert(run.durationSec === 1086, 'keeps moving time')
assert(run.paceSecKm === 408, 'derives rounded pace seconds per km')
assert(run.isIndoor === 0, 'maps outdoor trainer flag')
assert(run.avgHr === 143, 'rounds average HR')
assert(run.maxHr === 160, 'rounds max HR')
assert(run.elevationGainM === 6, 'rounds elevation gain')

const zeroDistance = mapStravaActivityToRunData({
  ...activity,
  distance: 0,
})
assert(zeroDistance.distanceKm === null, 'zero distance maps to null distance')
assert(zeroDistance.paceSecKm === null, 'zero distance maps to null pace')

const splits = mapStravaSplits([
  { split: 1, moving_time: 405, average_heartrate: 140.4, elevation_difference: 2.2 },
  { split: 2, moving_time: 413, average_heartrate: 146.5, elevation_difference: 3.6 },
])
assert(splits[0].kmIndex === 1, 'maps split index')
assert(splits[0].durationSec === 405, 'maps split moving time')
assert(splits[0].avgHr === 140, 'rounds split average HR')
assert(splits[1].avgHr === 147, 'rounds split average HR upward')
assert(splits[1].elevationGainM === 4, 'rounds split elevation')

const zones = bucketZones([110, 125, 145, 165, 180], [0, 60, 120, 180, 240], 188)
assert(zones.z1 === 60, 'buckets Z1 dwell')
assert(zones.z2 === 60, 'buckets Z2 dwell')
assert(zones.z3 === 60, 'buckets Z3 dwell')
assert(zones.z4 === 60, 'buckets Z4 dwell')
assert(zones.z5 === 1, 'buckets final Z5 sample')

assert(tanakaMaxHrFromDob('1995-07-15') > 180, 'computes plausible Tanaka max HR')
assert(tanakaMaxHrFromDob('not-a-date') === null, 'rejects invalid DOB')

console.log('strava route tests passed')
