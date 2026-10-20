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
