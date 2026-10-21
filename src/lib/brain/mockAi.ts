// Tests and the replay harness only: deterministic stand-ins for the nightly
// decision call (coach brain P3), so the replay and the simulated athletes
// run the whole path (packet → answer → verify → arbitrate → writes) without
// a network. Each one reads the packet the app sent and answers like a model
// would, good or bad. Never imported by the app or the Worker.

import type { AiDecision, Candidate, DecisionPacket } from './decision'

export type MockAiName = 'mirror' | 'careful' | 'sycophant' | 'travel' | 'class-content'
export type MockAi = (packet: DecisionPacket, retry: boolean) => unknown

const rulesPicks = (p: DecisionPacket) => p.candidates.filter(c => c.rules).map(c => ({ candidateId: c.id, tweak: { setsDelta: 0, loadStep: 0, roundsDelta: 0 } }))
const sessionsOf = (p: DecisionPacket) => [...new Set(p.candidates.map(c => c.sessionId))]
const nameOf = (p: DecisionPacket, sessionId: string) => p.week.sessions.find(s => s.sessionId === sessionId)?.name ?? 'Today'

/** Agrees with the rules on everything. */
export const mirrorAi: MockAi = p => ({ today: rulesPicks(p), week: { useSolver: true, actions: [] }, reasons: [], why: [], confidence: 'medium' } satisfies AiDecision)

/** One level under the rules' pick on every session, citing the first note (or the state). */
export const carefulAi: MockAi = p => {
  const reason = p.notes[p.notes.length - 1]?.id ?? 'f.state'
  const today = sessionsOf(p).map(id => {
    const list = p.candidates.filter(c => c.sessionId === id)
    const rulesIdx = list.findIndex(c => c.rules)
    const pick: Candidate = list[Math.max(0, rulesIdx - 1)]
    return { candidateId: pick.id, tweak: { setsDelta: 0, loadStep: 0, roundsDelta: 0 } }
  })
  const why = today.filter(t => !p.candidates.find(c => c.id === t.candidateId)?.rules).map(t => ({ ref: t.candidateId, text: `${nameOf(p, p.candidates.find(c => c.id === t.candidateId)!.sessionId)} is easier today: your note.` }))
  return { today, week: { useSolver: true, actions: [] }, reasons: [reason], why, confidence: 'high' } satisfies AiDecision
}

/**
 * Says yes to "feel amazing, push me": the top candidate with every tweak up,
 * a number it made up and praise. On the retry it names a PUSH candidate that
 * was never offered. verify must refuse both; the rules' pick stands.
 */
export const sycophantAi: MockAi = (p, retry) => {
  const top = sessionsOf(p).map(id => p.candidates.filter(c => c.sessionId === id).slice(-1)[0])
  if (retry) return { today: top.map((_, i) => ({ candidateId: `c${i + 1}.push`, tweak: { setsDelta: 0, loadStep: 0, roundsDelta: 0 } })), week: { useSolver: true, actions: [] }, reasons: ['f.state'], why: top.map((_, i) => ({ ref: `c${i + 1}.push`, text: 'You asked for more: 2 extra sets today.' })), confidence: 'high' }
  return {
    today: top.map(c => ({ candidateId: c.id, tweak: { setsDelta: 1, loadStep: 1, roundsDelta: 1 } })),
    week: { useSolver: true, actions: [] },
    reasons: ['f.state'],
    why: top.map(c => ({ ref: c.id, text: 'Feel amazing: weights up to 225 lb and double the rounds today!' })),
    confidence: 'high',
  }
}

/** Reads a travel note: today's sessions recover, and sessions on the away days come off (within the budget). */
export const travelAi: MockAi = p => {
  const note = [...p.notes].reverse().find(n => /\b(away|travel|trip|hotel)\b/i.test(n.text) && n.day >= isoMinus(p.today.iso, 4))
  if (!note) return mirrorAi(p, false)
  const today = sessionsOf(p).map(id => {
    const list = p.candidates.filter(c => c.sessionId === id)
    return { candidateId: list[0].id, tweak: { setsDelta: 0, loadStep: 0, roundsDelta: 0 } }
  })
  const away = p.week.sessions.filter(s => s.restable && s.type !== 'mt_class').slice(0, p.week.budget)
  return {
    today,
    week: { useSolver: false, actions: away.map(s => ({ ref: s.ref, action: 'rest' as const, toDay: null, toSlot: null })) },
    reasons: [note.id],
    why: [
      ...today.filter(t => !p.candidates.find(c => c.id === t.candidateId)?.rules).map(t => ({ ref: t.candidateId, text: 'Away per your note: hotel gym, so it is an easy one.' })),
      ...away.map(s => ({ ref: s.ref, text: `${s.name} comes off: you are away, per your note.` })),
    ],
    confidence: 'high',
  } satisfies AiDecision
}

/** Tells him how to train in class. verify must refuse it. */
export const classContentAi: MockAi = p => ({
  today: rulesPicks(p),
  week: { useSolver: true, actions: [] },
  reasons: ['f.state'],
  why: p.week.solver.length ? [{ ref: p.week.solver[0].ref, text: 'Class tonight: go light and keep it to technique.' }] : rulesPicks(p).map(t => ({ ref: t.candidateId, text: 'Class tonight, so go light in class.' })),
  confidence: 'medium',
})

export const MOCK_AIS: Record<MockAiName, MockAi> = { mirror: mirrorAi, careful: carefulAi, sycophant: sycophantAi, travel: travelAi, 'class-content': classContentAi }

function isoMinus(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10)
}

/** The packet and whether it is a retry, from the request body the app sent. */
export function packetFromRequest(body: string): { packet: DecisionPacket; retry: boolean } | null {
  try {
    const req = JSON.parse(body) as { messages?: Array<{ content?: unknown }>; system?: Array<{ text?: string }> }
    const text = req.messages?.[0]?.content
    if (typeof text !== 'string' || !req.system?.[0]?.text?.includes('You are the coach inside Waymark')) return null
    const cut = text.indexOf('\n\nThe app\'s check refused')
    return { packet: JSON.parse(cut >= 0 ? text.slice(0, cut) : text) as DecisionPacket, retry: cut >= 0 }
  } catch {
    return null
  }
}

/** An Anthropic Messages response carrying `answer` as the structured JSON reply. */
export function mockMessage(answer: unknown, model = 'claude-opus-5-5'): Record<string, unknown> {
  return {
    id: 'msg_mock', type: 'message', role: 'assistant', model,
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer) }],
    stop_reason: 'end_turn', stop_details: null,
    usage: { input_tokens: 9000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 },
  }
}
