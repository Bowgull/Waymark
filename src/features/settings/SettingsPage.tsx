import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'

import { apiFetch } from '@/lib/api'
import { getApiBaseUrl } from '@/lib/apiBase'
import { scheduleAlarms } from '@/lib/notifications'
import { ONE_PACE_ARCS } from '@/lib/onePace'
import { ScrollDrum, ScrollDrumList } from '@/components/ui/ScrollDrum'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { useToast } from '@/components/ui/Toast'
import { PageHeader } from '@/components/PageHeader'
import { SettingsSkeleton } from '@/components/ui/Skeleton'
import { isBiometryAvailable, isGateEnabled, setGateEnabled } from '@/lib/waybookGate'

interface Settings {
  mtClassDays: string | null
  amReminder: string | null
  pmLeadMin: number | null
  pmSessionTime: string | null
  onePaceArc: string | null
  onePaceEp: string | null
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
}

const TECHNIQUE_OPTIONS = [
  { key: 'boxing', label: 'Boxing' },
  { key: 'kicks', label: 'Kicks' },
  { key: 'defensive', label: 'Defensive' },
  { key: 'knees', label: 'Knees' },
  { key: 'elbows', label: 'Elbows' },
]

const DAY_LABELS = [
  { key: '1', label: 'Mon' },
  { key: '2', label: 'Tue' },
  { key: '3', label: 'Wed' },
  { key: '4', label: 'Thu' },
  { key: '5', label: 'Fri' },
  { key: '6', label: 'Sat' },
  { key: '0', label: 'Sun' },
]

function formatTime12(hhmm: string): string {
  const [hh, mm] = hhmm.split(':').map(Number)
  const is12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return `${is12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`
}

interface NotificationToggleProps {
  label: string
  enabled: boolean
  onToggle: () => void
}

function NotificationToggle({ label, enabled, onToggle }: NotificationToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <button
        type="button"
        onClick={onToggle}
        className={`rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] transition-colors ${
          enabled
            ? 'bg-gold/15 text-gold ring-1 ring-gold/40'
            : 'bg-border text-muted-foreground'
        }`}
      >
        {enabled ? 'On' : 'Off'}
      </button>
    </div>
  )
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const { show: showToast, ToastContainer } = useToast()
  const [showReplacementPicker, setShowReplacementPicker] = useState(false)
  const hydratedRef = useRef(false)

  // Form state
  const [mtDays, setMtDays] = useState<Set<string>>(new Set())
  const [amReminder, setAmReminder] = useState('06:30')
  const [amEnabled, setAmEnabled] = useState(true)
  const [pmLeadMin, setPmLeadMin] = useState(60)
  const [pmSessionTime, setPmSessionTime] = useState('18:00')
  const [pmEnabled, setPmEnabled] = useState(true)
  const [onePaceArc, setOnePaceArc] = useState('')
  const [onePaceEp, setOnePaceEp] = useState('')
  const [enabledTechniques, setEnabledTechniques] = useState<Set<string>>(new Set(['boxing', 'kicks', 'defensive']))
  const [activeDrum, setActiveDrum] = useState<'am' | 'pmTime' | 'pmLead' | 'arc' | null>(null)

  // Close drum on any pointerdown that lands outside the drum body
  useEffect(() => {
    if (!activeDrum) return
    function handleOutside(e: PointerEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-drum-body="true"]')) return
      setActiveDrum(null)
    }
    document.addEventListener('pointerdown', handleOutside)
    return () => document.removeEventListener('pointerdown', handleOutside)
  }, [activeDrum])

  // Strava
  const [strava, setStrava] = useState<StravaStatus | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const [waybookAuth, setWaybookAuth] = useState<boolean>(() => isGateEnabled())
  const [biometryAvailable, setBiometryAvailable] = useState<boolean>(true)

  useEffect(() => {
    let cancelled = false
    isBiometryAvailable().then((avail) => {
      if (!cancelled) setBiometryAvailable(avail)
    })
    return () => { cancelled = true }
  }, [])

  function handleWaybookAuthToggle() {
    const next = !waybookAuth
    setWaybookAuth(next)
    setGateEnabled(next)
    showToast(next ? 'Waybook locked with Face ID' : 'Waybook unlocked', 'success')
  }

  useEffect(() => {
    async function load() {
      try {
        const s = await apiFetch<Settings | null>('/api/settings')
        if (s) {
          setSettings(s)
          setMtDays(new Set((s.mtClassDays ?? '').split(',').filter(Boolean)))
          setAmReminder(s.amReminder ?? '06:30')
          setAmEnabled(s.amEnabled !== 0)
          setPmLeadMin(s.pmLeadMin ?? 60)
          setPmSessionTime(s.pmSessionTime ?? '18:00')
          setPmEnabled(s.pmEnabled !== 0)
          setOnePaceArc(s.onePaceArc ?? '')
          setOnePaceEp(s.onePaceEp ?? '')
          setEnabledTechniques(new Set((s.enabledTechniques ?? 'boxing,kicks,defensive').split(',').filter(Boolean)))
        }
      } catch (e) {
        console.error('Failed to load settings:', e)
      } finally {
        setLoading(false)
        // Defer hydration flag so the form-state effect's first run (post-load) is skipped
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
    const url = `${getApiBaseUrl()}/api/strava/authorize`
    try {
      if (Capacitor.isNativePlatform()) {
        // Opens SFSafariViewController on iOS — app state is preserved.
        // On dismissal, appStateChange listener above will re-fetch status.
        await Browser.open({ url, presentationStyle: 'popover' })
      } else {
        // Web: full navigation. Callback lands on Worker's success page.
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
            enabledTechniques: Array.from(enabledTechniques).join(','),
            amEnabled,
            pmEnabled,
          }),
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setSettings(updated)

        scheduleAlarms(amReminder, pmSessionTime, pmLeadMin, { amEnabled, pmEnabled }).catch(() => {})

        if (updated.cascade && updated.cascade.removed > 0) {
          const days = updated.cascade.freedDays?.join(', ') ?? ''
          showToast(`${days} PM slot${updated.cascade.removed > 1 ? 's' : ''} freed up`, 'info')
          setShowReplacementPicker(true)
        } else {
          showToast('Saved', 'success')
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
  }, [mtDays, amReminder, amEnabled, pmLeadMin, pmSessionTime, pmEnabled, onePaceArc, onePaceEp, enabledTechniques])

  function toggleDay(day: string) {
    const next = new Set(mtDays)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    setMtDays(next)
  }

  function toggleTechnique(tech: string) {
    const next = new Set(enabledTechniques)
    if (next.has(tech)) next.delete(tech)
    else next.add(tech)
    setEnabledTechniques(next)
  }

  if (loading) {
    return <SettingsSkeleton />
  }

  const buildTime = Number(import.meta.env.VITE_BUILD_TIME)
  const daysLeft = Number.isFinite(buildTime) && buildTime > 0
    ? Math.max(0, 7 - Math.floor((Date.now() - buildTime) / 86400000))
    : null
  const daysColor =
    daysLeft === null ? 'text-foreground'
    : daysLeft <= 1 ? 'text-destructive'
    : daysLeft === 2 ? 'text-gold'
    : 'text-foreground'

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" onLogoLongPress={() => navigate('/settings/logs')} />

      {daysLeft !== null && (
        <section
          aria-label="Days until redeploy"
          className="flex w-fit items-baseline gap-1.5 rounded-md border border-gold/10 bg-near-black/40 px-3 py-1.5"
        >
          <span className={`font-[family-name:var(--font-display)] text-base leading-none ${daysColor}`}>
            {daysLeft}d
          </span>
          <span className="text-label text-muted-foreground">until redeploy</span>
        </section>
      )}

      {/* MT Class Schedule */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">MT Class Days</p>
        <div className="flex gap-1.5">
          {DAY_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => toggleDay(key)}
              className={`min-h-[44px] flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
                mtDays.has(key)
                  ? 'bg-teal/20 text-teal ring-1 ring-teal/40'
                  : 'bg-border text-muted-foreground active:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Reminders */}
      <section className="space-y-4">
        <p className="text-sm font-medium text-foreground">Reminders</p>
        <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
          Silent switch on? Alarms go silent. Flip to ring on training mornings, or keep Vibrate on Silent on in iOS Sounds &amp; Haptics.
        </p>

        {/* Morning Alarm */}
        <div className="space-y-2">
          <NotificationToggle
            label="Morning Alarm"
            enabled={amEnabled}
            onToggle={() => setAmEnabled(e => !e)}
          />
          {amEnabled && (
            activeDrum === 'am' ? (() => {
              const [hh, mm] = amReminder.split(':').map(Number)
              const is12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
              const isPm = hh >= 12
              return (
                <div data-drum-body="true" className="animate-fade-in rounded-md border border-gold/30 bg-deep-forest p-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <ScrollDrum min={1} max={12} step={1} value={is12} onChange={(v) => {
                        const h24 = isPm ? (v === 12 ? 12 : v + 12) : (v === 12 ? 0 : v)
                        setAmReminder(`${String(h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
                      }} />
                    </div>
                    <div className="flex-1">
                      <ScrollDrum min={0} max={59} step={1} value={mm} pad={2} onChange={(v) => {
                        setAmReminder(`${String(hh).padStart(2, '0')}:${String(v).padStart(2, '0')}`)
                      }} />
                    </div>
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button onClick={() => { if (isPm) { const h24 = hh - 12; setAmReminder(`${String(h24 < 0 ? h24 + 24 : h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) } }} className={`min-h-[44px] flex-1 rounded py-2 text-sm font-medium ${!isPm ? 'bg-gold/20 text-gold' : 'bg-border text-muted-foreground'}`}>AM</button>
                    <button onClick={() => { if (!isPm) { const h24 = hh + 12; setAmReminder(`${String(h24 >= 24 ? h24 - 24 : h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) } }} className={`min-h-[44px] flex-1 rounded py-2 text-sm font-medium ${isPm ? 'bg-gold/20 text-gold' : 'bg-border text-muted-foreground'}`}>PM</button>
                  </div>
                  <button onClick={() => setActiveDrum(null)} className="mt-3 min-h-[44px] w-full rounded text-center text-sm font-medium text-gold active:text-gold/70">Done</button>
                </div>
              )
            })() : (
              <button onClick={() => setActiveDrum('am')} className="min-h-[44px] w-full rounded-md border border-border bg-border px-3 py-2 text-center text-sm text-foreground">
                {formatTime12(amReminder)}
              </button>
            )
          )}
        </div>

        {/* Evening Session */}
        <div className="space-y-2">
          <NotificationToggle
            label="Evening Session"
            enabled={pmEnabled}
            onToggle={() => setPmEnabled(e => !e)}
          />
          {pmEnabled && (
            <div className="space-y-2">
              {activeDrum === 'pmTime' ? (() => {
                const [hh, mm] = pmSessionTime.split(':').map(Number)
                const is12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
                const isPm = hh >= 12
                return (
                  <div data-drum-body="true" className="animate-fade-in rounded-md border border-gold/30 bg-deep-forest p-3">
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <ScrollDrum min={1} max={12} step={1} value={is12} onChange={(v) => {
                          const h24 = isPm ? (v === 12 ? 12 : v + 12) : (v === 12 ? 0 : v)
                          setPmSessionTime(`${String(h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
                        }} />
                      </div>
                      <div className="flex-1">
                        <ScrollDrum min={0} max={59} step={1} value={mm} pad={2} onChange={(v) => {
                          setPmSessionTime(`${String(hh).padStart(2, '0')}:${String(v).padStart(2, '0')}`)
                        }} />
                      </div>
                    </div>
                    <div className="mt-2 flex gap-1">
                      <button onClick={() => { if (isPm) { const h24 = hh - 12; setPmSessionTime(`${String(h24 < 0 ? h24 + 24 : h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) } }} className={`min-h-[44px] flex-1 rounded py-2 text-sm font-medium ${!isPm ? 'bg-gold/20 text-gold' : 'bg-border text-muted-foreground'}`}>AM</button>
                      <button onClick={() => { if (!isPm) { const h24 = hh + 12; setPmSessionTime(`${String(h24 >= 24 ? h24 - 24 : h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) } }} className={`min-h-[44px] flex-1 rounded py-2 text-sm font-medium ${isPm ? 'bg-gold/20 text-gold' : 'bg-border text-muted-foreground'}`}>PM</button>
                    </div>
                    <button onClick={() => setActiveDrum(null)} className="mt-3 min-h-[44px] w-full rounded text-center text-sm font-medium text-gold active:text-gold/70">Done</button>
                  </div>
                )
              })() : (
                <button onClick={() => setActiveDrum('pmTime')} className="min-h-[44px] w-full rounded-md border border-border bg-border px-3 py-2 text-center text-sm text-foreground">
                  {formatTime12(pmSessionTime)}
                </button>
              )}

              {activeDrum === 'pmLead' ? (
                <div data-drum-body="true" className="rounded-md bg-deep-forest border border-gold/30 animate-fade-in">
                  <ScrollDrum min={15} max={120} step={15} value={pmLeadMin} onChange={setPmLeadMin} suffix="min" />
                  <button onClick={() => setActiveDrum(null)} className="min-h-[44px] w-full rounded text-center text-sm font-medium text-gold active:text-gold/70">Done</button>
                </div>
              ) : (
                <button onClick={() => setActiveDrum('pmLead')} className="min-h-[44px] w-full rounded-md border border-border bg-border px-3 py-2 text-center text-sm text-foreground">
                  {pmLeadMin} min leave-by reminder
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* One Piece */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">One Piece Progress</p>
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">Current Arc</label>
            {activeDrum === 'arc' ? (
              <div data-drum-body="true" className="animate-fade-in rounded-md border border-gold/30 bg-deep-forest p-3">
                <ScrollDrumList
                  items={ONE_PACE_ARCS}
                  value={ONE_PACE_ARCS.includes(onePaceArc as typeof ONE_PACE_ARCS[number]) ? onePaceArc : ONE_PACE_ARCS[0]}
                  onChange={setOnePaceArc}
                  onTap={() => setActiveDrum(null)}
                />
                <button onClick={() => setActiveDrum(null)} className="mt-3 min-h-[44px] w-full rounded text-center text-sm font-medium text-gold active:text-gold/70">Done</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!onePaceArc) setOnePaceArc(ONE_PACE_ARCS[0])
                  setActiveDrum('arc')
                }}
                className="min-h-[44px] w-full truncate rounded-md border border-border bg-border px-3 py-2 text-center text-sm text-foreground"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {onePaceArc || 'Select arc'}
              </button>
            )}
          </div>
          <div className="w-28 shrink-0">
            <label className="mb-1 block text-xs text-muted-foreground">Episode</label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  const n = Math.max(0, (Number(onePaceEp) || 0) - 1)
                  setOnePaceEp(String(n))
                }}
                className="min-h-[44px] w-8 shrink-0 rounded-md bg-border text-muted-foreground active:bg-muted"
              >
                -
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={onePaceEp}
                onChange={(e) => setOnePaceEp(e.target.value)}
                placeholder="0"
                className="min-h-[44px] w-full min-w-0 flex-1 rounded-md border border-border bg-border px-1 py-2 text-center text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const n = (Number(onePaceEp) || 0) + 1
                  setOnePaceEp(String(n))
                }}
                className="min-h-[44px] w-8 shrink-0 rounded-md bg-border text-muted-foreground active:bg-muted"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Bag Work Techniques */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">Bag Work Techniques</p>
        <p className="mb-2 text-xs text-muted-foreground">Combos using disabled techniques won't appear in sessions.</p>
        <div className="flex flex-wrap gap-2">
          {TECHNIQUE_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => toggleTechnique(key)}
              className={`min-h-[44px] rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                enabledTechniques.has(key)
                  ? 'bg-gold/15 text-gold ring-1 ring-gold/40'
                  : 'bg-border text-muted-foreground active:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Body Metrics */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">Body metrics</p>
        <button
          type="button"
          onClick={() => navigate('/metrics')}
          className="flex min-h-[44px] w-full items-center justify-between rounded-md border border-border bg-border/30 px-3 py-2.5 text-left active:bg-border/50"
        >
          <div className="min-w-0">
            <p className="text-sm text-foreground">Weight, resting HR, bodyfat</p>
            <p className="text-xs text-muted-foreground">Log manually for now. Smart scale sync later.</p>
          </div>
          <svg className="h-4 w-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </section>

      {/* Waybook privacy */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">Waybook</p>
        <button
          type="button"
          onClick={handleWaybookAuthToggle}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md border border-border bg-border/30 px-3 py-2.5"
        >
          <div className="min-w-0 text-left">
            <p className="text-sm text-foreground">Require Face ID to open Waybook</p>
            <p className="text-xs text-muted-foreground">
              {biometryAvailable
                ? 'Face ID or passcode. Re-locks after 3 minutes in background.'
                : 'Web preview: no biometry, but the gate still toggles for testing.'}
            </p>
          </div>
          <span
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              waybookAuth ? 'bg-gold' : 'bg-border'
            }`}
            aria-hidden
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-background transition-transform ${
                waybookAuth ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </span>
        </button>
      </section>

      {/* Strava */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">Strava</p>
        {strava?.connected ? (
          <div className="rounded-md border border-border bg-border/30 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">
                  {strava.athleteName ?? `Athlete ${strava.athleteId}`}
                </p>
                <p className="text-xs text-muted-foreground">Runs log themselves.</p>
              </div>
              <button
                onClick={handleDisconnectStrava}
                disabled={disconnecting}
                className="shrink-0 rounded-md border border-border bg-deep-forest px-3 py-1.5 text-xs text-muted-foreground active:text-foreground disabled:opacity-50"
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleConnectStrava}
            disabled={connecting}
            className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-gold/15 px-3 py-2 text-sm font-medium text-gold ring-1 ring-gold/40 active:bg-gold/25 disabled:opacity-50"
          >
            {connecting ? 'Opening Strava…' : 'Connect Strava'}
          </button>
        )}
      </section>


      <ToastContainer />

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
    </div>
  )
}
