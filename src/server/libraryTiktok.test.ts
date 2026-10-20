// Run: tsx src/server/libraryTiktok.test.ts
// 0041, the TikTok pass (approved by Josh 2026-10-20), on a real in-memory
// database: every migration, then the seed (the Library as production has it),
// then 0041 once more, as wrangler would apply it on top. Rows update by id;
// nothing is wiped; the eight TikTok mains carry their YouTube as the second
// link, with no start time; the six get the TikTok as the second link. The
// page reads it: WATCH on TikTok with "also on YouTube", and the reverse.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { coachName, hostOf, secondLink, videoButton } from '../lib/videoLinks'

const ROOT = process.cwd()
const MIGRATION = readFileSync(join(ROOT, 'drizzle/0041_library_tiktok.sql'), 'utf8')
const statements = MIGRATION.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('--'))
assert.equal(statements.length, 14, 'eight mains and six second links')
for (const s of statements) assert.match(s, /^UPDATE (combos|techniques) SET .+ WHERE id = '[a-z0-9-]+';$/, `only updates by id: ${s.slice(0, 80)}`)
assert.doesNotMatch(MIGRATION, /\b(DELETE|DROP|INSERT|ALTER)\b/i, 'nothing wiped, no schema change')
const seed = readFileSync(join(ROOT, 'src/db/seed.sql'), 'utf8')
for (const s of statements) assert.ok(seed.includes(s), `seed.sql has: ${s.slice(0, 80)}`)
const files = readdirSync(join(ROOT, 'drizzle')).filter(n => n.endsWith('.sql')).sort()
assert.equal(files[files.indexOf('0040_library_polish.sql') + 1], '0041_library_tiktok.sql', '0041 follows 0040')

// every row in it is one the pass approved (the CSV's proposed main / second)
const csv = readFileSync(join(ROOT, 'docs/library/library-tiktok-pass.csv'), 'utf8')
for (const id of ['combo-w01', 'combo-w06', 'combo-w04', 'combo-w02', 'combo-d06', 'combo-m03', 'combo-w12', 'tech-overhand', 'combo-f03', 'combo-w13', 'combo-d09', 'combo-m04', 'combo-d02', 'combo-f09']) {
  const line = csv.split(/\r?\n/).find(l => l.startsWith(`${id},`))
  assert.ok(line && /tiktok\.com/.test(line), `${id} is in the pass with a TikTok`)
  assert.ok(MIGRATION.includes(`WHERE id = '${id}';`), `${id} is updated`)
}

const db = new Database(':memory:')
for (const f of files) db.exec(readFileSync(join(ROOT, 'drizzle', f), 'utf8').replace(/--> statement-breakpoint/g, '').replace(/INSERT INTO `__new_\w+`[^;]*;/g, ''))
db.exec(seed)
const count = () => ['combos', 'techniques'].map(t => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n)
const before = count()
db.exec(MIGRATION)
assert.deepEqual(count(), before, 'no row added or removed')

type Row = { form_video_url: string; video_start_sec: number | null; video_source: string | null; video_length: string | null; video_status: string | null; tiktok_url: string | null; alt_video_url: string | null }
const row = (id: string) => db.prepare(`SELECT * FROM ${id.startsWith('tech-') ? 'techniques' : 'combos'} WHERE id = ?`).get(id) as Row
const field = (r: Row) => ({ url: r.form_video_url, startSec: r.video_start_sec, source: r.video_source, length: r.video_length, status: r.video_status, tiktokUrl: r.tiktok_url, altUrl: r.alt_video_url })

// TikTok main: no start time, the YouTube it replaced is the second link
const w01 = row('combo-w01')
assert.equal(hostOf(w01.form_video_url), 'tiktok')
assert.equal(w01.video_start_sec, null)
assert.equal(w01.video_length, '0:26')
assert.equal(w01.tiktok_url, 'https://www.youtube.com/watch?v=SOgUZwx5bw4&t=8')
const b = videoButton('jab cross rear roundhouse', field(w01))
assert.ok(b && b.host === 'tiktok' && b.label === 'WATCH ON TIKTOK' && b.start === null && b.href === w01.form_video_url)
assert.equal(coachName(b.source), 'Damien Trainor')
assert.deepEqual(secondLink(field(w01), b), { label: 'Also on YouTube', href: 'https://www.youtube.com/watch?v=SOgUZwx5bw4&t=8', who: null })
for (const id of ['combo-w06', 'combo-w04', 'combo-w02', 'combo-d06', 'combo-m03', 'combo-w12']) {
  const r = row(id)
  assert.ok(hostOf(r.form_video_url) === 'tiktok' && r.video_start_sec === null && r.tiktok_url && hostOf(r.tiktok_url) === 'youtube', `${id}: TikTok main, YouTube second`)
}
// tech-overhand: its YouTube is the second link and the backup
const oh = row('tech-overhand')
assert.equal(hostOf(oh.form_video_url), 'tiktok')
assert.equal(oh.tiktok_url, 'https://www.youtube.com/watch?v=rTTEn0RQQsw&t=57')
assert.equal(oh.alt_video_url, 'https://www.youtube.com/watch?v=rTTEn0RQQsw&t=57')
assert.equal(videoButton('overhand', { ...field(oh), status: 'dead' })?.href, oh.alt_video_url, 'a dead TikTok falls back to the YouTube')

// TikTok second: the YouTube main stays, start time and all
const f09 = row('combo-f09')
assert.equal(f09.form_video_url, 'https://www.youtube.com/watch?v=Bp_QVO7kYtg')
assert.equal(f09.video_start_sec, 4)
assert.equal(f09.tiktok_url, 'https://www.tiktok.com/@fighttips/video/7660290014294723854')
const fb = videoButton('teep', field(f09))
assert.deepEqual(secondLink(field(f09), fb), { label: 'Also on TikTok', href: f09.tiktok_url, who: 'fighttips' })
for (const id of ['combo-f03', 'combo-w13', 'combo-d09', 'combo-m04', 'combo-d02']) {
  const r = row(id)
  assert.ok(hostOf(r.form_video_url) === 'youtube' && r.tiktok_url && hostOf(r.tiktok_url) === 'tiktok', `${id}: YouTube main, TikTok second`)
}
console.log('libraryTiktok (0041) tests passed')
