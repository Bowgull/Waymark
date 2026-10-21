/**
 * The coach-brain eval set (approved 2026-10-21, idea 9), run by hand.
 *
 *   npx tsx scripts/coach-evals.mts [--ai <mock>|real] [--runs N] [--only id,id] [--max-calls N] [--key-file <path>] [--out <file outside the repo>]
 *
 * --ai: a stand-in from lib/brain/mockAi.ts (default mirror), or real: the
 *   nightly decision request exactly as the Worker sends it (claude-opus-5-5,
 *   strict schema, the playbook, the one corrective retry). The key comes
 *   from ANTHROPIC_API_KEY or --key-file (a .dev.vars-style file); it is never
 *   printed or written.
 * --runs: each night N times, for consistency (how often the final picks agree).
 * --max-calls: a hard cap on real calls (default 10); nights past it are skipped.
 *
 * Prints, per night, the weighted score (guards, rules, AI), the verify errors,
 * notebook proposals accepted and refused, and the cost. Made-up nights only.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { NIGHTS } from '../src/lib/brain/evals/nights'
import { consistency, runNight, score, type EvalRun } from '../src/lib/brain/evals/run'
import { MOCK_AIS, type MockAiName } from '../src/lib/brain/mockAi'
import { anthropicCall, getStructuredOutput } from '../src/lib/anthropic'
import { costUsd } from '../src/lib/brain/decision'
import { decisionRequest } from '../src/server/coachDecision'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const aiName = arg('--ai', 'mirror') as MockAiName | 'real'
const runs = Number(arg('--runs', '1'))
const only = arg('--only')?.split(',')
const maxCalls = Number(arg('--max-calls', '10'))
const out = arg('--out')
if (out) {
  const rel = relative(process.cwd(), resolve(out))
  if (!rel.startsWith('..') && !isAbsolute(rel)) { console.error('--out must sit outside the repo'); process.exit(1) }
}

function readKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  const file = arg('--key-file')
  if (!file) return ''
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find(l => /^\s*ANTHROPIC_API_KEY\s*=/.test(l))
  return line ? line.replace(/^\s*ANTHROPIC_API_KEY\s*=\s*/, '').replace(/^["']|["']$/g, '').trim() : ''
}

const key = aiName === 'real' ? readKey() : ''
if (aiName === 'real' && !key) { console.error('no key: set ANTHROPIC_API_KEY or --key-file'); process.exit(1) }

let calls = 0
let spent = 0
const quiet = console.log
const report: Array<Record<string, unknown>> = []
for (const n of NIGHTS.filter(x => !only || only.includes(x.id))) {
  const results: EvalRun[] = []
  for (let i = 0; i < runs; i++) {
    if (aiName === 'real' && calls >= maxCalls) break
    const r = await runNight(n, async (night, retry, last) => {
      if (aiName !== 'real') return MOCK_AIS[aiName](night.packet, retry != null)
      if (calls >= maxCalls) return null
      calls++
      console.log = () => {}
      const res = await anthropicCall(key, decisionRequest(night.packet, retry, last), { timeoutMs: 120_000 })
      console.log = quiet
      if (res.offline) return null
      spent += costUsd({ input_tokens: res.usage.input_tokens ?? 0, output_tokens: res.usage.output_tokens ?? 0, cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0, cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0 })
      return getStructuredOutput<unknown>(res)
    })
    results.push(r)
  }
  if (results.length === 0) { console.log(`${n.id}: skipped (call cap)`); continue }
  const s = results.map(r => ({ guard: score(r, n.criteria, 'guard'), rules: score(r, n.criteria, 'rules'), ai: score(r, n.criteria, 'ai') }))
  const avg = (k: 'guard' | 'rules' | 'ai') => (s.reduce((a, x) => a + x[k].score, 0) / s.length).toFixed(2)
  const last = results[results.length - 1]
  console.log(`${n.id}: ${n.title}`)
  console.log(`  guard ${avg('guard')} rules ${avg('rules')} ai ${avg('ai')}; consistency ${consistency(results).toFixed(2)} over ${results.length}; final ${last.final.source}: ${last.final.today.map(t => `${t.candidateId}${t.above ? ' (above)' : ''}`).join(', ')}${last.final.week.from === 'ai' ? `; week ${last.final.week.actions.map(a => `${a.action} ${a.ref}`).join(', ')}` : ''}`)
  if (last.ai?.why.length) console.log(`  why: ${last.ai.why.map(w => w.text).join(' | ')}`)
  if (last.verifyErrors.length) console.log(`  verify: ${last.verifyErrors.slice(0, 4).join(' | ')}`)
  if (last.notebook && (last.notebook.accepted.length || last.notebook.refused.length)) console.log(`  notebook: accepted ${last.notebook.accepted.map(a => a.op === 'add' ? `add "${a.claim}" [${a.evidence.map(e => e.id).join(', ')}]` : a.op).join('; ') || '-'}; refused ${last.notebook.refused.map(x => `${x.op} ${x.ref}: ${x.why}`).join('; ') || '-'}`)
  const failedAi = s.flatMap(x => x.ai.failed)
  if (failedAi.length) console.log(`  ai missed: ${[...new Set(failedAi)].join(', ')}`)
  report.push({ id: n.id, scores: s, consistency: consistency(results), finals: results.map(r => r.final), raw: results.map(r => r.raw), verify: results.map(r => r.verifyErrors), notebook: results.map(r => r.notebook) })
}
if (aiName === 'real') console.log(`\nreal calls: ${calls} (cap ${maxCalls}); cost about $${spent.toFixed(3)}`)
if (out) writeFileSync(out, JSON.stringify(report, null, 2))
