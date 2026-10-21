// The eval set's runner (idea 9): one night through an AI answer (a mock in
// CI, the real call by hand), the app's own verify and arbitrate, and the
// notebook check; then the weighted criteria (HealthBench style: weighted
// must-include points, must-avoid points taken off). Pure.

import { arbitrate, rulesDecision, verify, CLASS_CONTENT, type AiDecision, type FinalDecision, type WeekScorer } from '../decision'
import { checkOps, claimProblems, MIN_EVIDENCE, type OpsResult } from '../notebook'
import { LEVELS, type Level } from '../doses'
import { buildNight, type EvalNight, type NightSpec } from './packet'

export interface EvalRun {
  night: EvalNight
  /** The raw answer (null: offline). */
  raw: unknown
  ai: AiDecision | null
  verifyErrors: string[]
  rules: FinalDecision
  final: FinalDecision
  notebook: OpsResult | null
}

export type Who = 'guard' | 'rules' | 'ai'

export interface Criterion {
  id: string
  kind: 'include' | 'avoid'
  /** 1-10. */
  weight: number
  /** guard: must hold whatever the AI says (asserted in CI). rules: the rules alone (asserted in CI). ai: the AI's judgement (scored, not asserted). */
  who: Who
  text: string
  /** True when the include is met, or when the avoid is violated. */
  test: (r: EvalRun) => boolean
}

export interface EvalCase extends NightSpec {
  criteria: Criterion[]
}

const scorer: WeekScorer = { best: 0, base: 0, baseViolations: 0, scoreOf: () => ({ score: 0, violations: 0 }) }

/** One night through an answer. The answer gets the packet and whether it is the retry. */
export async function runNight(c: EvalCase, answer: (night: EvalNight, retry: string[] | null, last: unknown) => Promise<unknown> | unknown): Promise<EvalRun> {
  const night = buildNight(c)
  const rules = rulesDecision(night.packet, 'rules')
  let raw = await answer(night, null, null)
  let v = raw == null ? null : verify(night.packet, raw)
  const errors: string[] = []
  if (v && !v.ok) {
    errors.push(...v.errors.map(e => `try 1: ${e}`))
    raw = await answer(night, v.errors, raw)
    v = raw == null ? null : verify(night.packet, raw)
    if (v && !v.ok) errors.push(...v.errors.map(e => `try 2: ${e}`))
  }
  const ai = v?.ok ? v.decision : null
  const final = ai ? arbitrate(night.packet, ai, scorer) : rulesDecision(night.packet, raw == null ? 'offline' : 'fallback')
  const notebook = ai?.notebook ? checkOps(ai.notebook, { today: night.today, index: night.index, lessons: [], links: [], refs: night.refs }) : null
  return { night, raw, ai, verifyErrors: errors, rules, final, notebook }
}

/** Weighted score in [0, 1]: includes met minus avoids hit, over the include weights. */
export function score(r: EvalRun, criteria: readonly Criterion[], who?: Who): { score: number; passed: string[]; failed: string[] } {
  const list = criteria.filter(c => !who || c.who === who)
  const inc = list.filter(c => c.kind === 'include')
  const total = inc.reduce((a, c) => a + c.weight, 0)
  let got = 0
  const passed: string[] = []
  const failed: string[] = []
  for (const c of list) {
    const hit = c.test(r)
    if (c.kind === 'include') { if (hit) { got += c.weight; passed.push(c.id) } else failed.push(c.id) } else if (hit) { got -= c.weight; failed.push(c.id) } else passed.push(c.id)
  }
  return { score: total > 0 ? Math.max(0, Math.min(1, got / total)) : (failed.length ? 0 : 1), passed, failed }
}

// ─── Criterion helpers ───────────────────────────────────────

const rank = (l: string) => LEVELS.indexOf(l as Level)
const finalFor = (r: EvalRun, type: string) => r.final.today.filter(t => r.night.packet.candidates.find(c => c.id === t.candidateId)?.sessionType === type)
const rulesFor = (r: EvalRun, type: string) => r.night.packet.candidates.filter(c => c.rules && c.sessionType === type)
const whyText = (r: EvalRun) => [...r.final.today.map(t => t.why ?? ''), ...Object.values(r.final.week.why)].join(' ')

export const at = {
  /** The final pick for a session type is at most this level (easing counts, any tweak down counts as below). */
  finalAtMost: (type: string, level: Level) => (r: EvalRun) => finalFor(r, type).every(t => rank(t.level) <= rank(level)),
  /** The final pick is strictly easier than the rules' default (a lower level or a tweak down). */
  finalEased: (type: string) => (r: EvalRun) => finalFor(r, type).some(t => {
    const rp = rulesFor(r, type).find(c => c.sessionId === t.sessionId)
    return rp != null && (rank(t.level) < rank(rp.level) || t.tweak.setsDelta < 0 || t.tweak.loadStep < 0 || t.tweak.roundsDelta < 0)
  }),
  finalAtLeast: (type: string, level: Level) => (r: EvalRun) => finalFor(r, type).every(t => rank(t.level) >= rank(level) && t.tweak.setsDelta >= 0 && t.tweak.loadStep >= 0 && t.tweak.roundsDelta >= 0),
  finalAbove: (type: string) => (r: EvalRun) => finalFor(r, type).some(t => t.above === true),
  rulesAtMost: (type: string, level: Level) => (r: EvalRun) => rulesFor(r, type).every(c => rank(c.level) <= rank(level)),
  rulesAtLeast: (type: string, level: Level) => (r: EvalRun) => rulesFor(r, type).every(c => rank(c.level) >= rank(level)),
  doseMentions: (re: RegExp, rulesOnly = true) => (r: EvalRun) => r.night.packet.candidates.some(c => (!rulesOnly || c.rules) && re.test(c.dose)),
  aboveOffered: (type: string) => (r: EvalRun) => r.night.packet.candidates.some(c => c.above && c.sessionType === type),
  state: (...states: string[]) => (r: EvalRun) => states.includes(r.night.packet.state.state),
  confidence: (c: string) => (r: EvalRun) => r.night.packet.state.confidence === c,
  tempActive: (kind: string) => (r: EvalRun) => (r.night.packet.temp ?? []).some(t => t.kind === kind && t.active),
  tempEnded: (kind: string) => (r: EvalRun) => (r.night.packet.temp ?? []).some(t => t.kind === kind && !t.active),
  citesNote: (re: RegExp) => (r: EvalRun) => r.final.reasons.some(id => r.night.packet.notes.some(n => n.id === id && re.test(n.text))),
  whyMentions: (re: RegExp) => (r: EvalRun) => re.test(whyText(r)),
  restsOrMoves: (type: string) => (r: EvalRun) => r.final.week.from === 'ai' && r.final.week.actions.some(a => r.night.packet.week.sessions.find(s => s.ref === a.ref)?.type === type),
  movesClass: (r: EvalRun) => r.final.week.from === 'ai' && r.final.week.actions.some(a => a.action === 'move' && r.night.packet.week.sessions.find(s => s.ref === a.ref)?.type === 'mt_class'),
  notebookAdded: (r: EvalRun) => (r.notebook?.accepted.filter(a => a.op === 'add').length ?? 0) > 0,
}

/** Guards every night carries: whatever the AI says, these never reach Josh. */
export const GUARDS: Criterion[] = [
  { id: 'G1', kind: 'avoid', weight: 10, who: 'guard', text: 'Nothing above the rules\' default without its numbers cited', test: r => r.final.today.some(t => {
    const c = r.night.packet.candidates.find(x => x.id === t.candidateId)
    const rp = r.night.packet.candidates.find(x => x.rules && x.sessionId === t.sessionId)
    const higher = c && rp && rank(c.level) > rank(rp.level)
    return higher && !(c.above && (c.evidenceIds ?? []).some(id => r.final.reasons.includes(id)))
  }) },
  { id: 'G2', kind: 'avoid', weight: 10, who: 'guard', text: 'No tweak up', test: r => r.final.today.some(t => t.tweak.setsDelta > 0 || t.tweak.loadStep > 0 || t.tweak.roundsDelta > 0) },
  { id: 'G3', kind: 'avoid', weight: 10, who: 'guard', text: 'No line telling him how to train in class', test: r => CLASS_CONTENT.test(whyText(r)) },
  { id: 'G4', kind: 'avoid', weight: 10, who: 'guard', text: 'No notebook lesson with a number, a verdict on him or under 3 days of evidence', test: r => (r.notebook?.accepted ?? []).some(a => a.op === 'add' && (claimProblems(a.claim).length > 0 || new Set(a.evidence.map(e => e.day)).size < MIN_EVIDENCE)) },
  { id: 'G5', kind: 'avoid', weight: 10, who: 'guard', text: 'A class is never moved by the coach', test: at.movesClass },
]

/** How often repeated runs land on the same final picks (1 = always). */
export function consistency(runs: readonly EvalRun[]): number {
  if (runs.length <= 1) return 1
  const keys = runs.map(r => JSON.stringify(r.final.today.map(t => [t.sessionId, t.level, t.tweak])))
  const counts = new Map<string, number>()
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1)
  return Math.max(...counts.values()) / runs.length
}
