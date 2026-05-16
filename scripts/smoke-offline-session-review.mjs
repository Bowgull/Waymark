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

function pace(secondsPerKm) {
  const min = Math.floor(secondsPerKm / 60)
  const sec = String(Math.round(secondsPerKm % 60)).padStart(2, '0')
  return `${min}:${sec}`
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
      notes: 'offline review smoke reset',
    }),
  }).catch(() => null)
}

let sessionId = null

try {
  const profile = await api('/api/user-profile').catch(() => null)
  const maxHr = typeof profile?.maxHr === 'number' ? profile.maxHr : null
  const z2High = maxHr != null ? Math.round(maxHr * 0.7) : null
  const avgHr = z2High != null ? z2High + 10 : 143
  const maxObservedHr = avgHr + 17

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
      avgHr,
      maxHr: maxObservedHr,
      elevationGainM: 6,
    }),
  })

  const completed = await api(`/api/sessions/${sessionId}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      rpe: 7,
      notes: 'Offline fallback smoke.',
    }),
  })

  if (!completed.review) throw new Error('completed session did not persist a review')
  if (!completed.reviewFlag) throw new Error('completed session did not persist a review flag')

  if (z2High != null) {
    if (completed.reviewFlag !== 'intensity_mismatch') {
      throw new Error(`expected intensity_mismatch, got ${completed.reviewFlag}`)
    }
    if (completed.review !== 'Prescribed easy. Heart said hard. Easier next time.') {
      throw new Error(`unexpected mismatch review: ${completed.review}`)
    }
  } else {
    const expected = `2.66 km at ${pace(408)}/km. Avg HR ${avgHr}.`
    if (completed.review !== expected) {
      throw new Error(`unexpected no-target review: ${completed.review}`)
    }
    if (completed.reviewFlag !== 'none') {
      throw new Error(`expected none flag, got ${completed.reviewFlag}`)
    }
  }

  console.log(JSON.stringify({
    ok: true,
    sessionId,
    maxHr,
    review: completed.review,
    reviewFlag: completed.reviewFlag,
  }, null, 2))
} finally {
  await cleanup(sessionId)
}
