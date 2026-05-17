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

if (!canResetTarget()) {
  throw new Error('Road strength completion smoke will not reset remote data without WAYMARK_ALLOW_RESET=1')
}

const before = await api('/api/history/road-bootcamp?days=30')

const block = await api('/api/blocks/road-bootcamp', { method: 'POST' })
expect(block.blockType === 'road_bootcamp', 'fresh block must be Road Bootcamp')

const session = await api('/api/sessions/insert-ad-hoc', {
  method: 'POST',
  body: JSON.stringify({
    type: 'strength',
    timeSlot: 'am',
    date: todayIso(),
  }),
})
expect(session.blockType === 'road_bootcamp', 'ad hoc strength must inherit Road Bootcamp')

const started = await api(`/api/sessions/${session.id}/start-strength`, {
  method: 'POST',
  body: JSON.stringify({ timeAvailable: '30', equipment: 'no_gym' }),
})

const exercises = started.exercises ?? []
expect(exercises.length > 0, 'started strength returned no exercises')
expect(exercises.every(row => row.exercise?.formVideoUrl?.startsWith('http')), 'every exercise must have a video URL')

const bandRows = exercises.filter(row => (row.exercise?.equipment ?? '').includes('band') || (row.notes ?? '').includes('HAPBEAR'))
expect(bandRows.length > 0, 'Road Bootcamp strength should include band work')
expect(bandRows.some(row => (row.notes ?? '').includes('HAPBEAR')), 'band work should carry HAPBEAR guidance')

for (const row of exercises) {
  for (const set of row.sets ?? []) {
    await api(`/api/strength-sets/${set.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        weightKg: set.weightKg ?? null,
        reps: set.reps ?? 0,
        completedAt: Math.floor(Date.now() / 1000),
      }),
    })
  }
}

const completed = await api(`/api/sessions/${session.id}/complete`, {
  method: 'POST',
  body: JSON.stringify({
    rpe: 7,
    notes: 'Road Bootcamp HAPBEAR completion smoke.',
  }),
})

expect(completed.status === 'completed', 'session did not complete')
expect(completed.reviewSource === 'local' || completed.reviewSource === 'ai', `unexpected review source ${completed.reviewSource}`)
expect(typeof completed.review === 'string' && completed.review.length > 0, 'completed session did not persist review')
expect(typeof completed.reviewFlag === 'string' && completed.reviewFlag.length > 0, 'completed session did not persist review flag')

const after = await api('/api/history/road-bootcamp?days=30')
expect(after.strengthCompleted >= 1, `expected strengthCompleted >= 1, got ${after.strengthCompleted}`)
expect(after.strengthTimeDistribution?.['30'] >= 1, 'Ledger did not count 30-minute strength selection')
expect(after.equipmentDistribution?.no_gym >= 1, 'Ledger did not count no-gym equipment selection')
expect(after.completionRate > before.completionRate || after.strengthCompleted > before.strengthCompleted, 'Ledger Road Bootcamp metrics did not move')

console.log(JSON.stringify({
  ok: true,
  sessionId: session.id,
  exercises: exercises.length,
  hapbearGuidedExercises: bandRows.filter(row => (row.notes ?? '').includes('HAPBEAR')).length,
  review: completed.review,
  reviewFlag: completed.reviewFlag,
  reviewSource: completed.reviewSource,
  strengthCompleted: after.strengthCompleted,
  strengthTimeDistribution: after.strengthTimeDistribution,
  equipmentDistribution: after.equipmentDistribution,
}, null, 2))
