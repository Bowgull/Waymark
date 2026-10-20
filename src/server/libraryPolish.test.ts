// Run: tsx src/server/libraryPolish.test.ts
// 0040 (page 65, approved by Josh 2026-10-20) on a real in-memory database:
// every migration, then the seed (the Library as production has it), then
// 0040's rows once more, as wrangler would apply them on top. Additive only:
// new nullable columns and three rows by id; the cues and hints stay whole.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const ROOT = process.cwd()
const MIGRATION = readFileSync(join(ROOT, 'drizzle/0040_library_polish.sql'), 'utf8')
const statements = MIGRATION.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('--'))
for (const s of statements) assert.match(s, /^(ALTER TABLE (exercises|techniques|run_types) ADD COLUMN \w+ TEXT|UPDATE (exercises|techniques|run_types) SET \w+ = '.+' WHERE id = '[a-z0-9-]+');$/, `additive only: ${s.slice(0, 80)}`)
assert.doesNotMatch(MIGRATION, /\b(DELETE|DROP|INSERT)\b/i, 'nothing wiped')

const files = readdirSync(join(ROOT, 'drizzle')).filter(n => n.endsWith('.sql')).sort()
assert.equal(files[files.indexOf('0039_library_videos.sql') + 1], '0040_library_polish.sql', '0040 follows 0039')

// the seed carries the same rows (its INSERT OR REPLACE would drop them)
const seed = readFileSync(join(ROOT, 'src/db/seed.sql'), 'utf8')
for (const s of statements.filter(x => x.startsWith('UPDATE'))) assert.ok(seed.includes(s), `seed.sql has: ${s.slice(0, 80)}`)

const db = new Database(':memory:')
for (const f of files) db.exec(readFileSync(join(ROOT, 'drizzle', f), 'utf8').replace(/--> statement-breakpoint/g, '').replace(/INSERT INTO `__new_\w+`[^;]*;/g, ''))
db.exec(seed)
const one = <T>(sql: string, id: string) => db.prepare(sql).get(id) as T
assert.equal(one<{ cue_line: string }>('SELECT cue_line FROM techniques WHERE id = ?', 'tech-jab').cue_line, 'Lead hand straight out, turn the fist over, straight back to the chin.')
assert.equal(one<{ cue_line: string }>('SELECT cue_line FROM run_types WHERE id = ?', 'run-walk').cue_line, 'Walk before you need to.')
const squat = one<{ coach_note: string; coach_hint: string; form_cues: string; cue_line: string | null }>('SELECT coach_note, coach_hint, form_cues, cue_line FROM exercises WHERE id = ?', 'ex-front-squat')
assert.equal(squat.coach_note, 'Your main squat from week 3. Sets of 8, 2–3 reps left.')
assert.match(squat.coach_hint, /^Your main squat\. Goblet squats/, 'the full hint stays')
assert.equal(squat.cue_line, null, "the squat's line is its cue's first sentence (worked out in the app)")
assert.ok(squat.form_cues.length > 0, 'the cue stays')
console.log('libraryPolish (0040) tests passed')
