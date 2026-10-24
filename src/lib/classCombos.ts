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
  /** 'class' (the glove), 'mine' (he typed it, page 80) or NULL (the library's own). */
  source?: string | null
  /** 0049: his own grade after a nudge ('easy' … 'expert'). */
  difficultyOverride?: string | null
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

/** A feint, or a defensive move that isn't a teep (slip, check, parry, step, reset, exit…): the Library's Deception and Mastery. */
const TRICK = /\b(feint|fake|slip|parry|check|catch|sweep|block|step|pivot|reset|exit|roll)\b/

/**
 * Where a new combo sits in the library (a class combo, or one he typed, page
 * 80): hands only in Fundamentals, kicks, teeps, knees or elbows in Weapons,
 * five strikes or more in Flow; a feint or a defensive move makes it
 * Deception, Mastery at five strikes or more (the Library's own tiers read
 * that way: Feint Jab → Cross → Switch Kick → Step Out is Deception,
 * Jab → Cross → Hook → Check → Lead Teep is Mastery).
 */
export function tierFor(strikes: ReadonlyArray<string>): string {
  const n = strikes.flatMap(expandStrike).length
  if (strikes.some(s => TRICK.test(norm(s)))) return n >= 5 ? 'mastery' : 'deception'
  if (n >= 5) return 'flow'
  return strikes.every(s => categoryOf(s) === 'boxing') ? 'foundation' : 'weapons'
}

// ─── difficulty in plain words (page 80) ──────────────────────

/** The Library's tiers in plain words, one flap word each: EASY, MEDIUM, HARD, EXPERT. */
export const LEVELS = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const
export type ComboLevel = 0 | 1 | 2 | 3
/** As stored in combos.difficulty_override. */
export const LEVEL_KEYS = ['easy', 'medium', 'hard', 'expert'] as const
export type LevelKey = typeof LEVEL_KEYS[number]

/** FUNDAMENTALS → EASY, WEAPONS → MEDIUM, FLOW and DECEPTION → HARD, MASTERY → EXPERT. */
const TIER_LEVEL: Readonly<Record<string, ComboLevel>> = { foundation: 0, weapons: 1, flow: 2, deception: 2, mastery: 3 }

export function levelOfTier(tier: string | null | undefined): ComboLevel {
  return TIER_LEVEL[tier ?? ''] ?? 1
}

/** "hard" → 2; anything else → null. */
export function parseLevel(key: string | null | undefined): ComboLevel | null {
  const i = LEVEL_KEYS.indexOf((key ?? '') as LevelKey)
  return i < 0 ? null : (i as ComboLevel)
}

/** A combo's difficulty: his own when he nudged it, else its tier's. */
export function comboLevel(c: { tier: string; difficultyOverride?: string | null }): ComboLevel {
  return parseLevel(c.difficultyOverride) ?? levelOfTier(c.tier)
}

/** A new combo's grade, by the same rules as the Library's tiers. */
export function gradeLevel(strikes: ReadonlyArray<string>): ComboLevel {
  return levelOfTier(tierFor(strikes))
}

/** ▲ / ▼: one level, never past EASY or EXPERT. */
export function nudgeLevel(level: ComboLevel, dir: 1 | -1): ComboLevel {
  return Math.max(0, Math.min(3, level + dir)) as ComboLevel
}

// ─── a combo typed in words (page 80) ─────────────────────────

/** A strike read from the typed words. */
export interface ReadStrike { kind: 'strike'; name: string }
/** A word it doesn't know (or a strike switched off in Settings): clay, one tap offers fixes. */
export interface ReadUnknown { kind: 'unknown'; raw: string; off: boolean; fixes: ReadFix[] }
/** A likely fix: the strike's name and how many read pieces (from this one) it stands for. */
export interface ReadFix { name: string; span: number }
export type ReadToken = ReadStrike | ReadUnknown

/** Little words between strikes. */
const FILLER = new Set(['then', 'and', 'into', 'to', 'a', 'an', 'the', 'with', 'plus', 'combo'])
/** A side word on its own ("lead teep" when the app knows "teep"). */
const SIDE = new Set(['lead', 'rear', 'left', 'right', 'front', 'back'])

/** Edits between two strings (Levenshtein). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]
}

/**
 * The words he typed as strikes, the longest known name first ("lead hook"
 * before "hook"), little words ("then", "and") skipped. A word it doesn't know
 * stays in place as an unknown piece with its likely fixes; a known strike
 * switched off in Settings is an unknown piece too (no fixes, only LEAVE IT
 * OUT). The same technique list and lookup as the class parser.
 */
export function readTypedCombo(text: string, techniques: ReadonlyArray<Technique>, enabled?: ReadonlySet<string>): ReadToken[] {
  const w = norm(text.replace(/[,→›>+/|·]/g, ' ')).split(' ').filter(Boolean)
  const pieces: Array<{ token: ReadToken; words: string[] }> = []
  let i = 0
  while (i < w.length) {
    let hit: { t: Technique; n: number } | null = null
    for (let n = Math.min(4, w.length - i); n >= 1 && !hit; n--) {
      if (n === 1 && FILLER.has(w[i])) break
      const t = lookupTechnique(w.slice(i, i + n).join(' '), techniques)
      if (t) hit = { t, n }
    }
    if (hit) {
      const off = enabled != null && !enabled.has(hit.t.category)
      pieces.push({ token: off ? { kind: 'unknown', raw: hit.t.name, off: true, fixes: [] } : { kind: 'strike', name: hit.t.name }, words: w.slice(i, i + hit.n) })
      i += hit.n
      continue
    }
    if (FILLER.has(w[i])) { i++; continue }
    pieces.push({ token: { kind: 'unknown', raw: w[i], off: false, fixes: [] }, words: [w[i]] })
    i++
  }
  const usable = techniques.filter(t => enabled == null || enabled.has(t.category))
  return pieces.map((p, k) => (p.token.kind === 'unknown' && !p.token.off ? { ...p.token, fixes: fixesFor(pieces.map(x => x.words), k, usable) } : p.token))
}

/** Up to three likely strikes for the unknown piece at `k` (it and the pieces after it, as one phrase). */
function fixesFor(words: string[][], k: number, techniques: ReadonlyArray<Technique>): ReadFix[] {
  const scored: Array<{ name: string; span: number; d: number }> = []
  const raw = words[k].join(' ')
  // "lead teep" when the app knows only "teep": the strike after the side word
  if (SIDE.has(raw) && k + 1 < words.length) {
    const t = lookupTechnique(words[k + 1].join(' '), techniques)
    if (t) scored.push({ name: t.name, span: 2, d: 0 })
  }
  for (let span = 1; span <= 3 && k + span <= words.length; span++) {
    const phrase = words.slice(k, k + span).flat().join(' ')
    for (const t of techniques) {
      const d = editDistance(phrase, t.key)
      const room = Math.max(1, Math.floor(t.key.length / 4))
      if (d <= room) scored.push({ name: t.name, span, d })
      else if (span === 1 && raw.length >= 3 && t.key.startsWith(raw)) scored.push({ name: t.name, span, d: t.key.length - raw.length })
    }
  }
  scored.sort((a, b) => a.d - b.d || b.span - a.span)
  const seen = new Set<string>()
  const out: ReadFix[] = []
  for (const s of scored) {
    const key = s.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: s.name, span: s.span })
    if (out.length === 3) break
  }
  return out
}

/** A fix tapped: the unknown piece (and the pieces its fix stands for) become that strike. */
export function applyFix(tokens: ReadonlyArray<ReadToken>, at: number, fix: ReadFix): ReadToken[] {
  const out = [...tokens]
  out.splice(at, Math.max(1, Math.min(fix.span, tokens.length - at)), { kind: 'strike', name: fix.name })
  return out
}

/** LEAVE IT OUT: the piece goes. */
export function leaveOut(tokens: ReadonlyArray<ReadToken>, at: number): ReadToken[] {
  return tokens.filter((_, i) => i !== at)
}

/** The strikes, once nothing unknown is left (ADD waits until then). */
export function readStrikes(tokens: ReadonlyArray<ReadToken>): string[] | null {
  if (tokens.length === 0 || tokens.some(t => t.kind === 'unknown')) return null
  return tokens.map(t => (t as ReadStrike).name)
}

/** The note's text for the NO COMBOS FOUND board's second line (page 49 section 2). */
export function unknownLine(unknown: ReadonlyArray<string>): string {
  return `${unknown.map((u, i) => (i === 0 ? sentenceCase(u) : u.toLowerCase())).join(', ')}.`
}
