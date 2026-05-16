const API_BASE = process.env.WAYMARK_API_BASE ?? 'http://127.0.0.1:8787'

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed ${res.status}: ${text}`)
  }
  return data
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function countVideos(exercises) {
  return exercises.filter(ex => typeof ex.formVideoUrl === 'string' && ex.formVideoUrl.startsWith('http')).length
}

const sentinelGoals = ['Road Bootcamp reset smoke']
const sentinelTrainingHistory = 'Smoke test profile should survive Road Bootcamp fresh start.'
const sentinelMtDays = '2,4'

const profile = await api('/api/user-profile', {
  method: 'POST',
  body: JSON.stringify({
    goals: sentinelGoals,
    injuries: null,
    trainingHistory: sentinelTrainingHistory,
  }),
})

const settingsBefore = await api('/api/settings')
if (settingsBefore) {
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      mtClassDays: sentinelMtDays,
      enabledTechniques: 'boxing,kicks,defensive',
    }),
  })
}

const exercisesBefore = await api('/api/exercises')
const stravaBefore = await api('/api/strava/status')

await api('/api/daily-logs', {
  method: 'POST',
  body: JSON.stringify({
    date: todayIso(),
    sleepHours: 6,
    soreness: 4,
    notes: 'Road Bootcamp reset smoke.',
  }),
})

await api('/api/body-metrics', {
  method: 'POST',
  body: JSON.stringify({
    weightKg: 80,
    restingHr: 60,
    notes: 'Road Bootcamp reset smoke.',
  }),
})

await api('/api/sessions/insert-ad-hoc', {
  method: 'POST',
  body: JSON.stringify({
    type: 'running',
    timeSlot: 'am',
    date: todayIso(),
    runCategory: 'zone2',
  }),
})

const block = await api('/api/blocks/road-bootcamp', { method: 'POST' })
if (block.blockType !== 'road_bootcamp') {
  throw new Error(`expected road_bootcamp block, got ${block.blockType}`)
}
if (block.totalWeeks !== 8 || block.status !== 'active') {
  throw new Error(`unexpected Road Bootcamp block shape: ${JSON.stringify(block)}`)
}

const currentBlock = await api('/api/blocks/current')
if (currentBlock?.id !== block.id) {
  throw new Error('Road Bootcamp block is not the active current block')
}

const profileAfter = await api('/api/user-profile')
if (profileAfter?.id !== profile.id || profileAfter.trainingHistory !== sentinelTrainingHistory) {
  throw new Error('user profile was not preserved by Road Bootcamp reset')
}

const settingsAfter = await api('/api/settings')
if (settingsBefore && settingsAfter?.mtClassDays !== sentinelMtDays) {
  throw new Error('settings were not preserved by Road Bootcamp reset')
}

const exercisesAfter = await api('/api/exercises')
if (exercisesAfter.length !== exercisesBefore.length || countVideos(exercisesAfter) !== countVideos(exercisesBefore)) {
  throw new Error('exercise library or form videos changed during Road Bootcamp reset')
}

const stravaAfter = await api('/api/strava/status')
if (stravaAfter.connected !== stravaBefore.connected) {
  throw new Error('Strava connection state changed during Road Bootcamp reset')
}
if (stravaBefore.connected && stravaAfter.athleteId !== stravaBefore.athleteId) {
  throw new Error('Strava athlete changed during Road Bootcamp reset')
}

const sessionsAfter = await api('/api/sessions')
if (sessionsAfter.length !== 0) {
  throw new Error(`expected session history to be cleared, found ${sessionsAfter.length} sessions`)
}

const bodyMetricsAfter = await api('/api/body-metrics')
if ((bodyMetricsAfter.entries ?? []).length !== 0) {
  throw new Error('body metrics were not cleared by Road Bootcamp reset')
}

const dailyLogAfter = await api(`/api/daily-logs/today?date=${todayIso()}`)
if (dailyLogAfter) {
  throw new Error('daily logs were not cleared by Road Bootcamp reset')
}

console.log(JSON.stringify({
  ok: true,
  blockId: block.id,
  blockType: block.blockType,
  profilePreserved: true,
  settingsPreserved: Boolean(settingsBefore),
  stravaConnectedPreserved: stravaAfter.connected,
  exerciseCount: exercisesAfter.length,
  formVideoCount: countVideos(exercisesAfter),
}, null, 2))
