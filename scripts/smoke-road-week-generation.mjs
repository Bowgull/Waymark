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

function mondayIso() {
  const date = new Date()
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return date.toISOString().slice(0, 10)
}

function count(sessions, type) {
  return sessions.filter(session => session.type === type).length
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function canResetTarget() {
  if (process.env.WAYMARK_ALLOW_RESET === '1') return true
  const url = new URL(API_BASE)
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
}

async function getRoadBootcampBlock() {
  if (canResetTarget()) {
    return await api('/api/blocks/road-bootcamp', { method: 'POST', body: JSON.stringify({ confirmReset: true }) })
  }
  const block = await api('/api/blocks/current')
  expect(
    block?.blockType === 'road_bootcamp',
    'remote Road Bootcamp smoke will not reset data without WAYMARK_ALLOW_RESET=1',
  )
  return block
}

const block = await getRoadBootcampBlock()

const weekData = await api('/api/weeks/generate', {
  method: 'POST',
  body: JSON.stringify({
    blockId: block.id,
    weekNumber: 1,
    startDate: mondayIso(),
  }),
})

const sessions = weekData.sessions ?? []
expect(weekData.week?.weekNumber === 1, 'expected week 1')
expect(sessions.length === 14, `expected 14 Road Bootcamp sessions, got ${sessions.length}`)
expect(sessions.every(session => session.blockType === 'road_bootcamp'), 'all sessions must be road_bootcamp')
expect(count(sessions, 'mobility') === 7, 'week needs daily mobility')
expect(count(sessions, 'foundation_run') === 2, 'week needs 2 easy runs')
expect(count(sessions, 'running') === 1, 'week needs 1 quality run')
expect(count(sessions, 'strength') === 2, 'week needs 2 strength sessions')
expect(count(sessions, 'skip_rope') === 2, 'week needs 2 rope primers')
expect(count(sessions, 'bag_work') === 0, 'Road Bootcamp must not assume bag work')
expect(count(sessions, 'mt_class') === 0, 'Road Bootcamp must not assume MT class')

const quality = sessions.find(session => session.type === 'running')
expect(quality?.notes === 'progression', `quality run must carry progression category, got ${quality?.notes}`)

const strength = sessions.filter(session => session.type === 'strength')
expect(strength.every(session => session.blockWeek === 1), 'week 1 strength sessions must use blockWeek 1')

for (const session of strength) {
  const preview = await api(`/api/sessions/${session.id}/strength-preview`)
  expect(preview.roadBootcampReady === true, 'Road Bootcamp strength preview must wait for ready state')
  expect(Array.isArray(preview.exercises) && preview.exercises.length === 0, 'Road Bootcamp preview must not pre-generate exercises')
}

const repeated = await api('/api/weeks/generate', {
  method: 'POST',
  body: JSON.stringify({
    blockId: block.id,
    weekNumber: 1,
    startDate: mondayIso(),
  }),
})
expect((repeated.sessions ?? []).length === sessions.length, 'week generation must be idempotent')
expect(repeated.week?.id === weekData.week?.id, 'repeat generation must return the same week')

console.log(JSON.stringify({
  ok: true,
  blockId: block.id,
  weekId: weekData.week.id,
  sessions: sessions.length,
  mobility: count(sessions, 'mobility'),
  easyRuns: count(sessions, 'foundation_run'),
  qualityRuns: count(sessions, 'running'),
  strength: count(sessions, 'strength'),
  rope: count(sessions, 'skip_rope'),
}, null, 2))
