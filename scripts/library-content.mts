/**
 * The Library's content (page 60, approved 2026-10-19, all 13 items) from the
 * proposal CSV (docs/library/library-content-proposal.csv, 177 rows).
 *
 *   npx tsx scripts/library-content.mts           writes drizzle/0038_library_content.sql
 *                                                  and src/db/libraryContent.sql (appended to seed.sql)
 *   npx tsx scripts/library-content.mts --check   checks every proposed link live first
 *                                                  (YouTube oEmbed, the TikTok page's statusCode),
 *                                                  about one call a second, and writes the result
 *                                                  to docs/library/link-check.json
 *
 * Content only: rows are updated by id, techniques and run types are new rows
 * (INSERT OR IGNORE). No user data is touched.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkLink, parseStart, type VideoStatus } from '../src/lib/videoLinks'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSV = join(ROOT, 'docs/library/library-content-proposal.csv')
const CHECK = join(ROOT, 'docs/library/link-check.json')

// ─── CSV ──────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows.filter(r => r.length > 1)
  const keys = head.map(h => h.replace(/^\uFEFF/, ''))
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

const rows = parseCsv(readFileSync(CSV, 'utf8'))
if (rows.length !== 177) throw new Error(`expected 177 rows, got ${rows.length}`)

const tiktok = (v: string) => (v.match(/https:\/\/www\.tiktok\.com\/\S+/)?.[0] ?? '') || null
const sq = (v: string | number | null | undefined) => (v == null || v === '' ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

// ─── the link check (before committing) ───────────────────────

async function check(): Promise<Record<string, VideoStatus>> {
  const urls = new Set<string>()
  for (const r of rows) for (const u of [r.proposed_video, r.alt_video, tiktok(r.tiktok)]) if (u) urls.add(u)
  const out: Record<string, VideoStatus> = existsSync(CHECK) ? JSON.parse(readFileSync(CHECK, 'utf8')).status ?? {} : {}
  let n = 0
  for (const u of urls) {
    if (out[u] === 'live') continue
    out[u] = await checkLink(u, (url, init) => fetch(url, init))
    n++
    if (n % 25 === 0) console.log(`checked ${n}`)
    await new Promise(r => setTimeout(r, 1100))
  }
  const counts = Object.values(out).reduce<Record<string, number>>((m, s) => { m[s] = (m[s] ?? 0) + 1; return m }, {})
  writeFileSync(CHECK, JSON.stringify({ checkedAt: new Date().toISOString(), counts, status: out }, null, 2) + '\n')
  console.log(`link check: ${JSON.stringify(counts)}`)
  return out
}

// ─── techniques and run types ─────────────────────────────────

const TECH_KIND: Record<string, string> = {
  'tech-jab': 'Punch', 'tech-cross': 'Punch', 'tech-lead-hook': 'Punch', 'tech-overhand': 'Punch', 'tech-switch-hook': 'Punch',
  'tech-teep': 'Kick', 'tech-switch-teep': 'Kick', 'tech-roundhouse': 'Kick', 'tech-switch-kick': 'Kick', 'tech-low-kick': 'Kick',
  'tech-inside-low-kick': 'Kick', 'tech-axe-kick': 'Kick', 'tech-question-mark': 'Kick', 'tech-spinning-back-kick': 'Kick',
  'tech-straight-knee': 'Knee', 'tech-step-knee': 'Knee', 'tech-horizontal-elbow': 'Elbow', 'tech-diagonal-elbow': 'Elbow',
  'tech-check': 'Defence', 'tech-slip': 'Defence', 'tech-parry': 'Defence', 'tech-feint': 'Feint', 'tech-pivot': 'Footwork',
}

/** Each run type's line under its name (page 52 / 60: "Run · easy, walks planned in"), and the plan's runType key. */
const RUN_META: Record<string, { sub: string; key: string }> = {
  'run-walk': { sub: 'easy, walks planned in', key: 'run_walk' },
  'run-zone2': { sub: 'easy, heart rate capped', key: 'zone2' },
  'run-easy': { sub: 'easy, at a talking pace', key: 'easy' },
  'run-strides': { sub: 'easy, with short fast strides', key: 'easy_strides' },
  'run-tempo': { sub: 'steady, comfortably hard', key: 'tempo' },
  'run-intervals': { sub: 'hard repeats with rests', key: 'intervals' },
  'run-5k-test': { sub: 'a timed 5 km', key: '5k_test' },
}

function aliasesOf(problems: string): string[] {
  const m = /covers combo names:\s*(.+)$/.exec(problems)
  return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : []
}

// ─── the SQL ──────────────────────────────────────────────────

function videoSet(r: Record<string, string>, status: Record<string, VideoStatus>, checkedAt: number): string {
  const v = r.proposed_video || null
  const st = (u: string | null) => (u ? status[u] ?? 'unchecked' : null)
  return [
    `form_video_url = ${sq(v)}`,
    `video_start_sec = ${sq(parseStart(r.start))}`,
    `video_source = ${sq(v ? r.proposed_channel : null)}`,
    `video_title = ${sq(v ? r.proposed_title : null)}`,
    `video_length = ${sq(v ? r.proposed_length : null)}`,
    `video_status = ${sq(st(v))}`,
    `video_checked_at = ${v ? checkedAt : 'NULL'}`,
    `alt_video_url = ${sq(r.alt_video || null)}`,
    `alt_video_source = ${sq(r.alt_video ? r.alt_channel : null)}`,
    `alt_video_status = ${sq(st(r.alt_video || null))}`,
    `tiktok_url = ${sq(tiktok(r.tiktok))}`,
    `coach_hint = ${sq(r.coach_hint)}`,
  ].join(', ')
}

function contentSql(status: Record<string, VideoStatus>, checkedAt: number): string[] {
  const out: string[] = []
  let ti = 0
  let ri = 0
  for (const r of rows) {
    const kind = r.kind
    if (kind === 'Combo') {
      const cue = r.proposed_cue.replace(/^CUE flap:\s*/i, '')
      out.push(`UPDATE combos SET cue = ${sq(cue)}, form_tips = ${sq(r.proposed_tips)}, ${videoSet(r, status, checkedAt)} WHERE id = ${sq(r.id)};`)
    } else if (kind.startsWith('Technique')) {
      const aliases = aliasesOf(r.problems)
      out.push(`INSERT OR IGNORE INTO techniques (id, name, kind, aliases, sort, created_at) VALUES (${sq(r.id)}, ${sq(r.name)}, ${sq(TECH_KIND[r.id] ?? 'Strike')}, ${sq(JSON.stringify(aliases))}, ${ti++}, ${checkedAt});`)
      out.push(`UPDATE techniques SET cue = ${sq(r.proposed_cue)}, tips = ${sq(r.proposed_tips)}, ${videoSet(r, status, checkedAt)} WHERE id = ${sq(r.id)};`)
    } else if (kind.startsWith('Run')) {
      const meta = RUN_META[r.id]
      if (!meta) throw new Error(`no run meta for ${r.id}`)
      out.push(`INSERT OR IGNORE INTO run_types (id, name, run_type, sub, sort, created_at) VALUES (${sq(r.id)}, ${sq(r.name)}, ${sq(meta.key)}, ${sq(meta.sub)}, ${ri++}, ${checkedAt});`)
      out.push(`UPDATE run_types SET what = ${sq(r.proposed_cue)}, tips = ${sq(r.proposed_tips)}, ${videoSet(r, status, checkedAt)} WHERE id = ${sq(r.id)};`)
    } else {
      // an exercise: the cue in plain words, up to 3 tips, the coach hint, the video (and the rename: Psoas March)
      out.push(`UPDATE exercises SET name = ${sq(r.name)}, form_cues = ${sq(r.proposed_cue)}, tips = ${sq(r.proposed_tips)}, ${videoSet(r, status, checkedAt)} WHERE id = ${sq(r.id)};`)
    }
  }
  // tidy-up: Spiderman + T-Spine is the World's Greatest Stretch; it folds into it (kept for history)
  out.push(`UPDATE exercises SET merged_into = 'ex-worlds-greatest-stretch' WHERE id = 'ex-spiderman-tspine';`)
  return out
}

const SCHEMA = `-- The full Library and its content (pages 52 and 60, approved 2026-10-19).
-- Generated by scripts/library-content.mts from docs/library/library-content-proposal.csv.
--
-- Additive only: new nullable columns, three new tables, and content rows
-- updated by id (cues, tips, coach hints, videos). New techniques and run
-- types are INSERT OR IGNORE. No user data is touched or wiped.
--
-- Videos: YouTube first, TikTok only as an optional second link; they open
-- outside the app. video_status is the weekly link check's verdict
-- (server/linkHealth.ts); a dead link falls back to the backup, then the
-- technique's video, then a YouTube search. Replacements are proposed in
-- video_reviews and wait for Josh's OK.

ALTER TABLE exercises ADD COLUMN tips TEXT;
ALTER TABLE exercises ADD COLUMN coach_hint TEXT;
ALTER TABLE exercises ADD COLUMN video_start_sec INTEGER;
ALTER TABLE exercises ADD COLUMN video_source TEXT;
ALTER TABLE exercises ADD COLUMN video_title TEXT;
ALTER TABLE exercises ADD COLUMN video_length TEXT;
ALTER TABLE exercises ADD COLUMN video_status TEXT;
ALTER TABLE exercises ADD COLUMN video_checked_at INTEGER;
ALTER TABLE exercises ADD COLUMN alt_video_url TEXT;
ALTER TABLE exercises ADD COLUMN alt_video_source TEXT;
ALTER TABLE exercises ADD COLUMN alt_video_status TEXT;
ALTER TABLE exercises ADD COLUMN tiktok_url TEXT;
-- Folded into another item (Spiderman + T-Spine into the World's Greatest Stretch): hidden from the Library.
ALTER TABLE exercises ADD COLUMN merged_into TEXT;

-- Combos get a video (and their cue flap, kept to 4 words and 20 characters).
ALTER TABLE combos ADD COLUMN cue TEXT;
ALTER TABLE combos ADD COLUMN coach_hint TEXT;
ALTER TABLE combos ADD COLUMN form_video_url TEXT;
ALTER TABLE combos ADD COLUMN video_start_sec INTEGER;
ALTER TABLE combos ADD COLUMN video_source TEXT;
ALTER TABLE combos ADD COLUMN video_title TEXT;
ALTER TABLE combos ADD COLUMN video_length TEXT;
ALTER TABLE combos ADD COLUMN video_status TEXT;
ALTER TABLE combos ADD COLUMN video_checked_at INTEGER;
ALTER TABLE combos ADD COLUMN alt_video_url TEXT;
ALTER TABLE combos ADD COLUMN alt_video_source TEXT;
ALTER TABLE combos ADD COLUMN alt_video_status TEXT;
ALTER TABLE combos ADD COLUMN tiktok_url TEXT;

-- Techniques (new kind): the 23 real strikes behind the combos' 50 names.
-- aliases: the combo names that mean this one (JSON), so "Left Kick" shows the switch kick.
CREATE TABLE IF NOT EXISTS techniques (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  cue TEXT,
  tips TEXT,
  coach_hint TEXT,
  form_video_url TEXT,
  video_start_sec INTEGER,
  video_source TEXT,
  video_title TEXT,
  video_length TEXT,
  video_status TEXT,
  video_checked_at INTEGER,
  alt_video_url TEXT,
  alt_video_source TEXT,
  alt_video_status TEXT,
  tiktok_url TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Runs (new kind): the 7 run types, keyed by the plan's runType strings.
CREATE TABLE IF NOT EXISTS run_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  run_type TEXT NOT NULL,
  sub TEXT,
  what TEXT,
  tips TEXT,
  coach_hint TEXT,
  form_video_url TEXT,
  video_start_sec INTEGER,
  video_source TEXT,
  video_title TEXT,
  video_length TEXT,
  video_status TEXT,
  video_checked_at INTEGER,
  alt_video_url TEXT,
  alt_video_source TEXT,
  alt_video_status TEXT,
  tiktok_url TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- The weekly link check's findings: a dead link and its proposed replacement, for review.
-- Never applied by itself: Josh approves every content change.
CREATE TABLE IF NOT EXISTS video_reviews (
  id TEXT PRIMARY KEY,
  item_kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  url TEXT NOT NULL,
  found_dead_at INTEGER NOT NULL,
  proposal TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_reviews_item_url ON video_reviews (item_kind, item_id, url);
`

async function main() {
  const status = process.argv.includes('--check')
    ? await check()
    : (existsSync(CHECK) ? JSON.parse(readFileSync(CHECK, 'utf8')).status ?? {} : {})
  const checkedAt = existsSync(CHECK) ? Math.floor(Date.parse(JSON.parse(readFileSync(CHECK, 'utf8')).checkedAt) / 1000) : Math.floor(Date.now() / 1000)
  const content = contentSql(status, checkedAt)
  writeFileSync(join(ROOT, 'drizzle/0038_library_content.sql'), `${SCHEMA}\n-- ─── the content (by id) ───\n${content.join('\n')}\n`)
  writeFileSync(join(ROOT, 'src/db/libraryContent.sql'), `-- The Library's content (page 60), the same rows as drizzle/0038_library_content.sql.\n-- Appended to seed.sql so a fresh seed (INSERT OR REPLACE) keeps the approved content.\n${content.join('\n')}\n`)
  // the bag timer's cue flaps (comboCue.ts) from the approved content
  const cues = rows.filter(r => r.kind === 'Combo').map(r => [r.id, r.proposed_cue.replace(/^CUE flap:\s*/i, '')] as const)
  for (const [id, cue] of cues) if (cue.split(/\s+/).length > 4 || cue.length > 20) throw new Error(`cue too long for ${id}: ${cue}`)
  writeFileSync(join(ROOT, 'src/lib/comboCueContent.ts'), `// Generated by scripts/library-content.mts from the approved Library content (page 60).\n// The bag timer's cue flap per combo: 4 words, 20 characters at most.\nexport const COMBO_CUE_CONTENT: Readonly<Record<string, string>> = {\n${cues.map(([id, c]) => `  '${id}': '${c.replace(/'/g, "\\'")}',`).join('\n')}\n}\n`)
  console.log(`wrote 0038 (${content.length} statements), libraryContent.sql, comboCueContent.ts`)
}

void main()
