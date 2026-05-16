const API_BASE = process.env.WAYMARK_API_BASE ?? 'http://127.0.0.1:8787'
const TIMES = ['15', '30', '45_plus']
const EQUIPMENT = ['no_gym', 'hotel_gym', 'full_gym']

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

function isoOffsetFromThisMonday(offsetDays) {
  const date = new Date()
  const day = date.getDay()
  const mondayDiff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + mondayDiff + offsetDays)
  return date.toISOString().slice(0, 10)
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function parseContext(session) {
  if (!session?.contextJson) return null
  return JSON.parse(session.contextJson).roadBootcamp ?? null
}

function includesPullingWork(exercises) {
  return exercises.some(row => {
    const name = row.exercise?.name?.toLowerCase() ?? ''
    return name.includes('row') || name.includes('pull') || name.includes('pulldown')
  })
}

function equipmentText(exercises) {
  return exercises.map(row => row.exercise?.equipment?.toLowerCase() ?? '').join(',')
}

let block = await api('/api/blocks/current')
if (block?.blockType !== 'road_bootcamp') {
  block = await api('/api/blocks/road-bootcamp', { method: 'POST' })
}

const results = []
for (const day of [
  { label: 'A', date: isoOffsetFromThisMonday(1) },
  { label: 'B', date: isoOffsetFromThisMonday(3) },
]) {
  for (const timeAvailable of TIMES) {
    for (const equipment of EQUIPMENT) {
      const created = await api('/api/sessions/insert-ad-hoc', {
        method: 'POST',
        body: JSON.stringify({
          type: 'strength',
          timeSlot: 'am',
          date: day.date,
        }),
      })
      expect(created.blockType === 'road_bootcamp', `created strength ${day.label} is not road_bootcamp`)

      const started = await api(`/api/sessions/${created.id}/start-strength`, {
        method: 'POST',
        body: JSON.stringify({ timeAvailable, equipment }),
      })

      const exercises = started.exercises ?? []
      expect(exercises.length > 0, `${day.label} ${timeAvailable} ${equipment} returned no exercises`)
      expect(exercises.every(row => row.exercise?.formVideoUrl?.startsWith('http')), `${day.label} ${timeAvailable} ${equipment} has missing video URL`)
      expect(includesPullingWork(exercises), `${day.label} ${timeAvailable} ${equipment} has no pulling work`)
      expect(!exercises.some(row => row.exerciseId === 'ex-suitcase-carry'), `${day.label} ${timeAvailable} ${equipment} includes suitcase carry`)

      const text = equipmentText(exercises)
      if (equipment === 'no_gym') {
        expect(!text.includes('barbell'), `${day.label} ${timeAvailable} no_gym includes barbell equipment`)
        expect(text.includes('band'), `${day.label} ${timeAvailable} no_gym should use bands`)
      }
      if (equipment === 'hotel_gym') {
        expect(!text.includes('barbell'), `${day.label} ${timeAvailable} hotel_gym includes barbell equipment`)
      }
      if (equipment === 'full_gym') {
        expect(text.includes('barbell') || text.includes('pull-up bar'), `${day.label} ${timeAvailable} full_gym did not use full-gym equipment`)
      }

      const ctx = parseContext(started.session)
      expect(ctx?.timeAvailable === timeAvailable, `${day.label} ${timeAvailable} ${equipment} did not store selected time`)
      expect(ctx?.equipment === equipment, `${day.label} ${timeAvailable} ${equipment} did not store selected equipment`)
      expect(typeof ctx?.adaptationLine === 'string' && ctx.adaptationLine.length > 0, `${day.label} ${timeAvailable} ${equipment} did not store adaptation line`)

      const repeated = await api(`/api/sessions/${created.id}/start-strength`, {
        method: 'POST',
        body: JSON.stringify({ timeAvailable: '15', equipment: 'no_gym' }),
      })
      expect((repeated.exercises ?? []).length === exercises.length, `${day.label} ${timeAvailable} ${equipment} was not idempotent`)

      results.push({
        day: day.label,
        timeAvailable,
        equipment,
        exercises: exercises.length,
        sets: exercises.reduce((sum, row) => sum + (row.sets?.length ?? 0), 0),
      })
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  variants: results.length,
  minExercises: Math.min(...results.map(result => result.exercises)),
  maxExercises: Math.max(...results.map(result => result.exercises)),
  minSets: Math.min(...results.map(result => result.sets)),
  maxSets: Math.max(...results.map(result => result.sets)),
}, null, 2))
