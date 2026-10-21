/**
 * Coach brain P3 live check: the nightly decision call against the REAL
 * Claude API, on packets from the MADE-UP simulated athletes (never real
 * data). NOT part of any test run: it spends real money (about $0.10-0.20 a
 * call).
 *
 *   npx tsx scripts/brain-livecheck.mts [--max-calls 8] [--dry-run]
 *
 * Runs four simulated athletes (bad week, sycophancy probe, travel, great
 * week) through the replay harness with the decision call answered by a
 * stand-in that keeps each night's packet, picks one interesting night from
 * each, then sends those packets to claude-opus-5-5 exactly as the Worker
 * would (server/coachDecision.ts: retry on a refused answer included). Prints
 * the answer, verify's verdict, what arbitrate keeps, tokens and cost.
 *
 * Reads ANTHROPIC_API_KEY from .dev.vars at the repo root (or the file named
 * in WAYMARK_DEV_VARS) at run time. Never prints or writes the key.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { migratedSqlite } from '../src/server/replay/db'
import { runReplay } from '../src/server/replay/driver'
import { SCENARIOS } from '../src/lib/coach/replay/scenarios'
import { mirrorAi } from '../src/lib/brain/mockAi'
import { arbitrate, type DecisionPacket } from '../src/lib/brain/decision'
import { callDecision } from '../src/server/coachDecision'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const DRY = process.argv.includes('--dry-run')
const MAX_CALLS = Number(arg('--max-calls', '8'))

function readKey(): string {
  const file = process.env.WAYMARK_DEV_VARS ?? join(process.cwd(), '.dev.vars')
  if (!existsSync(file)) return ''
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find(l => l.startsWith('ANTHROPIC_API_KEY='))
  return line ? line.slice('ANTHROPIC_API_KEY='.length).trim().replace(/^"|"$/g, '') : ''
}

/** Which night to take from each athlete. */
const PICK: Record<string, (p: DecisionPacket) => boolean> = {
  'bad-week': p => p.candidates.length > 0 && (p.state.state === 'AMBER' || p.state.state === 'RED'),
  sycophancy: p => p.candidates.some(c => c.sessionType === 'strength') && p.notes.some(n => /amazing/i.test(n.text)),
  travel: p => p.notes.some(n => /away/i.test(n.text) && Date.parse(p.today.iso) - Date.parse(n.day) <= 86400000) && p.week.sessions.some(s => s.restable),
  'great-week': p => p.candidates.some(c => c.sessionType === 'foundation_run') && p.today.iso >= '2027-01-11',
}

const packets: Array<{ id: string; packet: DecisionPacket }> = []
for (const s of SCENARIOS.filter(x => PICK[x.id])) {
  const sqlite = migratedSqlite(':memory:')
  sqlite.prepare(`INSERT OR REPLACE INTO user_profile (id, goals, injuries, posture_issues, mt_cap_per_week, dob, created_at, updated_at)
    VALUES ('default', 'Muay thai, strength, a 10k.', '["lower_back_sensitivity"]', '[]', 3, '1990-06-01', 1798000000, 1798000000)`).run()
  sqlite.prepare(`UPDATE settings SET mt_class_days = '1,3,5'`).run()
  const seen: DecisionPacket[] = []
  await runReplay(sqlite, s.script, { decisionAi: (p, retry) => { if (!retry) seen.push(p); return mirrorAi(p, retry) } })
  sqlite.close()
  const pick = seen.find(PICK[s.id])
  if (pick) packets.push({ id: s.id, packet: pick })
  else console.log(`${s.id}: no night matched`)
}

const key = DRY ? '' : readKey()
if (!DRY && !key) { console.log('No ANTHROPIC_API_KEY in .dev.vars: nothing sent.'); process.exit(1) }
let calls = 0
let total = 0
const neutral = { best: 0, base: 0, baseViolations: 0, scoreOf: () => ({ score: 0, violations: 0 }) }
for (const { id, packet } of packets) {
  console.log(`\n== ${id} ${packet.today.iso} (${packet.state.state}${packet.state.why ? `: ${packet.state.why}` : ''})`)
  console.log(`   notes: ${packet.notes.slice(-3).map(n => `[${n.id}] ${n.text}`).join(' | ') || 'none'}`)
  console.log(`   candidates: ${packet.candidates.map(c => `${c.id}${c.rules ? '*' : ''} ${c.dose}`).join(' || ').slice(0, 600)}`)
  console.log(`   solver: ${packet.week.solver.map(w => `${w.ref} ${w.kind} ${w.session ?? ''} ${w.why}`).join(' | ') || 'none'}`)
  if (DRY) { console.log(`   packet ${JSON.stringify(packet).length} chars`); continue }
  if (calls >= MAX_CALLS) { console.log('   skipped: call budget used'); continue }
  const out = await callDecision(key, packet, Math.min(2, MAX_CALLS - calls))
  calls += out.calls
  total += out.costUsd
  console.log(`   model ${out.model ?? '-'} | calls ${out.calls} | ${Math.round(out.latencyMs / 1000)} s | in ${out.usage.input_tokens} out ${out.usage.output_tokens} cache_read ${out.usage.cache_read_input_tokens} cache_write ${out.usage.cache_creation_input_tokens} | $${out.costUsd.toFixed(4)}${out.offline ? ' | OFFLINE' : ''}`)
  console.log(`   answer: ${JSON.stringify(out.raw)}`)
  if (out.errors.length) console.log(`   verify refused: ${out.errors.join(' ; ')}`)
  if (out.verified?.decision) {
    const f = arbitrate(packet, out.verified.decision, neutral)
    console.log(`   arbitrate: ${f.source}; today ${f.today.map(t => `${t.candidateId} ${t.from}${t.why ? ` "${t.why}"` : ''}`).join(', ') || '-'}; week ${f.week.from} ${JSON.stringify(f.week.actions)} ${JSON.stringify(f.week.why)}`)
  }
}
console.log(`\n${calls} live calls, about $${total.toFixed(3)}.`)
