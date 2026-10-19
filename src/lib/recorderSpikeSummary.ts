// Phase 1 run-recorder spike (throwaway): turns the native JSON-lines journal
// into the "results" the /dev/recorder screen shows after Stop. Pure, so it is
// unit tested off the phone (recorderSpikeSummary.test.ts).

export interface SpikeSample {
  t: number
  seq?: number
  hr: number | null
  hrT: number | null
  flagsHex: string | null
  rr: number[]
  contact: string | null
  lat: number | null
  lon: number | null
  hAcc: number | null
  speed: number | null
  alt: number | null
  locT: number | null
  appState: 'fg' | 'bg'
  locked: boolean
  bleState: string
}

export interface SpikeEvent {
  t: number
  ev: string
  [key: string]: unknown
}

export interface GapStats {
  /** Gaps longer than the threshold. */
  count: number
  longestSec: number
  /** Seconds spent inside those gaps. */
  totalSec: number
}

export interface SpikeResults {
  durationSec: number
  samples: number
  /** Journal clock gaps: the native 1 Hz timer itself stalled (app suspended). */
  tickGaps: GapStats
  hrGaps: GapStats
  gpsGaps: GapStats
  hrSamples: number
  avgHr: number | null
  maxHr: number | null
  bgSeconds: number
  lockedSeconds: number
  disconnects: number
  reconnects: number
  flagsSeen: string[]
  rrPresent: boolean
  rrValues: number
  contact: 'unsupported' | 'supported' | 'none'
  contactCounts: { contact: number; noContact: number; unsupported: number }
  distanceM: number
  gpsPointsUsed: number
  medianHAcc: number | null
}

export const GAP_THRESHOLD_SEC = 5
export const MAX_HACC_M = 20

export function parseJournal(text: string): { samples: SpikeSample[]; events: SpikeEvent[] } {
  const samples: SpikeSample[] = []
  const events: SpikeEvent[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let obj: unknown
    try { obj = JSON.parse(line) } catch { continue }
    if (!obj || typeof obj !== 'object') continue
    const o = obj as Record<string, unknown>
    if (typeof o.t !== 'number') continue
    if (typeof o.ev === 'string') {
      events.push(o as SpikeEvent)
    } else {
      samples.push({
        t: o.t,
        seq: typeof o.seq === 'number' ? o.seq : undefined,
        hr: num(o.hr),
        hrT: num(o.hrT),
        flagsHex: typeof o.flagsHex === 'string' ? o.flagsHex : null,
        rr: Array.isArray(o.rr) ? o.rr.filter((v): v is number => typeof v === 'number') : [],
        contact: typeof o.contact === 'string' ? o.contact : null,
        lat: num(o.lat),
        lon: num(o.lon),
        hAcc: num(o.hAcc),
        speed: num(o.speed),
        alt: num(o.alt),
        locT: num(o.locT),
        appState: o.appState === 'bg' ? 'bg' : 'fg',
        locked: o.locked === true,
        bleState: typeof o.bleState === 'string' ? o.bleState : '',
      })
    }
  }
  return { samples, events }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Gaps between consecutive timestamps (sorted, distinct), including the edge
 * gaps from start to the first and from the last to end. No timestamps at all
 * is one gap the length of the run.
 */
export function gapStats(times: number[], start: number, end: number, threshold = GAP_THRESHOLD_SEC): GapStats {
  const ts = [...new Set(times.filter(t => t >= start && t <= end))].sort((a, b) => a - b)
  const points = [start, ...ts, end]
  let count = 0
  let longest = 0
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = points[i] - points[i - 1]
    if (d > threshold) {
      count++
      total += d
      if (d > longest) longest = d
    }
  }
  return { count, longestSec: round1(longest), totalSec: round1(total) }
}

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 0x2A37 flags byte: bit4 = RR present; bits 1-2 = sensor contact. */
export function decodeFlags(hex: string): { rr: boolean; contactSupported: boolean; inContact: boolean; uint16: boolean; energy: boolean } | null {
  const v = Number.parseInt(hex, 16)
  if (!Number.isFinite(v)) return null
  const contactBits = (v >> 1) & 0x03
  return {
    uint16: (v & 0x01) !== 0,
    contactSupported: contactBits >= 2,
    inContact: contactBits === 3,
    energy: (v & 0x08) !== 0,
    rr: (v & 0x10) !== 0,
  }
}

export function summarizeJournal(text: string): SpikeResults {
  const { samples, events } = parseJournal(text)
  const startEv = events.find(e => e.ev === 'start')
  const stopEv = [...events].reverse().find(e => e.ev === 'stop')
  const start = startEv?.t ?? samples[0]?.t ?? 0
  const end = stopEv?.t ?? samples[samples.length - 1]?.t ?? start
  const durationSec = Math.max(0, end - start)

  // Time in background / locked: each interval belongs to the sample that ends it.
  let bg = 0
  let locked = 0
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t
    if (samples[i].appState === 'bg') bg += dt
    if (samples[i].locked) locked += dt
  }

  const hrValues = samples.map(s => s.hr).filter((v): v is number => v !== null && v > 0)
  const flagsSeen = [...new Set(samples.map(s => s.flagsHex).filter((v): v is string => !!v))].sort()
  const rrValues = samples.reduce((n, s) => n + s.rr.length, 0)
  const rrPresent = rrValues > 0 || flagsSeen.some(f => decodeFlags(f)?.rr === true)

  const contactCounts = { contact: 0, noContact: 0, unsupported: 0 }
  for (const s of samples) {
    if (s.contact === 'contact') contactCounts.contact++
    else if (s.contact === 'noContact') contactCounts.noContact++
    else if (s.contact === 'unsupported') contactCounts.unsupported++
  }
  const contact: SpikeResults['contact'] = contactCounts.contact + contactCounts.noContact > 0 ? 'supported'
    : contactCounts.unsupported > 0 ? 'unsupported'
    : 'none'

  let disconnects = 0
  let reconnects = 0
  let down = false
  for (const e of events) {
    if (e.ev === 'disconnected') { disconnects++; down = true }
    if (e.ev === 'connected' && down) { reconnects++; down = false }
  }

  // Distance: one point per distinct GPS fix, accurate fixes only.
  const seen = new Set<number>()
  const pts: { lat: number; lon: number; hAcc: number }[] = []
  for (const s of samples) {
    if (s.locT === null || s.lat === null || s.lon === null || s.hAcc === null) continue
    if (s.locT < start || seen.has(s.locT)) continue
    seen.add(s.locT)
    pts.push({ lat: s.lat, lon: s.lon, hAcc: s.hAcc })
  }
  const good = pts.filter(p => p.hAcc >= 0 && p.hAcc <= MAX_HACC_M)
  let distanceM = 0
  for (let i = 1; i < good.length; i++) {
    distanceM += haversineM(good[i - 1].lat, good[i - 1].lon, good[i].lat, good[i].lon)
  }
  const accs = pts.map(p => p.hAcc).filter(a => a >= 0).sort((a, b) => a - b)

  return {
    durationSec: round1(durationSec),
    samples: samples.length,
    tickGaps: gapStats(samples.map(s => s.t), start, end),
    hrGaps: gapStats(samples.map(s => s.hrT).filter((v): v is number => v !== null), start, end),
    gpsGaps: gapStats(samples.map(s => s.locT).filter((v): v is number => v !== null), start, end),
    hrSamples: hrValues.length,
    avgHr: hrValues.length ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : null,
    maxHr: hrValues.length ? Math.max(...hrValues) : null,
    bgSeconds: round1(bg),
    lockedSeconds: round1(locked),
    disconnects,
    reconnects,
    flagsSeen,
    rrPresent,
    rrValues,
    contact,
    contactCounts,
    distanceM: Math.round(distanceM),
    gpsPointsUsed: good.length,
    medianHAcc: accs.length ? accs[Math.floor(accs.length / 2)] : null,
  }
}

/** "1:05:30" / "12:04". */
export function clockText(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
