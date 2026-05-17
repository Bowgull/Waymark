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
    const recovery = data?.recovery ? ` ${data.recovery}` : ''
    throw new Error(`${options.method ?? 'GET'} ${path} failed ${res.status}: ${text}${recovery}`)
  }
  return data
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

async function cleanup(sessionId) {
  if (!sessionId) return
  await api(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'planned',
      startedAt: null,
      completedAt: null,
      durationSec: null,
      rpe: null,
      notes: 'foundation run smoke reset',
    }),
  }).catch(() => null)
}

let sessionId = null

try {
  const session = await api('/api/sessions/insert-ad-hoc', {
    method: 'POST',
    body: JSON.stringify({
      type: 'foundation_run',
      timeSlot: 'am',
      date: todayIso(),
    }),
  })
  sessionId = session.id

  const started = await api(`/api/sessions/${sessionId}/start-foundation-run`, { method: 'POST' })
  const runId = started.runSession?.id
  if (!runId) throw new Error('start-foundation-run did not return a run session id')
  if (started.runSession?.runType !== 'zone2') {
    throw new Error(`expected zone2 runType, got ${started.runSession?.runType}`)
  }
  const ceiling = started.prescription?.z2CeilingBpm
  if (!Number.isFinite(ceiling)) {
    throw new Error(`foundation run prescription missing z2CeilingBpm: ${JSON.stringify(started.prescription)}`)
  }
  if (started.prescription?.targetDesc?.includes('Keep HR at or below') && !started.prescription.targetDesc.includes(`Keep HR at or below ${ceiling} bpm.`)) {
    throw new Error(`foundation run prescription did not use computed HR ceiling: ${started.prescription?.targetDesc}`)
  }
  if (started.prescription.targetDesc.includes('HR target: 130-145 bpm')) {
    throw new Error(`foundation run prescription returned stale fixed HR band: ${started.prescription.targetDesc}`)
  }

  const warmupCount = started.postureExercises?.length ?? 0
  if (warmupCount !== 5) {
    throw new Error(`expected 5 foundation warmup exercises, got ${warmupCount}`)
  }

  const missingVideo = started.postureExercises.find(row => !row.exercise?.formVideoUrl)
  if (missingVideo) {
    throw new Error(`foundation warmup exercise missing video: ${missingVideo.exerciseId}`)
  }

  const repeated = await api(`/api/sessions/${sessionId}/start-foundation-run`, { method: 'POST' })
  const repeatedCount = repeated.postureExercises?.length ?? 0
  if (repeatedCount !== warmupCount) {
    throw new Error(`foundation run start is not idempotent: ${warmupCount} then ${repeatedCount}`)
  }
  if (repeated.prescription?.z2CeilingBpm !== ceiling) {
    throw new Error(`foundation run prescription changed across repeat start: ${ceiling} then ${repeated.prescription?.z2CeilingBpm}`)
  }

  console.log(JSON.stringify({
    ok: true,
    sessionId,
    runId,
    runType: started.runSession.runType,
    z2CeilingBpm: ceiling,
    warmupCount,
  }, null, 2))
} finally {
  await cleanup(sessionId)
}
