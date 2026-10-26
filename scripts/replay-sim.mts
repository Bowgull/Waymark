/**
 * Coach-brain P0: the simulated athletes (coach-brain.md §12.2) through
 * today's coach, each on its own in-memory database (made-up athlete, no real
 * data), with the doc's pass lines.
 *
 *   npx tsx scripts/replay-sim.mts [--out <dir>] [--only <id>] [--update] [--model] [--ai <mock>]
 *   npx tsx scripts/replay-sim.mts --suite 24wk [--weeks] [--only <id>]
 *
 * Rebuild Phase 1: --suite 24wk runs the 24-week true-athlete scenarios
 * (src/lib/coach/replay/scenarios24.ts) instead; --weeks prints each one's
 * week-by-week table (days, hard days, runs and km, long run, lifts against
 * his true numbers, bag, classes, longest session, spacing breaks).
 *
 * Coach brain P3: the nightly decision call is answered by a deterministic
 * stand-in (lib/brain/mockAi.ts): each scenario's own (travel reads the note,
 * the sycophancy probe says yes to everything), else mirror. --ai offline
 * answers it offline (rules only); --ai <name> uses that stand-in everywhere.
 *
 * Prints PASS / FAIL / N/A per line and compares with the committed baseline
 * (src/lib/coach/replay/baseline.json): a line that passed there must still
 * pass (exit 1 otherwise); a line that now passes and did not is reported as
 * an improvement. --update rewrites the baseline. --out writes each run's
 * full record as JSON. --model prints each athlete's model (coach brain P1,
 * shadow) as it stood after the last day.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { migratedSqlite } from '../src/server/replay/db'
import { runReplay } from '../src/server/replay/driver'
import { SCENARIOS } from '../src/lib/coach/replay/scenarios'
import { SIM24_SCENARIOS, type Scenario24 } from '../src/lib/coach/replay/scenarios24'
import { weekTable } from '../src/lib/coach/replay/metrics'
import { compareToBaseline, type Baseline } from '../src/lib/coach/replay/ratchet'
import type { PassLine } from '../src/lib/coach/replay/metrics'
import { MOCK_AIS, type MockAiName } from '../src/lib/brain/mockAi'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const out = arg('--out')
const only = arg('--only')
const aiArg = arg('--ai')
const suite = arg('--suite') === '24wk' ? SIM24_SCENARIOS : SCENARIOS
const BASELINE = join(process.cwd(), 'src', 'lib', 'coach', 'replay', 'baseline.json')

/** The made-up athlete every scenario starts from. */
function seedAthlete(sqlite: ReturnType<typeof migratedSqlite>) {
  const now = 1798000000
  sqlite.prepare(`INSERT OR REPLACE INTO user_profile (id, goals, injuries, posture_issues, mt_cap_per_week, dob, created_at, updated_at)
    VALUES ('default', 'Muay thai, strength, a 10k.', '["lower_back_sensitivity"]', '[]', 3, '1990-06-01', ?, ?)`).run(now, now)
  sqlite.prepare(`UPDATE settings SET mt_class_days = '1,3,5'`).run()
}

const results: Record<string, PassLine[]> = {}
if (out) mkdirSync(out, { recursive: true })
for (const s of suite.filter(x => !only || x.id === only)) {
  const sqlite = migratedSqlite(':memory:')
  seedAthlete(sqlite)
  const setup = (s as Scenario24).setup
  if (setup) sqlite.prepare(`UPDATE settings SET mt_class_days = ?, mt_class_slots = ?`).run(setup.mtClassDays, setup.mtClassSlots ?? null)
  const t0 = Date.now()
  const aiName = (aiArg ?? s.ai ?? 'mirror') as MockAiName | 'offline'
  const r = await runReplay(sqlite, s.script, { beforeDay: s.beforeDay as never, decisionAi: aiName === 'offline' ? undefined : MOCK_AIS[aiName] })
  sqlite.close()
  const lines = s.check(r)
  results[s.id] = lines
  console.log(`\n${s.id}: ${s.title} (${Math.round((Date.now() - t0) / 1000)} s, ${r.doses.length} sessions, ${r.changes.length} changes, ${r.aiCalls.length} AI calls tried, ${r.errors.length} errors)`)
  for (const l of lines) console.log(`  ${!l.measured ? 'N/A ' : l.pass ? 'PASS' : 'FAIL'} ${l.id} ${l.title}: ${l.evidence}`)
  const sources = new Map<string, number>()
  for (const d of r.decisions ?? []) sources.set(d.source, (sources.get(d.source) ?? 0) + 1)
  console.log(`  decisions (AI stand-in: ${aiName}): ${[...sources.entries()].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`)
  for (const e of r.errors.slice(0, 5)) console.log(`  error: ${e}`)
  if (process.argv.includes('--weeks') && (s as Scenario24).table) console.log(weekTable((s as Scenario24).table!).split('\n').map(x => `  ${x}`).join('\n'))
  if (process.argv.includes('--model')) for (const m of r.model?.summary ?? []) console.log(`  model ${m}`)
  if (out) writeFileSync(join(out, `sim-${s.id}.json`), JSON.stringify({ result: r, lines }, null, 2))
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
const cmp = compareToBaseline(baseline, results)
console.log(`\n${cmp.passing} of ${cmp.total} measured lines pass. Regressions: ${cmp.regressions.length}. Improvements: ${cmp.improvements.length}.`)
for (const r of cmp.regressions) console.log(`  REGRESSION ${r}`)
for (const r of cmp.improvements) console.log(`  improved ${r} (run with --update to record it)`)
if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify(cmp.next, null, 2) + '\n')
  console.log(`baseline written: ${BASELINE}`)
} else if (cmp.regressions.length > 0) {
  process.exit(1)
}
