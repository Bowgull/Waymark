const API_BASE = process.env.WAYMARK_API_BASE ?? 'http://127.0.0.1:8787'
const ENABLED = process.env.WAYMARK_LIVE_AI_SMOKE === '1'

if (!ENABLED) {
  throw new Error('Live AI smoke is opt-in. Set WAYMARK_LIVE_AI_SMOKE=1 after confirming ANTHROPIC_API_KEY is available to the local worker.')
}

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
      notes: 'live review smoke reset',
    }),
  }).catch(() => null)
}

const FLAGS = new Set(['none', 'wellness_concern', 'pr_hit', 'form_note', 'intensity_mismatch'])
let sessionId = null

try {
  const session = await api('/api/sessions/insert-ad-hoc', {
    method: 'POST',
    body: JSON.stringify({
      type: 'running',
      timeSlot: 'am',
      date: todayIso(),
      runCategory: 'zone2',
    }),
  })
  sessionId = session.id

  const started = await api(`/api/sessions/${sessionId}/start-run`, { method: 'POST' })
  const runId = started.runSession?.id
  if (!runId) throw new Error('start-run did not return a run session id')

  await api(`/api/run-sessions/${runId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      distanceKm: 2.66,
      durationSec: 1086,
      paceSecKm: 408,
      avgHr: 143,
      maxHr: 160,
      elevationGainM: 6,
    }),
  })

  const completed = await api(`/api/sessions/${sessionId}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      rpe: 6,
      notes: 'Live AI smoke. Keep the review factual.',
    }),
  })

  if (completed.reviewSource !== 'ai') {
    throw new Error(`expected ai review source, got ${completed.reviewSource}`)
  }
  if (!completed.review || typeof completed.review !== 'string') {
    throw new Error('completed session did not persist a live review line')
  }
  if (!FLAGS.has(completed.reviewFlag)) {
    throw new Error(`unexpected live review flag: ${completed.reviewFlag}`)
  }
  if (completed.review.includes('!')) {
    throw new Error(`live review broke voice canon: ${completed.review}`)
  }

  console.log(JSON.stringify({
    ok: true,
    sessionId,
    review: completed.review,
    reviewFlag: completed.reviewFlag,
    reviewSource: completed.reviewSource,
  }, null, 2))
} finally {
  await cleanup(sessionId)
}
