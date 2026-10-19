import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { Board, FlapButton } from '@/design'
import { useToast } from '@/components/ui/Toast'
import { isRecorderSpikeAvailable, recorderSpike, type SpikeNativeSummary, type SpikeStatus } from '@/lib/recorderSpike'
import { GAP_THRESHOLD_SEC, MAX_HACC_M, clockText, decodeFlags, summarizeJournal, type GapStats, type SpikeResults } from '@/lib/recorderSpikeSummary'
import { SettingsScreen } from './settingsParts'

/**
 * Phase 1 run-recorder spike (throwaway dev screen, /dev/recorder). Hidden:
 * Settings, hold the crest (Logs), then hold the crest on Logs. Plain on
 * purpose; the real screens are page 48 (phase 3).
 */
export function RecorderSpikePage() {
  const navigate = useNavigate()
  const { show: showToast } = useToast()
  const [st, setSt] = useState<SpikeStatus | null>(null)
  const [results, setResults] = useState<SpikeResults | null>(null)
  const [native, setNative] = useState<SpikeNativeSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const fail = useCallback((e: unknown) => {
    showToast(e instanceof Error ? e.message : String(e), 'warning')
  }, [showToast])

  const refresh = useCallback(async () => {
    try { setSt(await recorderSpike.status()) } catch (e) { fail(e) }
  }, [fail])

  const loadResults = useCallback(async () => {
    try {
      const j = await recorderSpike.exportJournal({ share: false })
      setResults(summarizeJournal(j.contents ?? ''))
    } catch (e) { fail(e) }
  }, [fail])

  useEffect(() => {
    if (!isRecorderSpikeAvailable) return
    void refresh()
    const handles = [
      recorderSpike.addListener('status', s => setSt(s)),
      recorderSpike.addListener('hr', e => setSt(prev => prev ? { ...prev, hr: e.hr, flagsHex: e.flagsHex, contact: e.contact, hrAgeSec: 0, lastRr: e.rr.length ? e.rr : prev.lastRr } : prev)),
    ]
    const tick = window.setInterval(() => {
      setNow(Date.now())
      if (document.visibilityState === 'visible') void refresh()
    }, 1000)
    return () => {
      window.clearInterval(tick)
      for (const h of handles) void h.then(x => x.remove()).catch(() => null)
    }
  }, [refresh])

  const run = (fn: () => Promise<unknown>) => async () => {
    if (busy) return
    setBusy(true)
    try { await fn() } catch (e) { fail(e) } finally { setBusy(false); void refresh() }
  }

  const onScan = run(() => recorderSpike.scan())
  const onStopScan = run(() => recorderSpike.stopScan())
  const onConnect = (id: string) => run(() => recorderSpike.connect({ id }))()
  const onForget = run(async () => {
    if (!window.confirm('Forget the remembered strap?')) return
    await recorderSpike.forget()
  })
  const onStart = run(async () => {
    setResults(null)
    setNative(null)
    await recorderSpike.start()
  })
  const onStop = run(async () => {
    setNative(await recorderSpike.stop())
    await loadResults()
  })
  const onShare = run(() => recorderSpike.exportJournal({ share: true }))
  const onClear = run(async () => {
    if (!window.confirm('Delete every spike journal on this phone?')) return
    const r = await recorderSpike.clear()
    setResults(null)
    setNative(null)
    showToast(`Deleted ${r.deleted} journal file(s)`, 'info')
  })

  const elapsed = st?.recording && st.startedAt ? (now / 1000 - st.startedAt) : st?.durationSec ?? 0
  const flags = st?.flagsHex ? decodeFlags(st.flagsHex) : null

  return (
    <SettingsScreen title="RECORDER" onBack={() => navigate(-1)}>
      {!isRecorderSpikeAvailable && (
        <Board head="Recorder spike" solid className="st-board">
          <p className="st-empty">This test screen only works in the iPhone app.</p>
        </Board>
      )}

      {st?.interruptedRun && (
        <Board head="Warning" solid className="st-board">
          <p className="st-empty">The last recording was cut off (the app was closed or killed mid-run). Its journal is still on the phone: tap Results or Share journal.</p>
        </Board>
      )}

      <Board head="Strap" solid className="st-board">
        <KV label="Remembered" value={st?.savedName ? `${st.savedName}` : 'none'} />
        <KV label="Bluetooth" value={`${st?.bleState ?? '-'} · ${st?.centralState ?? '-'} · ${st?.bleAuth ?? '-'}`} />
        {st?.battery !== undefined && <KV label="Strap battery" value={`${st.battery}%`} />}
        <div style={btnRow}>
          <FlapButton label={st?.scanning ? 'SCANNING' : 'SCAN'} size="xs" onClick={onScan} disabled={busy} />
          <FlapButton label="STOP SCAN" size="xs" onClick={onStopScan} disabled={busy || !st?.scanning} />
          <FlapButton label="FORGET" size="xs" onClick={onForget} disabled={busy || !st?.savedId} />
        </div>
        {(st?.found ?? []).map(p => (
          <div key={p.id} className="st-row">
            <div className="st-sl">
              <b>{p.name}</b>
              <small>{p.rssi ? `${p.rssi} dBm` : 'already linked'} · {p.id.slice(0, 8)}{p.id === st?.savedId ? ' · remembered' : ''}</small>
            </div>
            <FlapButton label="CONNECT" size="xs" onClick={() => onConnect(p.id)} disabled={busy} />
          </div>
        ))}
      </Board>

      <Board head="Live" solid className="st-board">
        <KV label="Heart rate" value={st?.hr ? `${st.hr} bpm${st.hrAgeSec !== undefined && st.hrAgeSec > 3 ? ` (${Math.round(st.hrAgeSec)} s old)` : ''}` : '-'} big />
        <KV label="Flags" value={st?.flagsHex ? `${st.flagsHex} · RR ${flags?.rr ? 'yes' : 'no'} · contact ${st.contact ?? '-'}` : '-'} />
        <KV label="RR values" value={`${st?.rrValues ?? 0} this run${st?.lastRr?.length ? ` · last ${st.lastRr.join(', ')} ms` : ''}`} />
        <KV label="GPS accuracy" value={st?.hAcc !== undefined ? `±${Math.round(st.hAcc)} m${st.locAgeSec !== undefined && st.locAgeSec > 3 ? ` (${Math.round(st.locAgeSec)} s old)` : ''} · ${st.locationAuth}` : `- · ${st?.locationAuth ?? '-'}`} />
        <KV label="Recording" value={st?.recording ? `yes · ${clockText(elapsed)}` : 'no'} />
        <KV label="Samples written" value={`${st?.samples ?? 0}`} />
        <KV label="Time locked" value={clockText(st?.lockedSeconds ?? 0)} />
        <KV label="Time in background" value={clockText(st?.bgSeconds ?? 0)} />
        <KV label="Reconnects" value={`${st?.reconnects ?? 0} (drops ${st?.disconnects ?? 0})`} />
        <div style={btnRow}>
          <FlapButton label="START" size="xs" primary onClick={onStart} disabled={busy || !!st?.recording} />
          <FlapButton label="STOP" size="xs" onClick={onStop} disabled={busy || !st?.recording} />
          <FlapButton label="STATUS" size="xs" onClick={() => void refresh()} />
        </div>
      </Board>

      <Board head="Results" solid className="st-board">
        {results ? <ResultLines r={results} native={native} /> : <p className="st-empty">Stop a recording (or tap Results) to see them.</p>}
        <div style={btnRow}>
          <FlapButton label="RESULTS" size="xs" onClick={run(loadResults)} disabled={busy || !!st?.recording} />
          <FlapButton label="SHARE JOURNAL" size="xs" onClick={onShare} disabled={busy} />
          <FlapButton label="CLEAR" size="xs" onClick={onClear} disabled={busy || !!st?.recording} />
        </div>
        {st?.path && <p className="st-note" style={{ overflowWrap: 'anywhere' }}>{st.path}</p>}
      </Board>
    </SettingsScreen>
  )
}

const btnRow = { display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 0' } as const

function KV({ label, value, big = false }: { label: string; value: ReactNode; big?: boolean }) {
  return (
    <div className="st-row">
      <div className="st-sl"><b>{label}</b></div>
      <span style={{ font: `800 ${big ? 26 : 15}px/1.3 var(--font-mono)`, color: '#f2e8cc', textAlign: 'right', maxWidth: '64%', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  )
}

function gapText(g: GapStats): string {
  return g.count === 0 ? 'none' : `${g.count} · longest ${clockText(g.longestSec)} · total ${clockText(g.totalSec)}`
}

function ResultLines({ r, native }: { r: SpikeResults; native: SpikeNativeSummary | null }) {
  const contactLine = r.contact === 'unsupported' ? 'not reported (bits 1-2 always 0)'
    : r.contact === 'supported' ? `reported · on skin ${r.contactCounts.contact} s · off skin ${r.contactCounts.noContact} s`
    : 'no HR data'
  return (
    <>
      <KV label="Duration" value={clockText(r.durationSec)} />
      <KV label="Samples" value={`${r.samples} (${r.durationSec > 0 ? Math.round((r.samples / r.durationSec) * 100) : 0}% of seconds)`} />
      <KV label="Recorder stalls" value={gapText(r.tickGaps)} />
      <KV label={`HR gaps > ${GAP_THRESHOLD_SEC} s`} value={gapText(r.hrGaps)} />
      <KV label={`GPS gaps > ${GAP_THRESHOLD_SEC} s`} value={gapText(r.gpsGaps)} />
      <KV label="Time in background" value={clockText(r.bgSeconds)} />
      <KV label="Time locked" value={clockText(r.lockedSeconds)} />
      <KV label="Reconnects" value={`${r.reconnects} (drops ${r.disconnects})`} />
      <KV label="Flags seen" value={r.flagsSeen.length ? r.flagsSeen.join(' ') : 'none'} />
      <KV label="RR present" value={r.rrPresent ? `yes · ${r.rrValues} values` : 'no'} />
      <KV label="Contact bits" value={contactLine} />
      <KV label="HR" value={r.avgHr ? `avg ${r.avgHr} · max ${r.maxHr}` : '-'} />
      <KV label="Distance" value={`${(r.distanceM / 1000).toFixed(2)} km · ${r.gpsPointsUsed} fixes ≤ ${MAX_HACC_M} m`} />
      <KV label="GPS accuracy (median)" value={r.medianHAcc !== null ? `±${Math.round(r.medianHAcc)} m` : '-'} />
      {native && <KV label="Native counts" value={`${native.hrNotifications} HR packets · ${native.locationUpdates} GPS fixes`} />}
    </>
  )
}
