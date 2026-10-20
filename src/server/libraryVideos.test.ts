// Run: tsx src/server/libraryVideos.test.ts
// 0039 (approved by Josh 2026-10-20) on a real in-memory database: every
// migration, then the seed (the Library's rows as production has them), then
// 0039 once more, as wrangler would apply it on top. The start times and the
// swaps land by id; nothing is wiped; combo-w12 keeps its video.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const ROOT = process.cwd()
const MIGRATION = readFileSync(join(ROOT, 'drizzle/0039_library_videos.sql'), 'utf8')

function csv(path: string): Record<string, string>[] {
  // the two CSVs: quoted cells may hold commas
  const text = readFileSync(join(ROOT, path), 'utf8').replace(new RegExp(String.fromCharCode(0x5e, 0xfeff)), '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows.filter(r => r.length > 1)
  return body.map(r => Object.fromEntries(head.map((k, i) => [k, (r[i] ?? '').trim()])))
}
const starts = csv('docs/library/library-video-starts.csv')
const swaps = csv('docs/library/library-video-replacements.csv')

const TABLE = (id: string) => (id.startsWith('ex-') ? 'exercises' : id.startsWith('combo-') ? 'combos' : id.startsWith('tech-') ? 'techniques' : 'run_types')

// additive: updates by id only
const statements = MIGRATION.split('\n').filter(l => l.trim() && !l.startsWith('--'))
assert.ok(statements.length > 0)
for (const s of statements) assert.match(s, /^UPDATE (exercises|combos|techniques|run_types) SET .+ WHERE id = '[a-z0-9-]+';$/, `only updates by id: ${s.slice(0, 80)}`)
assert.doesNotMatch(MIGRATION, /\b(DELETE|DROP|INSERT|ALTER)\b/i, 'nothing wiped, no schema change')
// the seed carries the same rows
const seed = readFileSync(join(ROOT, 'src/db/seed.sql'), 'utf8')
for (const s of statements) assert.ok(seed.includes(s), `seed.sql has: ${s.slice(0, 80)}`)
// 0039 is the next migration after 0038
const files = readdirSync(join(ROOT, 'drizzle')).filter(n => n.endsWith('.sql')).sort()
assert.equal(files.at(-1), '0039_library_videos.sql')

const db = new Database(':memory:')
for (const f of files) db.exec(readFileSync(join(ROOT, 'drizzle', f), 'utf8').replace(/--> statement-breakpoint/g, '').replace(/INSERT INTO `__new_\w+`[^;]*;/g, ''))
db.exec(seed)
const count = () => ['exercises', 'combos', 'techniques', 'run_types'].map(t => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n)
const before = count()
assert.ok(before[0] > 50 && before[1] > 50, `the seed filled the Library: ${before}`)
db.exec(MIGRATION)
assert.deepEqual(count(), before, 'no row added or removed')

type Row = { form_video_url: string | null; video_start_sec: number | null; video_source: string | null; video_title: string | null; video_length: string | null; video_status: string | null; tiktok_url: string | null; alt_video_url: string | null }
const row = (id: string) => db.prepare(`SELECT * FROM ${TABLE(id)} WHERE id = ?`).get(id) as Row

const swapped = new Map(swaps.filter(s => s.id !== 'combo-w12').map(s => [s.id, s]))
assert.equal(swapped.size, 10, 'ten swaps')

// 1. start times on the 25 long videos (a swapped item takes its swap's start)
assert.equal(starts.length, 25)
for (const s of starts) {
  const r = row(s.id)
  const sw = swapped.get(s.id)
  if (sw) continue
  assert.equal(r.form_video_url, s.url, `${s.id}: same video`)
  assert.equal(r.video_start_sec, Number(s.start_seconds), `${s.id}: starts at ${s.start_seconds}s`)
}

// 2. the swaps: the new video, its start, its coach, the TikTok second
for (const [id, s] of swapped) {
  const r = row(id)
  assert.equal(r.form_video_url, s.proposed_url, `${id}: the new video`)
  assert.equal(r.video_start_sec, Number(s.start_seconds) || null, `${id}: its start`)
  assert.equal(r.video_source, s.channel, `${id}: its coach`)
  assert.equal(r.video_status, 'live')
  assert.ok(r.video_title && r.video_length, `${id}: title and length from the check`)
  if (s.second_url) assert.equal(r.tiktok_url, s.second_url, `${id}: the TikTok second link`)
}
assert.equal(row('combo-f02').video_start_sec, 4, 'f02 starts at the swap\'s 4s, not the old video\'s 80s')
// the credit fix: Tiger Muay Thai (Brad Riddell), not Fagan or Jeff Chan
for (const id of ['combo-d03', 'combo-m03']) {
  assert.match(row(id).video_source!, /^Tiger Muay Thai \(Brad Riddell/)
  assert.doesNotMatch(row(id).video_source!, /Fagan|Chan/)
}
// the dowel Short was the backup: the old main video is the backup now
assert.equal(row('ex-hip-hinge-dowel').alt_video_url, 'https://www.youtube.com/watch?v=oSfNnSJWlMw')
assert.equal(row('ex-hip-hinge-dowel').video_start_sec, 3)
// combo-w12 stays as it is (its start time only)
const w12 = row('combo-w12')
assert.equal(w12.form_video_url, 'https://www.youtube.com/watch?v=rTTEn0RQQsw')
assert.equal(w12.video_source, 'fightTIPS')
assert.equal(w12.tiktok_url, null)
assert.equal(w12.video_start_sec, 57)

// applying it twice changes nothing more
const snap = JSON.stringify(db.prepare('SELECT * FROM combos ORDER BY id').all())
db.exec(MIGRATION)
assert.equal(JSON.stringify(db.prepare('SELECT * FROM combos ORDER BY id').all()), snap)

// every link it sets was checked live
const check = JSON.parse(readFileSync(join(ROOT, 'docs/library/video-check.json'), 'utf8')) as { links: Record<string, { status: string }> }
for (const m of MIGRATION.matchAll(/'(https:\/\/[^']+)'/g)) assert.equal(check.links[m[1]]?.status ?? (m[1] === 'https://www.youtube.com/watch?v=oSfNnSJWlMw' ? 'live' : 'missing'), 'live', m[1])

console.log('libraryVideos (0039) tests passed')
