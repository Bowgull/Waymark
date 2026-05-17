import { execFileSync } from 'node:child_process'

const API_ORIGIN = 'https://waymark.bocas-joshua.workers.dev'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readJson(path) {
  const response = await fetch(`${API_ORIGIN}${path}`)
  const text = await response.text()
  assert(response.ok, `${path} returned ${response.status}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function expectStatus(path, options, expectedStatus) {
  const response = await fetch(`${API_ORIGIN}${path}`, options)
  const text = await response.text()
  assert(
    response.status === expectedStatus,
    `${options.method ?? 'GET'} ${path} returned ${response.status}, expected ${expectedStatus}: ${text.slice(0, 300)}`,
  )
}

function extractWranglerResults(output) {
  const start = output.indexOf('[\n')
  assert(start >= 0, `Wrangler output did not contain a JSON result block:\n${output}`)
  const parsed = JSON.parse(output.slice(start))
  const result = parsed?.[0]?.results?.[0]
  assert(result && typeof result === 'object', `Wrangler result block was empty:\n${output}`)
  return result
}

function readRemoteD1(command) {
  const output = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'waymark-db', '--remote', `--command=${command}`],
    { encoding: 'utf8' },
  )
  return extractWranglerResults(output)
}

const health = await readJson('/api/health')
assert(health.status === 'Waymark API running', 'Worker health route did not return the Waymark status.')

const roadMetrics = await readJson('/api/history/road-bootcamp?days=30')
assert(typeof roadMetrics.completionRate === 'number', 'Road Bootcamp history route did not return metrics.')

await expectStatus('/api/blocks/road-bootcamp', { method: 'POST' }, 400)

const contextColumn = readRemoteD1("SELECT COUNT(*) AS count FROM pragma_table_info('sessions') WHERE name = 'context_json';")
assert(contextColumn.count === 1, 'Remote sessions.context_json is missing.')

const exerciseProof = readRemoteD1(`
  SELECT
    COUNT(*) AS road_exercise_count,
    SUM(CASE WHEN form_video_url LIKE 'http%' THEN 1 ELSE 0 END) AS video_count
  FROM exercises
  WHERE id IN (
    'ex-band-row',
    'ex-band-good-morning',
    'ex-band-chest-press',
    'ex-band-curl',
    'ex-db-bench-press',
    'ex-goblet-squat',
    'ex-db-rdl',
    'ex-db-ohp',
    'ex-lat-pulldown',
    'ex-hamstring-curl',
    'ex-push-up',
    'ex-pike-push-up',
    'ex-tempo-squat',
    'ex-reverse-lunge',
    'ex-single-leg-rdl',
    'ex-lateral-lunges'
  );
`)

assert(exerciseProof.road_exercise_count === 16, `Expected 16 Road Bootcamp exercise rows, got ${exerciseProof.road_exercise_count}.`)
assert(exerciseProof.video_count === 16, `Expected 16 Road Bootcamp exercise videos, got ${exerciseProof.video_count}.`)

console.log('road remote readiness smoke passed')
console.log(JSON.stringify({
  apiOrigin: API_ORIGIN,
  completionRate: roadMetrics.completionRate,
  unconfirmedResetStatus: 400,
  roadExerciseCount: exerciseProof.road_exercise_count,
  videoCount: exerciseProof.video_count,
}, null, 2))
