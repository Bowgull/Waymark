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

function canResetTarget() {
  if (process.env.WAYMARK_ALLOW_RESET === '1') return true
  const url = new URL(API_BASE)
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

async function completeRunSession({ type, runCategory, startPath, patch }) {
  const session = await api('/api/sessions/insert-ad-hoc', {
    method: 'POST',
    body: JSON.stringify({
      type,
      timeSlot: 'am',
      date: todayIso(),
      ...(runCategory ? { runCategory } : {}),
    }),
  })
  expect(session.blockType === 'road_bootcamp', `${type} must inherit Road Bootcamp`)

  const started = await api(`/api/sessions/${session.id}/${startPath}`, { method: 'POST' })
  const runId = started.runSession?.id
  expect(runId, `${startPath} did not create a run session`)
  expect(started.prescription?.targetDesc, `${startPath} did not return a prescription`)

  await api(`/api/run-sessions/${runId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

  const completed = await api(`/api/sessions/${session.id}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      rpe: type === 'foundation_run' ? 5 : 7,
      notes: `Road Bootcamp ${type} completion smoke.`,
    }),
  })

  expect(completed.status === 'completed', `${type} did not complete`)
  expect(completed.reviewSource === 'local' || completed.reviewSource === 'ai', `${type} review source missing`)
  expect(typeof completed.review === 'string' && completed.review.length > 0, `${type} review missing`)
  expect(typeof completed.reviewFlag === 'string' && completed.reviewFlag.length > 0, `${type} review flag missing`)

  return { session, started, completed }
}

if (!canResetTarget()) {
  throw new Error('Road run flow smoke will not reset remote data without WAYMARK_ALLOW_RESET=1')
}

await api('/api/blocks/road-bootcamp', { method: 'POST', body: JSON.stringify({ confirmReset: true }) })

const easy = await completeRunSession({
  type: 'foundation_run',
  startPath: 'start-foundation-run',
  patch: {
    distanceKm: 4.8,
    durationSec: 2100,
    paceSecKm: 438,
    avgHr: 126,
    maxHr: 139,
    elevationGainM: 18,
    runType: 'zone2',
  },
})

expect(easy.started.runSession.runType === 'zone2', `easy run type should be zone2, got ${easy.started.runSession.runType}`)
expect((easy.started.postureExercises ?? []).length === 5, 'easy run warmup should have 5 exercises')
expect(easy.completed.review.includes('4.8 km') || easy.completed.reviewFlag === 'none', 'easy run review should reflect run evidence')

const quality = await completeRunSession({
  type: 'running',
  runCategory: 'progression',
  startPath: 'start-run',
  patch: {
    distanceKm: 5.1,
    durationSec: 1800,
    paceSecKm: 353,
    avgHr: 151,
    maxHr: 174,
    elevationGainM: 32,
    runType: 'easy',
  },
})

expect(quality.started.prescription.runType, 'quality run should have a prescription run type')
expect(quality.started.prescription.targetDesc.toLowerCase().includes('baseline') || quality.started.prescription.targetDesc.toLowerCase().includes('progression') || quality.started.prescription.targetDesc.toLowerCase().includes('steady'), 'quality run prescription should be a Road Bootcamp quality prescription')

const metrics = await api('/api/history/road-bootcamp?days=30')
expect(metrics.runMinutes >= 65, `expected run minutes >= 65, got ${metrics.runMinutes}`)
expect(metrics.easyRunMinutes >= 35, `expected easy run minutes >= 35, got ${metrics.easyRunMinutes}`)
expect(metrics.qualityRunMinutes >= 30, `expected quality run minutes >= 30, got ${metrics.qualityRunMinutes}`)

console.log(JSON.stringify({
  ok: true,
  easy: {
    sessionId: easy.session.id,
    prescription: easy.started.prescription.targetDesc,
    review: easy.completed.review,
    reviewFlag: easy.completed.reviewFlag,
    reviewSource: easy.completed.reviewSource,
  },
  quality: {
    sessionId: quality.session.id,
    prescription: quality.started.prescription.targetDesc,
    review: quality.completed.review,
    reviewFlag: quality.completed.reviewFlag,
    reviewSource: quality.completed.reviewSource,
  },
  metrics: {
    runMinutes: metrics.runMinutes,
    easyRunMinutes: metrics.easyRunMinutes,
    qualityRunMinutes: metrics.qualityRunMinutes,
  },
}, null, 2))
