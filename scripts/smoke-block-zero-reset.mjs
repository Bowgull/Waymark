// Local-only smoke for the Block Zero fresh start. Wipes the target database's
// training history, so it refuses anything other than a local wrangler dev API.
const API_BASE = process.env.WAYMARK_API_BASE ?? 'http://127.0.0.1:8787'
const API_KEY = process.env.WAYMARK_API_KEY ?? ''

if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(API_BASE).hostname)) {
  throw new Error('Block Zero reset smoke wipes training history. Point WAYMARK_API_BASE at a local wrangler dev API.')
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
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

async function apiStatus(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  return res.status
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function countVideos(exercises) {
  return exercises.filter(ex => typeof ex.formVideoUrl === 'string' && ex.formVideoUrl.startsWith('http')).length
}

const sentinelGoals = ['Block Zero reset smoke']
const sentinelTrainingHistory = 'Smoke test profile should survive Block Zero fresh start.'
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
    notes: 'Block Zero reset smoke.',
  }),
})

await api('/api/body-metrics', {
  method: 'POST',
  body: JSON.stringify({
    weightKg: 80,
    restingHr: 60,
    notes: 'Block Zero reset smoke.',
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

const unconfirmedStatus = await apiStatus('/api/blocks/block-zero', { method: 'POST', body: JSON.stringify({ freshStart: true }) })
if (unconfirmedStatus !== 400) {
  throw new Error(`Block Zero fresh start without confirmReset should return 400, got ${unconfirmedStatus}`)
}

const sessionsBeforeReset = await api('/api/sessions')
if (sessionsBeforeReset.length === 0) {
  throw new Error('unconfirmed fresh start cleared session history')
}

const block = await api('/api/blocks/block-zero', { method: 'POST', body: JSON.stringify({ freshStart: true, confirmReset: true }) })
if (block.blockType !== 'block_zero') {
  throw new Error(`expected block_zero block, got ${block.blockType}`)
}
if (block.totalWeeks !== 6 || block.status !== 'active') {
  throw new Error(`unexpected Block Zero block shape: ${JSON.stringify(block)}`)
}

const currentBlock = await api('/api/blocks/current')
if (currentBlock?.id !== block.id) {
  throw new Error('Block Zero block is not the active current block')
}

const profileAfter = await api('/api/user-profile')
if (profileAfter?.id !== profile.id || profileAfter.trainingHistory !== sentinelTrainingHistory) {
  throw new Error('user profile was not preserved by Block Zero fresh start')
}

const settingsAfter = await api('/api/settings')
if (settingsBefore && settingsAfter?.mtClassDays !== sentinelMtDays) {
  throw new Error('settings were not preserved by Block Zero fresh start')
}

const exercisesAfter = await api('/api/exercises')
if (exercisesAfter.length !== exercisesBefore.length || countVideos(exercisesAfter) !== countVideos(exercisesBefore)) {
  throw new Error('exercise library or form videos changed during Block Zero fresh start')
}

const stravaAfter = await api('/api/strava/status')
if (stravaAfter.connected !== stravaBefore.connected) {
  throw new Error('Strava connection state changed during Block Zero fresh start')
}
if (stravaBefore.connected && stravaAfter.athleteId !== stravaBefore.athleteId) {
  throw new Error('Strava athlete changed during Block Zero fresh start')
}

const sessionsAfter = await api('/api/sessions')
if (sessionsAfter.length !== 0) {
  throw new Error(`expected session history to be cleared, found ${sessionsAfter.length} sessions`)
}

const bodyMetricsAfter = await api('/api/body-metrics')
if ((bodyMetricsAfter.entries ?? []).length !== 0) {
  throw new Error('body metrics were not cleared by Block Zero fresh start')
}

const dailyLogAfter = await api(`/api/daily-logs/today?date=${todayIso()}`)
if (dailyLogAfter) {
  throw new Error('daily logs were not cleared by Block Zero fresh start')
}

console.log(JSON.stringify({
  ok: true,
  blockId: block.id,
  blockType: block.blockType,
  profilePreserved: true,
  settingsPreserved: settingsBefore ? true : 'not checked (no settings row)',
  stravaConnectedPreserved: stravaAfter.connected,
  exerciseCount: exercisesAfter.length,
  formVideoCount: countVideos(exercisesAfter),
}, null, 2))
