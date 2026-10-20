/**
 * Coach-brain P0 replay (coach-brain.md §12.1): Josh's real history through
 * today's coach, on a COPY of a backup. Never production, never the repo.
 *
 *   npx tsx scripts/replay.mts --dump <backup.sql> --out <dir outside the repo> [--mode may-june|october]
 *
 * may-june (default): a fresh scratch database with the migrations and the
 *   library, Block Zero started on 2026-05-16, then every check-in, session,
 *   set and run he logged from 2026-05-16 to 2026-06-30 fed in on its day,
 *   with the nightly job at 10:00 UTC each day. What the coach prescribed at
 *   each start, every change it made and every AI call it tried are written
 *   to <out>/replay-may-june.json.
 * october: the whole backup copied as is (his real Block Zero, started
 *   2026-10-20 after the June lapse), then a scripted Josh who does every
 *   planned session as prescribed with steady check-ins, 2026-10-20 to
 *   2026-11-22. This is the block start the double-easing finding is about.
 *
 * The output holds his personal data: --out must sit outside the repo
 * (the script refuses a path inside it). AI calls are counted and answered
 * offline; no network request leaves the process.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import Database from 'better-sqlite3'
import { reorderDump } from './d1-dump-reorder'
import { migratedSqlite } from '../src/server/replay/db'
import { runReplay } from '../src/server/replay/driver'
import { scriptFromHistory, type History } from '../src/lib/coach/replay/history'
import { replayLines, easeStack } from '../src/lib/coach/replay/metrics'
import type { ReplayScript } from '../src/lib/coach/replay/types'
import { isoToEpochDay } from '../src/lib/dates'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const dump = arg('--dump')
const out = arg('--out')
const mode = arg('--mode', 'may-june')
if (!dump || !out) {
  console.error('usage: npx tsx scripts/replay.mts --dump <backup.sql> --out <dir outside the repo> [--mode may-june|october]')
  process.exit(1)
}
const repo = resolve(process.cwd())
const outDir = resolve(out)
const rel = relative(repo, outDir)
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  console.error(`--out ${outDir} is inside the repo. Personal data stays outside it.`)
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const TORONTO_SUMMER = -240

/** The backup, reordered and loaded into its own scratch SQLite (read-only source). */
function loadBackup(path: string): Database.Database {
  if (existsSync(path)) unlinkSync(path)
  const sqlite = new Database(path)
  sqlite.pragma('foreign_keys = OFF')
  sqlite.exec(`BEGIN;${reorderDump(readFileSync(dump!, 'utf8'))};COMMIT;`)
  sqlite.pragma('foreign_keys = ON')
  return sqlite
}

function readHistory(src: Database.Database): History {
  const all = <T>(sql: string) => src.prepare(sql).all() as T[]
  return {
    sessions: all(`SELECT id, type, status, scheduled_date AS scheduledDate, time_slot AS timeSlot, started_at AS startedAt, duration_sec AS durationSec, rpe, notes, skip_reason AS skipReason, skip_reason_detail AS skipReasonDetail FROM sessions`),
    sets: all(`SELECT e.session_id AS sessionId, e.exercise_id AS exerciseId, e.section, e.order_index AS orderIndex, st.set_number AS setNumber, st.weight_kg AS weightKg, st.reps, st.rir, st.is_warmup AS isWarmup
      FROM strength_sets st JOIN strength_session_exercises e ON e.id = st.session_exercise_id`),
    runs: all(`SELECT session_id AS sessionId, duration_sec AS durationSec, distance_km AS distanceKm, avg_hr AS avgHr, max_hr AS maxHr, is_indoor AS isIndoor FROM run_sessions`),
    logs: all(`SELECT log_date AS logDate, created_at AS createdAt, sleep_hours AS sleepHours, sleep_quality AS sleepQuality, energy, soreness, stress, mood, back_today AS backToday, alcohol_scale AS alcoholScale, herb_scale AS herbScale, notes FROM daily_logs`),
    notes: all(`SELECT date, type, content FROM journal_entries`),
  }
}

/** Copy his profile, settings and library rows into the replay database (not his training data). */
function copyReference(src: Database.Database, dst: Database.Database) {
  for (const table of ['user_profile', 'settings', 'exercises', 'combos', 'techniques', 'run_types']) {
    const rows = src.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
    const dstCols = new Set((dst.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name))
    for (const r of rows) {
      const cols = Object.keys(r).filter(c => dstCols.has(c))
      dst.prepare(`INSERT OR REPLACE INTO ${table} (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => r[c] as never))
    }
  }
}

let script: ReplayScript
let replayDb: Database.Database
if (mode === 'may-june') {
  const src = loadBackup(join(outDir, 'backup-copy.sqlite'))
  const from = isoToEpochDay('2026-05-16')
  const to = isoToEpochDay('2026-06-30')
  script = scriptFromHistory(readHistory(src), { name: 'may-june-2026', fromDay: from, toDay: to, tzOffsetMin: TORONTO_SUMMER, blockStartDay: from })
  replayDb = migratedSqlite(join(outDir, 'replay-may-june.sqlite'))
  copyReference(src, replayDb)
  src.close()
} else {
  // His real database as it stands (Block Zero waiting in its lead-in), copied whole.
  replayDb = loadBackup(join(outDir, 'replay-october.sqlite'))
  // Backups before 0042 lack library rows the code needs (ex-a-skips, the run-walk
  // warm-up: start-foundation-run answers 409 without it). Fill only missing library rows.
  const before = (replayDb.prepare('SELECT count(*) AS n FROM exercises').get() as { n: number }).n
  replayDb.exec(readFileSync(join(repo, 'src', 'db', 'seed.sql'), 'utf8').replace(/INSERT OR REPLACE INTO/g, 'INSERT OR IGNORE INTO'))
  const added = (replayDb.prepare('SELECT count(*) AS n FROM exercises').get() as { n: number }).n - before
  console.log(`library rows missing from the backup and filled in the copy: ${added} exercises`)
  const from = isoToEpochDay('2026-10-20')
  const to = isoToEpochDay('2026-11-22')
  const days = []
  for (let d = from; d <= to; d++) {
    days.push({
      day: d,
      actions: [
        { kind: 'checkin' as const, at: 6 * 60 + 20, log: { sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 3, mood: 3, backToday: 3, alcoholScale: 0, herbScale: 1 } },
        { kind: 'planned' as const, at: 6 * 60 + 40, pmAt: 18 * 60 + 30, rpe: { default: 5, strength: 6, foundation_run: 5, mobility: 3 }, lifts: { rir: 2 } },
      ],
    })
  }
  script = { name: 'october-restart-2026', fromDay: from, toDay: to, tzOffsetMin: TORONTO_SUMMER, days }
}

const result = await runReplay(replayDb, script)
replayDb.close()
const lines = replayLines(result)
const stack = easeStack(result.doses)
writeFileSync(join(outDir, `replay-${mode}.json`), JSON.stringify({ result, lines, stack }, null, 2))
console.log(`replay ${result.name}: ${result.days.length} days, ${result.doses.length} sessions started, ${result.changes.length} change rows, ${result.aiCalls.length} AI calls tried, ${result.errors.length} errors`)
for (const l of lines) console.log(`${!l.measured ? 'N/A ' : l.pass ? 'PASS' : 'FAIL'} ${l.id} ${l.title}: ${l.evidence}`)
console.log(`written: ${join(outDir, `replay-${mode}.json`)}`)
