import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'

import { Board, FlapButton, FlapLabel, FlapSwitch } from '@/design'
import { apiFetch } from '@/lib/api'
import { scheduleAlarms } from '@/lib/notifications'
import { coachLine, nextAlarmDay } from '@/lib/coachLine'
import { getTodayISO } from '@/lib/dates'
import { ONE_PACE_ARCS } from '@/lib/onePace'
import { NARUTO_ARC_NAMES, NARUTO_EPISODES, narutoArcForEp } from '@/lib/naruto'
import { isHapticsEnabled, setHapticsEnabled, tapHaptic } from '@/lib/haptics'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { useToast } from '@/components/ui/Toast'
import { isGateEnabled, setGateEnabled } from '@/lib/waybookGate'
import { WorldTimeBoard } from './WorldTimeBoard'
import { BodyProfileBoard } from './BodyProfileBoard'
import { ArcCard, NumberCard, TimeCard } from './SettingsCards'
import { ChevValue, SBlock, SRow, SettingsScreen, TimeValue } from './settingsParts'
import { daysUntilRedeploy, leadFlap, splitTime, timeFlap } from './settingsModel'

interface Settings {
  mtClassDays: string | null
  amReminder: string | null
  pmLeadMin: number | null
  pmSessionTime: string | null
  onePaceArc: string | null
  onePaceEp: string | null
  narutoArc: string | null
  narutoEp: number | null
  lastDeploy: number | null
  enabledTechniques: string | null
  amEnabled: number | null
  pmEnabled: number | null
  cascade?: { removed: number; freedDays?: string[] } | null
}

interface StravaStatus {
  connected: boolean
  athleteId?: number
  athleteName?: string | null
  scope?: string
  connectedAt?: number
  expiresAt?: number
  clientConfigured?: boolean
  requiredScopesGranted?: boolean
  missingScopes?: string[]
  syncStatus?: 'ready' | 'refresh_failed'
}

const TECHNIQUES = [
  { key: 'boxing', label: 'BOXING' },
  { key: 'kicks', label: 'KICKS' },
  { key: 'defensive', label: 'DEFENSIVE' },
  { key: 'knees', label: 'KNEES' },
  { key: 'elbows', label: 'ELBOWS' },
]

// The stored day keys (0 = Sunday), Monday first as page 37 draws them.
const DAYS = [
  { key: '1', label: 'MO' }, { key: '2', label: 'TU' }, { key: '3', label: 'WE' }, { key: '4', label: 'TH' },
  { key: '5', label: 'FR' }, { key: '6', label: 'SA' }, { key: '0', label: 'SU' },
]
const DAY_NAMES: Record<string, string> = { '0': 'Sunday', '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday' }

type Card = 'am' | 'pm' | 'lead' | 'opArc' | 'opEp' | 'nArc' | 'nEp' | null

/**
 * Settings, page 37 A (approved): five grouped boards on the solid dark, no
 * world behind them: Training, Alarms, Body, World, Connections, with the
 * "5D until redeploy" badge on top. Every switch is an ON / OFF flap; times
 * open the centred time card. Hold the crest for Logs.
 */
export function SettingsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const { show: showToast } = useToast()
  const [showReplacementPicker, setShowReplacementPicker] = useState(false)
  const hydratedRef = useRef(false)
  const [card, setCard] = useState<Card>(null)

  const [mtDays, setMtDays] = useState<Set<string>>(new Set())
  const [amReminder, setAmReminder] = useState('06:30')
  const [amEnabled, setAmEnabled] = useState(true)
  const [pmLeadMin, setPmLeadMin] = useState(60)
  const [pmSessionTime, setPmSessionTime] = useState('18:00')
  const [pmEnabled, setPmEnabled] = useState(true)
  const [onePaceArc, setOnePaceArc] = useState('')
  const [onePaceEp, setOnePaceEp] = useState('')
  const [narutoArc, setNarutoArc] = useState('')
  const [narutoEp, setNarutoEp] = useState('')
  const [enabledTechniques, setEnabledTechniques] = useState<Set<string>>(new Set(['boxing', 'kicks', 'defensive']))

  const [strava, setStrava] = useState<StravaStatus | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [waybookAuth, setWaybookAuth] = useState<boolean>(() => isGateEnabled())
  const [hapticsOn, setHapticsOn] = useState<boolean>(() => isHapticsEnabled())

  function handleHaptics(next: boolean) {
    setHapticsEnabled(next)
    setHapticsOn(next)
    if (next) void tapHaptic()
  }

  function handleWaybookAuth(next: boolean) {
    setWaybookAuth(next)
    setGateEnabled(next)
  }

  useEffect(() => {
    async function load() {
      try {
        const s = await apiFetch<Settings | null>('/api/settings')
        if (s) {
          setMtDays(new Set((s.mtClassDays ?? '').split(',').filter(Boolean)))
          setAmReminder(s.amReminder ?? '06:30')
          setAmEnabled(s.amEnabled !== 0)
          setPmLeadMin(s.pmLeadMin ?? 60)
          setPmSessionTime(s.pmSessionTime ?? '18:00')
          setPmEnabled(s.pmEnabled !== 0)
          setOnePaceArc(s.onePaceArc ?? '')
          setOnePaceEp(s.onePaceEp ?? '')
          setNarutoArc(s.narutoArc ?? '')
          setNarutoEp(s.narutoEp != null ? String(s.narutoEp) : '')
          setEnabledTechniques(new Set((s.enabledTechniques ?? 'boxing,kicks,defensive').split(',').filter(Boolean)))
        }
      } catch (e) {
        console.error('Failed to load settings:', e)
      } finally {
        setLoading(false)
        // Defer hydration so the save effect's first run (post-load) is skipped
        requestAnimationFrame(() => { hydratedRef.current = true })
      }
    }
    load()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadStrava() {
      try {
        const s = await apiFetch<StravaStatus>('/api/strava/status')
        if (!cancelled) setStrava(s)
      } catch (e) {
        console.error('Failed to load Strava status:', e)
        if (!cancelled) setStrava({ connected: false })
      }
    }
    loadStrava()

    // Legacy query-param handling (old callback flow may still leave these).
    const params = new URLSearchParams(window.location.search)
    const result = params.get('strava')
    if (result === 'connected') {
      showToast('Strava connected', 'success')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (result === 'denied') {
      showToast('Strava access denied', 'info')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (result && result.startsWith('token')) {
      showToast('Strava connection failed, try again', 'info')
      window.history.replaceState({}, '', window.location.pathname)
    }

    // Re-check status when the app comes back to the foreground (e.g. after
    // returning from SFSafariViewController OAuth, or from Mac Safari auth).
    let removeResume: (() => void) | null = null
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) loadStrava()
      }).then((handle) => { removeResume = () => handle.remove() })
    } else {
      const onVis = () => { if (document.visibilityState === 'visible') loadStrava() }
      document.addEventListener('visibilitychange', onVis)
      removeResume = () => document.removeEventListener('visibilitychange', onVis)
    }
    return () => {
      cancelled = true
      if (removeResume) removeResume()
    }
  }, [showToast])

  async function handleConnectStrava() {
    if (connecting) return
    setConnecting(true)
    const isDemo = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_DEMO_MODE === 'true'
    try {
      if (isDemo) {
        // Demo mode: skip Strava OAuth entirely. Server stamps a fake
        // connected athlete and pre-attaches matched runs to recent sessions.
        const data = await apiFetch<{ athleteName?: string }>('/api/strava/demo-connect', { method: 'POST' })
        setStrava({ connected: true, athleteName: data.athleteName ?? 'Demo Athlete', athleteId: 999000001 } as StravaStatus)
        showToast('Strava connected (demo). Recent runs attached.', 'success')
        return
      }

      const { url } = await apiFetch<{ url: string }>('/api/strava/link-start', { method: 'POST' })
      if (Capacitor.isNativePlatform()) {
        await Browser.open({ url, presentationStyle: 'popover' })
      } else {
        window.location.href = url
      }
    } catch (e) {
      console.error('Failed to open Strava authorize:', e)
      showToast('Could not open Strava. Try again.', 'warning')
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnectStrava() {
    setDisconnecting(true)
    try {
      await apiFetch('/api/strava/disconnect', { method: 'POST' })
      setStrava({ connected: false })
      showToast('Strava disconnected', 'info')
    } catch (e) {
      console.error('Failed to disconnect Strava:', e)
    } finally {
      setDisconnecting(false)
    }
  }

  useEffect(() => {
    if (!hydratedRef.current) return
    const controller = new AbortController()
    const t = setTimeout(async () => {
      try {
        const updated = await apiFetch<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            mtClassDays: Array.from(mtDays).join(','),
            amReminder,
            pmLeadMin,
            pmSessionTime,
            onePaceArc: onePaceArc || null,
            onePaceEp: onePaceEp || null,
            narutoArc: narutoArc || null,
            narutoEp: narutoEp === '' ? null : Number(narutoEp),
            enabledTechniques: Array.from(enabledTechniques).join(','),
            amEnabled,
            pmEnabled,
          }),
          signal: controller.signal,
        })
        if (controller.signal.aborted) return

        // The alarm keeps its one quiet line (page 56 item 12).
        coachLine('morning', nextAlarmDay(getTodayISO(), amReminder))
          .then(line => scheduleAlarms(amReminder, pmSessionTime, pmLeadMin, { amEnabled, pmEnabled, coachLine: line }))
          .catch(() => {})

        if (updated.cascade && updated.cascade.removed > 0) {
          const days = updated.cascade.freedDays?.join(', ') ?? ''
          showToast(`${days} PM slot${updated.cascade.removed > 1 ? 's' : ''} freed up`, 'info')
          setShowReplacementPicker(true)
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
        console.error('Failed to save settings:', e)
        showToast('Save didn\'t land. Try again.', 'warning')
      }
    }, 800)
    return () => {
      controller.abort()
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mtDays, amReminder, amEnabled, pmLeadMin, pmSessionTime, pmEnabled, onePaceArc, onePaceEp, narutoArc, narutoEp, enabledTechniques])

  function toggleDay(day: string) {
    const next = new Set(mtDays)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    setMtDays(next)
  }

  function setTechnique(tech: string, on: boolean) {
    const next = new Set(enabledTechniques)
    if (on) next.add(tech)
    else next.delete(tech)
    setEnabledTechniques(next)
  }

  const back = () => navigate('/today')
  const hold = () => navigate('/settings/logs')

  if (loading) {
    return <SettingsScreen title="SETTINGS" backLabel="TODAY" onBack={back} onHold={hold}><div aria-busy="true" aria-label="Loading settings" /></SettingsScreen>
  }

  const daysLeft = daysUntilRedeploy(Number(import.meta.env.VITE_BUILD_TIME), Date.now())
  const am = splitTime(amReminder)
  const pm = splitTime(pmSessionTime)
  const stravaLine = !strava?.connected ? 'Not connected.'
    : strava.clientConfigured === false ? 'Add Strava client credentials locally.'
    : strava.requiredScopesGranted === false ? `Reconnect Strava with ${strava.missingScopes?.join(', ') ?? 'required scopes'}.`
    : strava.syncStatus === 'refresh_failed' ? 'Reconnect Strava. Token refresh is failing.'
    : 'Connected. Runs log themselves.'
  const stravaOk = !!strava?.connected && stravaLine.startsWith('Connected')

  return (
    <SettingsScreen title="SETTINGS" backLabel="TODAY" onBack={back} onHold={hold}>
      {daysLeft !== null && (
        <div className="st-badge" aria-label={`${daysLeft} days until redeploy`}>
          <FlapLabel text={`${daysLeft}D`} size="sm" tone="gold" animate={false} />
          until redeploy
        </div>
      )}

      <Board head="Training" solid className="st-board">
        <SBlock label="MT class days" sub="Classes are booked outside the app. The plan works around these.">
          <div className="st-days" role="group" aria-label="MT class days">
            {DAYS.map(({ key, label }) => {
              const on = mtDays.has(key)
              return (
                <button key={key} type="button" aria-pressed={on} aria-label={DAY_NAMES[key]} className={`st-day${on ? ' is-on' : ''}`} onClick={() => toggleDay(key)}>
                  <FlapLabel text={label} size="xs" tone={on ? 'teal' : 'ink'} />
                </button>
              )
            })}
          </div>
        </SBlock>
        <SBlock label="Bag work techniques" sub="Combos using a technique that's off won't appear in sessions.">
          <div className="st-techs">
            {TECHNIQUES.map(({ key, label }) => {
              const on = enabledTechniques.has(key)
              return (
                <div key={key} className="st-tech" onClick={() => setTechnique(key, !on)}>
                  <FlapLabel text={label} size="xs" />
                  <FlapSwitch on={on} onChange={v => setTechnique(key, v)} label={label.toLowerCase()} />
                </div>
              )
            })}
          </div>
        </SBlock>
      </Board>

      <Board head="Alarms" solid className="st-board">
        <SRow label="Morning alarm" sub="The morning report. I'M UP opens Today.">
          <FlapSwitch on={amEnabled} onChange={setAmEnabled} label="Morning alarm" />
        </SRow>
        <SRow label="Time" onClick={() => setCard('am')} ariaLabel={`Morning alarm time, ${timeFlap(amReminder)} ${am.slot.toUpperCase()}. Change`}>
          <TimeValue text={timeFlap(amReminder)} slot={am.slot} />
        </SRow>
        <SRow label="Evening session" sub="A reminder before your PM session.">
          <FlapSwitch on={pmEnabled} onChange={setPmEnabled} label="Evening session" />
        </SRow>
        <SRow label="Session time" onClick={() => setCard('pm')} ariaLabel={`Session time, ${timeFlap(pmSessionTime)} ${pm.slot.toUpperCase()}. Change`}>
          <TimeValue text={timeFlap(pmSessionTime)} slot={pm.slot} />
        </SRow>
        <SRow label="Remind me" onClick={() => setCard('lead')} ariaLabel={`Remind me ${pmLeadMin} minutes before. Change`}>
          <span className="st-val"><FlapLabel text={leadFlap(pmLeadMin)} size="sm" /></span>
        </SRow>
        <p className="st-note">Silent switch on? Alarms go silent. Flip it to ring on training mornings, or turn on Vibrate on Silent in iOS Sounds &amp; Haptics.</p>
      </Board>

      <BodyProfileBoard />

      <WorldTimeBoard>
        <SRow label="Haptics" sub="Taps, timer ends and cues. Off keeps the phone still.">
          <FlapSwitch on={hapticsOn} onChange={handleHaptics} label="Haptics" />
        </SRow>
        <SRow label="Face ID for the Waybook" sub="Asks for Face ID before the Waybook opens.">
          <FlapSwitch on={waybookAuth} onChange={handleWaybookAuth} label="Face ID for the Waybook" />
        </SRow>
      </WorldTimeBoard>

      <Board head="Connections" solid className="st-board">
        <div className="st-row">
          <div className="st-sl">
            <b className="st-strava">Strava{stravaOk && <span className="st-dot" aria-hidden />}</b>
            <small>{stravaLine}</small>
          </div>
          {strava?.connected ? (
            <FlapButton label={disconnecting ? 'DISCONNECTING' : 'DISCONNECT'} size="xs" className="st-sbtn" disabled={disconnecting} onClick={() => void handleDisconnectStrava()} />
          ) : (
            <FlapButton label={connecting ? 'OPENING' : 'CONNECT'} size="xs" className="st-sbtn" disabled={connecting || strava == null} onClick={() => void handleConnectStrava()} />
          )}
        </div>
        <SRow label="One Pace arc" sub="Indoor runs." onClick={() => setCard('opArc')} ariaLabel={`One Pace arc, ${onePaceArc || 'not set'}. Change`}>
          <ChevValue text={onePaceArc.toUpperCase()} emptyCells={4} />
        </SRow>
        <SRow label="Episode" onClick={() => setCard('opEp')} ariaLabel={`One Pace episode, ${onePaceEp || 'not set'}. Change`}>
          <ChevValue text={onePaceEp} />
        </SRow>
        <SRow label="Naruto arc" sub="Indoor runs. Opens Netflix on this episode." onClick={() => setCard('nArc')} ariaLabel={`Naruto arc, ${narutoArc || 'not set'}. Change`}>
          <ChevValue text={narutoArc.toUpperCase()} emptyCells={4} />
        </SRow>
        <SRow label="Episode" onClick={() => setCard('nEp')} ariaLabel={`Naruto episode, ${narutoEp || 'not set'}. Change`}>
          <ChevValue text={narutoEp} />
        </SRow>
      </Board>

      {card === 'am' && <TimeCard title="Morning alarm" value={amReminder} onCancel={() => setCard(null)} onDone={v => { setAmReminder(v); setCard(null) }} />}
      {card === 'pm' && <TimeCard title="Evening session" value={pmSessionTime} onCancel={() => setCard(null)} onDone={v => { setPmSessionTime(v); setCard(null) }} />}
      {card === 'lead' && (
        <NumberCard title="Remind me" sub="Minutes before your PM session." value={pmLeadMin} min={15} max={120} step={15} unit="MIN BEFORE" onCancel={() => setCard(null)} onDone={v => { setPmLeadMin(v); setCard(null) }} />
      )}
      {card === 'opArc' && (
        <ArcCard title="One Pace arc" arcs={ONE_PACE_ARCS} value={(ONE_PACE_ARCS as readonly string[]).includes(onePaceArc) ? onePaceArc : ONE_PACE_ARCS[0]} onCancel={() => setCard(null)} onDone={a => { setOnePaceArc(a); setCard(null) }} />
      )}
      {card === 'opEp' && (
        <NumberCard title="One Pace episode" value={Number(onePaceEp) || 0} min={0} max={999} onCancel={() => setCard(null)} onDone={v => { setOnePaceEp(String(v)); setCard(null) }} />
      )}
      {card === 'nArc' && (
        <ArcCard title="Naruto arc" arcs={NARUTO_ARC_NAMES} value={NARUTO_ARC_NAMES.includes(narutoArc) ? narutoArc : (narutoArcForEp(Number(narutoEp)) ?? NARUTO_ARC_NAMES[0])} onCancel={() => setCard(null)} onDone={a => { setNarutoArc(a); setCard(null) }} />
      )}
      {card === 'nEp' && (
        <NumberCard
          title="Naruto episode"
          sub="The arc follows the episode (approximate). Netflix resumes the episode itself."
          value={Number(narutoEp) || 1}
          min={1}
          max={NARUTO_EPISODES}
          onCancel={() => setCard(null)}
          onDone={v => { setNarutoEp(String(v)); setNarutoArc(narutoArcForEp(v) ?? ''); setCard(null) }}
        />
      )}

      {showReplacementPicker && (
        <SessionPicker
          onSelect={(option: SessionOption) => {
            setShowReplacementPicker(false)
            showToast(`${option.label} added as replacement`, 'success')
          }}
          onClose={() => setShowReplacementPicker(false)}
          filter={(opt: SessionOption) => opt.timeSlot === 'pm'}
        />
      )}
    </SettingsScreen>
  )
}
