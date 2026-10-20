// Class to combo (page 49 sections 1-3, approved 2026-10-19). After an MT
// class he writes what he learned in one box; every combo in it comes out as
// one line ("Combo: Jab, Cross, Lead hook") and is checked against his bag:
// IN YOUR BAG, NEW (ADD TO BAG / NOT NOW) or LOCKED (ADD TO BAG unlocks it).
// Strikes the app has no record of are named once and left out.
//
// Pure: no fetch, no DB. The server (routes/classCombos.ts) and the phone
// (offline) both use it. The technique list is derived from the combos
// themselves, so a strike is "known" when some combo in the library uses it.

export type StrikeCategory = 'boxing' | 'kicks' | 'defensive' | 'knees' | 'elbows'

/** Settings' order (page 37: BOXING, KICKS, DEFENSIVE, KNEES, ELBOWS). */
export const CATEGORY_ORDER: readonly StrikeCategory[] = ['boxing', 'kicks', 'defensive', 'knees', 'elbows']

export interface Technique {
  /** Lower-case, single spaces: "lead hook". */
  key: string
  /** As a found line prints it: "Lead hook". */
  name: string
  category: StrikeCategory
}

/** A combo in the library, as /api/combos returns it. */
export interface BagCombo {
  id: string
  text: string
  tier: string
  unlocked: number
  source?: string | null
}

/** One combo pulled out of the note: the techniques' names in order. */
export interface FoundCombo {
  strikes: string[]
}

export interface Extraction {
  combos: FoundCombo[]
  /** Strikes the app has no record of: named once, left out. */
  unknown: string[]
  /** Known strikes whose technique is switched off in Settings: named, left out. */
  off: string[]
}

export type FoundStatus = 'in_bag' | 'new' | 'locked'

export interface FoundLine {
  strikes: string[]
  status: FoundStatus
  /** The library's combo (in the bag or locked). */
  comboId: string | null
  /** IN YOUR BAG: "as Jab › Cross › Hook"; LOCKED: "In Weapons, locked"; NEW: "Not in the library". */
  sub: string
}

// ─── strikes ──────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9× -]+/g, ' ').replace(/\s+/g, ' ').trim()

/** "Lead Hook" → "Lead hook"; "Question-mark Kick" → "Question-mark kick". */
export function sentenceCase(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** "lead hook" → "Lead Hook" (how library combo text is written). */
export function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
}

/** A strike's group, from its words (the same groups as Settings' technique switches). */
export function categoryOf(strike: string): StrikeCategory {
  const s = norm(strike)
  if (/\belbow/.test(s)) return 'elbows'
  if (/\bknee/.test(s)) return 'knees'
  if (/\b(feint|fake|teep|check|slip|parry|step|pivot|reset|exit|block|catch|sweep)/.test(s)) return 'defensive'
  if (/\b(kick|roundhouse)/.test(s)) return 'kicks'
  return 'boxing'
}

/** A library combo's strikes as written: "Jab → Cross → Hook" → Jab, Cross, Hook (with "× 3" kept on its strike). */
export function splitComboText(text: string): string[] {
  return text.split(/\s*(?:→|->|›|>|,|·|\|)\s*/).map(s => s.trim()).filter(Boolean)
}

const REPEAT = /^(.*?)\s*[×x]\s*(\d)$/
const MULT: Record<string, number> = { double: 2, triple: 3 }
// The same strike under two names: the app's plain "Hook" is the lead hook.
const SAME_AS: Record<string, string> = { 'lead hook': 'hook' }

/** One strike as the plain strikes it stands for: "Double jab" → jab, jab; "Jab × 3" → jab x3; "Lead hook" → hook. */
export function expandStrike(strike: string): string[] {
  let s = norm(strike)
  let times = 1
  const rep = REPEAT.exec(s)
  if (rep) { s = rep[1].trim(); times = Number(rep[2]) }
  const mult = /^(double|triple) (.+)$/.exec(s)
  if (mult) { times *= MULT[mult[1]]; s = mult[2] }
  s = SAME_AS[s] ?? s
  return Array.from({ length: Math.max(1, times) }, () => s)
}

/** The key two combos match on: "Jab, Cross, Lead hook" and "Jab → Cross → Hook" are the same combo. */
export function matchKey(strikes: ReadonlyArray<string>): string {
  return strikes.flatMap(expandStrike).join(' > ')
}

/**
 * The techniques the app knows, derived from the combos: every strike any
 * combo uses ("Jab × 3" counts as Jab), named as a found line prints it.
 */
export function deriveTechniques(comboTexts: ReadonlyArray<string>): Technique[] {
  const out = new Map<string, Technique>()
  for (const text of comboTexts) {
    for (const raw of splitComboText(text)) {
      const rep = REPEAT.exec(raw.trim())
      const base = (rep ? rep[1] : raw).trim()
      const key = norm(base)
      if (!key || out.has(key)) continue
      out.set(key, { key, name: sentenceCase(base), category: categoryOf(base) })
    }
  }
  return [...out.values()]
}

/** The technique a phrase names exactly (case, plurals, "the"/"a" ignored), or null. */
export function lookupTechnique(phrase: string, techniques: ReadonlyArray<Technique>): Technique | null {
  const p = norm(phrase).replace(/^(a|an|the|then|and|with|plus) /, '').replace(/ (on the pads|on pads|on the bag)$/, '')
  if (!p) return null
  const byKey = new Map(techniques.map(t => [t.key, t]))
  const find = (k: string): Technique | undefined => {
    const t = byKey.get(k)
    if (t) return t
    // another name for a strike the app knows ("lead hook" for its "hook"): known, kept as written
    const same = SAME_AS[k] ? byKey.get(SAME_AS[k]) : undefined
    return same ? { key: k, name: sentenceCase(k), category: same.category } : undefined
  }
  const hit = find(p)
    ?? (p.endsWith('es') ? find(p.slice(0, -2)) : undefined)
    ?? (p.endsWith('s') ? find(p.slice(0, -1)) : undefined)
  return hit ?? null
}

// ─── the deterministic parser ─────────────────────────────────

/** Words that make an unknown phrase a strike rather than prose. */
const STRIKE_WORD = /\b(punch|punches|kick|kicks|knee|knees|elbow|elbows|hook|hooks|uppercut|uppercuts|jab|jabs|cross|teep|teeps|sweep|sweeps|spinning|superman|overhand|backfist|strike|strikes)\b/

/** Words that make a phrase prose about a strike ("cross was sharp"), not a strike's name. */
const PROSE_WORD = /\b(was|were|is|are|be|been|felt|feel|feels|slow|slower|fast|faster|good|bad|better|worse|sharp|tired|today|again|more|less|work|drill|drills|lots|some|need|needs|my|our|his|her|their|i|we|he|she|they|it|to|on|at|in|of|for|from)\b/

/** An unknown phrase that reads as the name of a strike: short, a strike word, no prose. */
function strikeName(text: string): boolean {
  const n = norm(text)
  return words(n).length <= 3 && STRIKE_WORD.test(n) && !PROSE_WORD.test(n)
}

type Seg = { kind: 'hit'; t: Technique } | { kind: 'unknown'; text: string } | { kind: 'prose' }

const words = (s: string) => norm(s).split(' ').filter(Boolean)

/** The longest known technique at the end (first segment) or start (last segment) of a phrase. */
function edgeMatch(seg: string, techniques: ReadonlyArray<Technique>, at: 'end' | 'start'): Technique | null {
  const w = words(seg)
  for (let n = Math.min(4, w.length); n >= 1; n--) {
    const part = at === 'end' ? w.slice(w.length - n) : w.slice(0, n)
    const t = lookupTechnique(part.join(' '), techniques)
    if (t) return t
  }
  return null
}

function edgeUnknown(seg: string, at: 'end' | 'start'): string | null {
  const w = words(seg)
  if (w.length < 2) return null
  const part = (at === 'end' ? w.slice(w.length - 2) : w.slice(0, 2)).join(' ')
  return strikeName(part) ? part : null
}

function classifySeg(seg: string, i: number, n: number, techniques: ReadonlyArray<Technique>): Seg {
  const whole = lookupTechnique(seg, techniques)
  if (whole) return { kind: 'hit', t: whole }
  if (i === 0 && n > 1) {
    const t = edgeMatch(seg, techniques, 'end')
    if (t) return { kind: 'hit', t }
    if (strikeName(seg)) return { kind: 'unknown', text: seg.trim() }
    const u = edgeUnknown(seg, 'end')
    return u ? { kind: 'unknown', text: u } : { kind: 'prose' }
  }
  if (i === n - 1 && n > 1) {
    const t = edgeMatch(seg, techniques, 'start')
    if (t) return { kind: 'hit', t }
    if (strikeName(seg)) return { kind: 'unknown', text: seg.trim() }
    const u = edgeUnknown(seg, 'start')
    return u ? { kind: 'unknown', text: u } : { kind: 'prose' }
  }
  return strikeName(seg) ? { kind: 'unknown', text: seg.trim() } : { kind: 'prose' }
}

const SEPARATOR = /\s*(?:,|→|->|›|>|\+|\/|\bthen\b|\band\b|\binto\b)\s*/i

/**
 * Combos typed as lists ("Jab, Cross, Lead hook", "jab → jab → teep",
 * "Coach had us double jab, cross, low kick"): two or more known strikes in a
 * row. No AI, works offline. A single strike isn't a combo. A list holding a
 * strike the app doesn't know is left out and the strike is named; one using
 * a technique switched off in Settings is left out the same way.
 */
export function parseCombos(note: string, techniques: ReadonlyArray<Technique>, enabled: ReadonlySet<string>): Extraction {
  const combos: FoundCombo[] = []
  const unknown: string[] = []
  const off: string[] = []
  for (const rawClause of note.split(/[.;!?\n]+/)) {
    // "Combo:", "Last drill:" and the like are labels, not strikes.
    const clause = rawClause.includes(':') ? rawClause.slice(rawClause.lastIndexOf(':') + 1) : rawClause
    const segs = clause.split(SEPARATOR).map(s => s.trim()).filter(Boolean)
    if (segs.length < 2) continue
    const kinds = segs.map((seg, i) => classifySeg(seg, i, segs.length, techniques))
    let run: Seg[] = []
    const flush = () => {
      if (run.length >= 2) {
        const unk = run.filter((r): r is Extract<Seg, { kind: 'unknown' }> => r.kind === 'unknown').map(r => sentenceCase(r.text))
        const hits = run.filter((r): r is Extract<Seg, { kind: 'hit' }> => r.kind === 'hit').map(r => r.t)
        const offHits = hits.filter(t => !enabled.has(t.category)).map(t => t.name)
        if (unk.length > 0) unknown.push(...unk)
        else if (offHits.length > 0) off.push(...offHits)
        else combos.push({ strikes: hits.map(t => t.name) })
      }
      run = []
    }
    for (const k of kinds) {
      if (k.kind === 'prose') flush()
      else run.push(k)
    }
    flush()
  }
  return tidy({ combos, unknown, off }, techniques)
}

/** One line per combo, each unknown named once, nothing the app knows listed as unknown. */
export function tidy(x: Extraction, techniques: ReadonlyArray<Technique>): Extraction {
  const seen = new Set<string>()
  const combos = x.combos.filter(c => {
    if (c.strikes.length < 2) return false
    const k = matchKey(c.strikes)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const once = (list: string[]) => {
    const s = new Set<string>()
    return list.filter(u => {
      const k = norm(u)
      if (!k || s.has(k)) return false
      s.add(k)
      return true
    })
  }
  return {
    combos,
    unknown: once(x.unknown.filter(u => !lookupTechnique(u, techniques)).map(sentenceCase)),
    off: once(x.off),
  }
}

/** The parser's and the AI's finds together (the parser's lines first, as typed). */
export function mergeExtractions(a: Extraction, b: Extraction | null, techniques: ReadonlyArray<Technique>): Extraction {
  if (!b) return a
  return tidy({ combos: [...a.combos, ...b.combos], unknown: [...a.unknown, ...b.unknown], off: [...a.off, ...b.off] }, techniques)
}

// ─── the AI's answer, held to the rules ───────────────────────

export interface AiComboOutput {
  combos?: Array<{ strikes?: unknown }>
  unknownStrikes?: unknown
}

const MAX_COMBOS = 12
const MAX_STRIKES = 8
const MAX_UNKNOWN = 8

/**
 * The model may only name known techniques that are switched on. Anything
 * else leaves its combo out: a known-but-off strike is named as off, any
 * other as unknown. A strike or unknown name the note never mentions is
 * dropped (nothing made up).
 */
export function guardAiExtraction(out: AiComboOutput | null, note: string, techniques: ReadonlyArray<Technique>, enabled: ReadonlySet<string>): Extraction | null {
  if (!out || !Array.isArray(out.combos)) return null
  const text = norm(note)
  const mentioned = (s: string) => {
    const k = norm(s)
    if (!k) return false
    if (text.includes(k)) return true
    const parts = expandStrike(s)
    return parts.every(p => text.includes(p) || text.includes(`${p}s`))
  }
  const combos: FoundCombo[] = []
  const unknown: string[] = []
  const off: string[] = []
  for (const c of out.combos.slice(0, MAX_COMBOS)) {
    const strikes = Array.isArray(c?.strikes) ? c.strikes.filter((s): s is string => typeof s === 'string').slice(0, MAX_STRIKES) : []
    if (strikes.length < 2) continue
    const known = strikes.map(s => lookupTechnique(s, techniques))
    if (strikes.some(s => !mentioned(s))) continue
    const unk = strikes.filter((_, i) => !known[i])
    if (unk.length > 0) { unknown.push(...unk); continue }
    const ts = known as Technique[]
    const offs = ts.filter(t => !enabled.has(t.category))
    if (offs.length > 0) { off.push(...offs.map(t => t.name)); continue }
    combos.push({ strikes: ts.map(t => t.name) })
  }
  const extra = Array.isArray(out.unknownStrikes) ? out.unknownStrikes.filter((s): s is string => typeof s === 'string') : []
  for (const u of extra.slice(0, MAX_UNKNOWN)) {
    const t = u.trim().slice(0, 40)
    if (!t || !mentioned(t)) continue
    const k = lookupTechnique(t, techniques)
    if (k && !enabled.has(k.category)) off.push(k.name)
    else if (!k) unknown.push(t)
  }
  return tidy({ combos, unknown: unknown.slice(0, MAX_UNKNOWN), off }, techniques)
}

// ─── against the bag ──────────────────────────────────────────

const TIER_NAME: Record<string, string> = { foundation: 'Fundamentals', weapons: 'Weapons', flow: 'Flow', deception: 'Deception', mastery: 'Mastery' }

/** "In Weapons, locked". */
export function tierName(tier: string): string {
  return TIER_NAME[tier] ?? sentenceCase(tier)
}

/** A NOT NOW record's key: the same combo is never offered again. */
export const declineKey = matchKey

/**
 * Each found combo against the bag: IN YOUR BAG (with the library's own
 * name), LOCKED (in the library, not unlocked), or NEW. A combo he said NOT
 * NOW to is not offered again.
 */
export function classifyFound(found: ReadonlyArray<FoundCombo>, library: ReadonlyArray<BagCombo>, declined: ReadonlySet<string> = new Set()): FoundLine[] {
  const byKey = new Map<string, BagCombo>()
  // an unlocked copy wins over a locked one with the same strikes
  for (const c of library) {
    const k = matchKey(splitComboText(c.text))
    const had = byKey.get(k)
    if (!had || (!had.unlocked && c.unlocked)) byKey.set(k, c)
  }
  const out: FoundLine[] = []
  for (const f of found) {
    const k = matchKey(f.strikes)
    const hit = byKey.get(k)
    if (hit && hit.unlocked) {
      out.push({ strikes: f.strikes, status: 'in_bag', comboId: hit.id, sub: `as ${splitComboText(hit.text).map(sentenceCase).join(' › ')}` })
      continue
    }
    if (declined.has(k)) continue
    if (hit) out.push({ strikes: f.strikes, status: 'locked', comboId: hit.id, sub: `In ${tierName(hit.tier)}, locked` })
    else out.push({ strikes: f.strikes, status: 'new', comboId: null, sub: 'Not in the library' })
  }
  return out
}

/** "Combo: Jab, Cross, Lead hook" (the strikes part). */
export function comboLine(strikes: ReadonlyArray<string>): string {
  return strikes.map(sentenceCase).join(', ')
}

/** A new class combo as the library writes combos: "Double Jab → Cross → Low Kick". */
export function comboTextFor(strikes: ReadonlyArray<string>): string {
  return strikes.map(titleCase).join(' → ')
}

/** Its technique groups, in Settings' order: "boxing,kicks". */
export function categoriesFor(strikes: ReadonlyArray<string>): string {
  const set = new Set(strikes.map(categoryOf))
  return CATEGORY_ORDER.filter(c => set.has(c)).join(',')
}

/**
 * Where a new class combo sits in the library: hands only in Fundamentals,
 * kicks, teeps, knees or elbows in Weapons, five strikes or more in Flow.
 */
export function tierFor(strikes: ReadonlyArray<string>): string {
  if (strikes.flatMap(expandStrike).length >= 5) return 'flow'
  return strikes.every(s => categoryOf(s) === 'boxing') ? 'foundation' : 'weapons'
}

/** The note's text for the NO COMBOS FOUND board's second line (page 49 section 2). */
export function unknownLine(unknown: ReadonlyArray<string>): string {
  return `${unknown.map((u, i) => (i === 0 ? sentenceCase(u) : u.toLowerCase())).join(', ')}.`
}
