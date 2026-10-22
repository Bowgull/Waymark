// The run recorder (page 74): the JS face of the native WaymarkRunRecorder
// plugin (ios/App/App/WaymarkRunRecorderPlugin.swift), behind one interface
// with a web mock, so the app and the e2e suite run without a phone.
//
// Everything that matters is native: the COOSPO H9Z over CoreBluetooth
// (Heart Rate Service 0x180D / 0x2A37, remembered, reconnecting, "connected
// but silent" detected), GPS distance in the background, the 1 Hz journal on
// the phone (crash-resume), and the lock screen's heart-rate updates. JS gets
// throttled live ticks while the app is open, and the finished recording.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

import type { HrZone } from './hrZoneState'
import type { RunRecording } from './runRecording'

/**
 * The strap, as Settings and the run screen show it.
 *   none       no strap remembered (Settings: CONNECT HEART RATE STRAP)
 *   saved      remembered, not linked right now (it links by itself on a run)
 *   searching  looking for it / connecting (the heart shimmers)
 *   connected  linked, heart rate arriving
 *   silent     linked but nothing for 10 s (re-subscribing; shown like a drop)
 */
export type StrapLink = 'none' | 'saved' | 'searching' | 'connected' | 'silent'

export interface StrapStatus {
  link: StrapLink
  /** The strap's own name ("COOSPO H9Z"). */
  name: string | null
  battery?: number | null
  hr?: number | null
}

export interface RunTick {
  /** Epoch ms of the sample. */
  t: number
  /** Seconds since the recorder's start (pauses included). */
  elapsedSec: number
  /** Seconds the run clock ran (pauses excluded). */
  movingSec: number
  /** Heart rate now (bpm), or null (no strap, a gap, silent): the zone's input. */
  hr: number | null
  /** Cumulative GPS distance, metres. */
  distanceM: number
  link: StrapLink
  /** The native recorder's zone (the run screen also steps its own). */
  zone?: HrZone
}

export interface RecorderStart {
  runId: string
  sessionId: string
  runSessionId: string
  outdoor: boolean
  /** The run's line (HR ceiling), for the lock screen's zone colour. */
  ceilingBpm: number | null
  /** The run clock's start (epoch ms), so a resumed recorder lines up. */
  startedAtMs: number
}

export interface RunRecorderApi {
  /** Whether this is the real recorder (the phone) or the web mock. */
  readonly native: boolean
  strapStatus(): Promise<StrapStatus>
  /** Look for a heart-rate strap and link the first one found; remembered from then on. */
  connectStrap(): Promise<StrapStatus>
  forgetStrap(): Promise<void>
  /** Start (or rejoin, same runId) recording. Links the remembered strap by itself. */
  start(opts: RecorderStart): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  /** The recording so far, without stopping (Log your run, filled). */
  snapshot(): Promise<RunRecording | null>
  /** Stop and hand over the recording; the journal stays on the phone until ackUploaded. */
  stop(): Promise<RunRecording | null>
  /** A run that was recording or finished but never uploaded (the app died, or no signal). */
  unfinished(): Promise<{ recording: RunRecording | null; active: boolean }>
  ackUploaded(runId: string): Promise<void>
  /** Stop and throw the recording away (DISCARD). */
  discard(runId?: string): Promise<void>
  onTick(cb: (tick: RunTick) => void): () => void
  onStrap(cb: (status: StrapStatus) => void): () => void
}

// ─── Native ──────────────────────────────────────────────────

interface NativePlugin {
  strapStatus(): Promise<StrapStatus>
  connectStrap(): Promise<StrapStatus>
  forgetStrap(): Promise<void>
  start(opts: RecorderStart): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  snapshot(): Promise<{ recording?: RunRecording | null }>
  stop(): Promise<{ recording?: RunRecording | null }>
  unfinished(): Promise<{ recording?: RunRecording | null; active?: boolean }>
  ackUploaded(opts: { runId: string }): Promise<void>
  discard(opts: { runId?: string }): Promise<void>
  addListener(event: 'tick', cb: (t: RunTick) => void): Promise<PluginListenerHandle>
  addListener(event: 'strap', cb: (s: StrapStatus) => void): Promise<PluginListenerHandle>
}

function nativeRecorder(): RunRecorderApi {
  const p = registerPlugin<NativePlugin>('WaymarkRunRecorder')
  const listen = <T,>(event: 'tick' | 'strap', cb: (x: T) => void) => {
    let handle: PluginListenerHandle | null = null
    let gone = false
    void (p.addListener as (e: string, c: (x: T) => void) => Promise<PluginListenerHandle>)(event, cb).then(h => { if (gone) void h.remove(); else handle = h })
    return () => { gone = true; void handle?.remove() }
  }
  return {
    native: true,
    strapStatus: () => p.strapStatus(),
    connectStrap: () => p.connectStrap(),
    forgetStrap: () => p.forgetStrap(),
    start: o => p.start(o),
    pause: () => p.pause(),
    resume: () => p.resume(),
    snapshot: async () => (await p.snapshot()).recording ?? null,
    stop: async () => (await p.stop()).recording ?? null,
    unfinished: async () => { const r = await p.unfinished(); return { recording: r.recording ?? null, active: !!r.active } },
    ackUploaded: runId => p.ackUploaded({ runId }),
    discard: runId => p.discard({ runId }),
    onTick: cb => listen('tick', cb),
    onStrap: cb => listen('strap', cb),
  }
}

// ─── Web mock ────────────────────────────────────────────────

/** The test handle on the web mock: window.__wmStrapMock (e2e and local dev). */
export interface StrapMockHandle {
  /** The strap's next heart rate (null: it goes quiet). */
  hr(bpm: number | null): void
  /** The GPS distance so far, metres. */
  distance(m: number): void
  /** Searching never finds a strap. */
  absent(on: boolean): void
}

const MOCK_STRAP_KEY = 'wm.mockStrap'
const MOCK_NAME = 'COOSPO H9Z'
const MOCK_SEARCH_MS = 1700

function readMockStrap(): string | null {
  try { return localStorage.getItem(MOCK_STRAP_KEY) } catch { return null }
}
function writeMockStrap(name: string | null) {
  try { if (name) localStorage.setItem(MOCK_STRAP_KEY, name); else localStorage.removeItem(MOCK_STRAP_KEY) } catch { /* private mode */ }
}

function mockRecorder(): RunRecorderApi {
  const ticks = new Set<(t: RunTick) => void>()
  const straps = new Set<(s: StrapStatus) => void>()
  let link: StrapLink = readMockStrap() ? 'saved' : 'none'
  let hr: number | null = null
  let distM = 0
  let absent = false
  let run: (RecorderStart & { paused: boolean; series: RunRecording['series']; timer: ReturnType<typeof setInterval> | null }) | null = null
  let finished: RunRecording | null = null

  const status = (): StrapStatus => ({ link, name: readMockStrap(), hr: link === 'connected' ? hr : null })
  const emitStrap = () => { const s = status(); for (const cb of straps) cb(s) }
  const setLink = (l: StrapLink) => { if (l !== link) { link = l; emitStrap() } }
  const liveHr = () => (link === 'connected' ? hr : null)

  const handle: StrapMockHandle = {
    hr(bpm) {
      hr = bpm
      // A remembered strap links once it has something to say (as the real one does on skin).
      if (bpm != null && readMockStrap() && (link === 'saved' || link === 'silent') && run) setLink('connected')
      if (bpm == null && link === 'connected') setLink('silent')
      emitTick()
    },
    distance(m) { distM = m; emitTick() },
    absent(on) { absent = on },
  }
  if (typeof window !== 'undefined') (window as unknown as { __wmStrapMock?: StrapMockHandle }).__wmStrapMock = handle

  function emitTick() {
    if (!run) return
    const now = Date.now()
    const tick: RunTick = { t: now, elapsedSec: Math.max(0, Math.round((now - run.startedAtMs) / 1000)), movingSec: run.series.moving.reduce<number>((a, m) => a + m, 0), hr: liveHr(), distanceM: run.outdoor ? distM : 0, link }
    for (const cb of ticks) cb(tick)
  }
  function sample() {
    if (!run) return
    const s = run.series
    s.t.push(s.t.length)
    s.hr.push(liveHr())
    s.moving.push(run.paused ? 0 : 1)
    s.distM.push(run.outdoor ? distM : 0)
    emitTick()
  }
  function recording(): RunRecording | null {
    if (!run) return finished
    return { runId: run.runId, sessionId: run.sessionId, runSessionId: run.runSessionId, startedAt: Math.floor(run.startedAtMs / 1000), endedAt: Math.floor(Date.now() / 1000), outdoor: run.outdoor, strapName: readMockStrap(), series: { t: [...run.series.t], hr: [...run.series.hr], moving: [...run.series.moving], distM: [...run.series.distM] } }
  }

  return {
    native: false,
    async strapStatus() { return status() },
    connectStrap() {
      setLink('searching')
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (absent) { setLink(readMockStrap() ? 'saved' : 'none'); reject(new Error('No strap found')); return }
          writeMockStrap(MOCK_NAME)
          setLink('connected')
          resolve(status())
        }, MOCK_SEARCH_MS)
      })
    },
    async forgetStrap() { writeMockStrap(null); setLink('none') },
    async start(o) {
      if (run && run.runId === o.runId) return
      if (run?.timer) clearInterval(run.timer)
      distM = 0
      finished = null
      run = { ...o, paused: false, series: { t: [], hr: [], moving: [], distM: [] }, timer: null }
      run.timer = setInterval(sample, 1000)
      if (readMockStrap() && hr != null) setLink('connected')
      emitTick()
    },
    async pause() { if (run) run.paused = true },
    async resume() { if (run) run.paused = false },
    async snapshot() { return recording() },
    async stop() {
      const r = recording()
      if (run?.timer) clearInterval(run.timer)
      run = null
      finished = r
      if (link === 'connected' || link === 'silent') setLink('saved')
      return r
    },
    async unfinished() { return { recording: run ? recording() : finished, active: !!run } },
    async ackUploaded(runId) { if (finished?.runId === runId) finished = null },
    async discard() { if (run?.timer) clearInterval(run.timer); run = null; finished = null; if (link === 'connected' || link === 'silent') setLink('saved') },
    onTick(cb) { ticks.add(cb); return () => { ticks.delete(cb) } },
    onStrap(cb) { straps.add(cb); return () => { straps.delete(cb) } },
  }
}

let instance: RunRecorderApi | null = null

/** The recorder: native on the phone, the mock on the web. */
export function runRecorder(): RunRecorderApi {
  if (!instance) instance = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios' ? nativeRecorder() : mockRecorder()
  return instance
}

/** Words for the strap on Settings' row. */
export function strapLine(s: StrapStatus | null): string {
  if (!s || s.link === 'none') return 'Not connected.'
  if (s.link === 'searching') return 'Looking for it…'
  return `${s.name ?? 'Heart rate strap'} · connected`
}
