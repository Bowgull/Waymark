// Run: tsx src/server/libraryRows.test.ts
// 0042: the library rows production never got. On a database with every
// migration (and no seed), the four rows are there, in their latest content;
// running the migration again changes nothing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { migratedSqlite } from './replay/db'
import { FR_WARMUP_TEMPLATE } from '../lib/mobilityTemplate'

const db = migratedSqlite(':memory:', { seedLibrary: false })
const row = (id: string) => db.prepare('SELECT id, name, video_start_sec AS start, merged_into AS merged FROM exercises WHERE id = ?').get(id) as { id: string; name: string; start: number | null; merged: string | null } | undefined
assert.equal(row('ex-a-skips')?.name, 'A-Skips')
assert.equal(row('ex-a-skips')?.start, 117, '0039\'s start time is in')
assert.equal(row('ex-spiderman-tspine')?.merged, 'ex-worlds-greatest-stretch', '0038\'s merge is in')
assert.ok(row('ex-walking-knee-hugs') && row('ex-walking-quad-pulls'))
const warmup = FR_WARMUP_TEMPLATE.map(t => t.exerciseId).filter(id => !row(id))
assert.deepEqual(warmup.filter(id => id === 'ex-a-skips'), [], 'the run-walk warm-up\'s A-Skips row exists without the seed')
const before = (db.prepare('SELECT count(*) AS n FROM exercises').get() as { n: number }).n
db.exec(readFileSync('drizzle/0042_library_missing_rows.sql', 'utf8'))
assert.equal((db.prepare('SELECT count(*) AS n FROM exercises').get() as { n: number }).n, before, 'running it again adds nothing')
console.log('ok: 0042 brings the missing library rows')

// 0057 and 0058 (rebuild Phases 4-5): the arm block, calves, shins, Copenhagen, Nordic and the landmine moves,
// on migrations alone, the seed the same; a second run changes nothing.
{
  const ids = ['ex-chin-up-band', 'ex-chin-up-negative', 'ex-chin-up', 'ex-dips', 'ex-close-grip-bench', 'ex-copenhagen-plank', 'ex-nordic-curl', 'ex-bent-knee-calf-raise',
    'ex-landmine-press', 'ex-lm-press-standing', 'ex-lm-reverse-lunge', 'ex-lm-sl-rdl', 'ex-lm-rdl', 'ex-lm-lateral-lunge', 'ex-lm-rainbow', 'ex-lm-punch', 'ex-lm-rotational-press', 'ex-lm-push-press',
    'ex-lm-squat', 'ex-lm-meadows-row', 'ex-lm-rotation', 'ex-lm-thruster', 'ex-lm-calf-raise']
  const get = (d: ReturnType<typeof migratedSqlite>, id: string) => d.prepare('SELECT name, equipment, form_cues AS cues, tips, form_video_url AS url, alt_video_url AS alt FROM exercises WHERE id = ?').get(id) as { name: string; equipment: string; cues: string; tips: string | null; url: string | null; alt: string | null } | undefined
  for (const id of ids) assert.ok(get(db, id)?.cues && get(db, id)?.tips, `${id}: cues and tips`)
  for (const id of ids.filter(i => /lm-|landmine/.test(i))) {
    const r = get(db, id)!
    assert.equal(r.equipment, 'landmine', `${id}: loaded on the bar end`)
    assert.ok(r.url?.startsWith('https://www.youtube.com/watch?v=') && r.alt, `${id}: a Library video and an alternate`)
  }
  // 0059 (rebuild Phase 8): the fighter strength rows get their Library videos too, a demo and a how-to.
  for (const id of ids.filter(i => !/lm-|landmine/.test(i))) {
    const r = get(db, id)!
    assert.ok(r.url?.startsWith('https://www.youtube.com/watch?v=') && r.alt?.startsWith('https://www.youtube.com/watch?v=') && r.url !== r.alt, `${id}: a Library video and an alternate (0059)`)
  }
  const videos = readFileSync('drizzle/0059_strength_row_videos.sql', 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('--'))
  assert.equal(videos.length, 8, 'one line per row')
  for (const l of videos) {
    assert.match(l, /^UPDATE exercises SET form_video_url = .+ WHERE id = 'ex-[a-z-]+';$/, 'by id, content only')
    assert.ok(readFileSync('src/db/seed.sql', 'utf8').includes(l), `seed.sql has: ${l.slice(-40)}`)
  }
  assert.equal(get(db, 'ex-landmine-press')?.name, 'Landmine Press', 'the old id is the press again')
  assert.equal(get(db, 'ex-single-leg-calf-raise')?.equipment, 'dumbbell', 'calves take a dumbbell')
  const n = (db.prepare('SELECT count(*) AS n FROM exercises').get() as { n: number }).n
  db.exec(readFileSync('drizzle/0057_fighter_strength_rows.sql', 'utf8'))
  db.exec(readFileSync('drizzle/0058_landmine_rows.sql', 'utf8'))
  assert.equal((db.prepare('SELECT count(*) AS n FROM exercises').get() as { n: number }).n, n, 'running them again adds nothing')
  const seeded = migratedSqlite(':memory:')
  for (const id of ids) assert.deepEqual(get(seeded, id), get(db, id), `${id}: the seed matches the migration`)
  console.log('ok: 0057, 0058 and 0059 bring the strength and landmine rows, with videos')
}
