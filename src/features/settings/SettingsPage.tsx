import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { apiFetch } from '@/lib/api'
import { scheduleAlarms } from '@/lib/notifications'
import { ONE_PACE_ARCS } from '@/lib/onePace'
import { Button } from '@/components/ui/button'
import { ScrollDrum, ScrollDrumList } from '@/components/ui/ScrollDrum'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { useToast } from '@/components/ui/Toast'
import { PageHeader } from '@/components/PageHeader'
import { SettingsSkeleton } from '@/components/ui/Skeleton'

interface Settings {
  mtClassDays: string | null
  amReminder: string | null
  pmLeadMin: number | null
  pmSessionTime: string | null
  onePaceArc: string | null
  onePaceEp: string | null
  lastDeploy: number | null
  enabledTechniques: string | null
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

export function SettingsPage() {
  const navigate = useNavigate()
  const [, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const { show: showToast, ToastContainer } = useToast()
  const [showReplacementPicker, setShowReplacementPicker] = useState(false)

  // Form state
  const [mtDays, setMtDays] = useState<Set<string>>(new Set())
  const [amReminder, setAmReminder] = useState('')
  const [pmLeadMin, setPmLeadMin] = useState(60)
  const [pmSessionTime, setPmSessionTime] = useState('18:00')
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

  useEffect(() => {
    async function load() {
      try {
        const s = await apiFetch<Settings | null>('/api/settings')
        if (s) {
          setSettings(s)
          setMtDays(new Set((s.mtClassDays ?? '').split(',').filter(Boolean)))
          setAmReminder(s.amReminder ?? '06:30')
          setPmLeadMin(s.pmLeadMin ?? 60)
          setPmSessionTime(s.pmSessionTime ?? '18:00')
          setOnePaceArc(s.onePaceArc ?? '')
          setOnePaceEp(s.onePaceEp ?? '')
          setEnabledTechniques(new Set((s.enabledTechniques ?? 'boxing,kicks,defensive').split(',').filter(Boolean)))
        }
      } catch (e) {
        console.error('Failed to load settings:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    async function loadStrava() {
      try {
        const s = await apiFetch<StravaStatus>('/api/strava/status')
        setStrava(s)
      } catch (e) {
        console.error('Failed to load Strava status:', e)
        setStrava({ connected: false })
      }
    }
    loadStrava()

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
  }, [showToast])

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

  async function handleSave() {
    setSaving(true)
    setSaved(false)
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
        }),
      })
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)

      // Re-schedule alarms with updated values
      scheduleAlarms(amReminder, pmSessionTime, pmLeadMin)

      // Show cascade feedback if MT days changed
      if (updated.cascade) {
        if (updated.cascade.removed > 0) {
          const days = updated.cascade.freedDays?.join(', ') ?? ''
          showToast(`${days} PM slot${updated.cascade.removed > 1 ? 's' : ''} freed up`, 'info')
          setShowReplacementPicker(true)
        } else {
          showToast('MT schedule updated', 'success')
        }
      }
    } catch (e) {
      console.error('Failed to save settings:', e)
    } finally {
      setSaving(false)
    }
  }

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
        <div className="flex gap-2">
          {DAY_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => toggleDay(key)}
              className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
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
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">Reminders</p>
        <div className="space-y-3">
          {/* Morning Alarm */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Morning Alarm</label>
            {activeDrum === 'am' ? (() => {
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
                {(() => { const [hh, mm] = amReminder.split(':').map(Number); const is12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh; return `${is12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}` })()}
              </button>
            )}
          </div>

          {/* Evening Session Time */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Evening Session Time</label>
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
                {(() => { const [hh, mm] = pmSessionTime.split(':').map(Number); const is12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh; return `${is12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}` })()}
              </button>
            )}
          </div>

          {/* Leave-By Reminder */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Leave-By Reminder</label>
            {activeDrum === 'pmLead' ? (
              <div data-drum-body="true" className="rounded-md bg-deep-forest border border-gold/30 animate-fade-in">
                <ScrollDrum min={15} max={120} step={15} value={pmLeadMin} onChange={setPmLeadMin} suffix="min" />
                <button onClick={() => setActiveDrum(null)} className="min-h-[44px] w-full rounded text-center text-sm font-medium text-gold active:text-gold/70">Done</button>
              </div>
            ) : (
              <button onClick={() => setActiveDrum('pmLead')} className="min-h-[44px] w-full rounded-md border border-border bg-border px-3 py-2 text-center text-sm text-foreground">
                {pmLeadMin} min before evening session
              </button>
            )}
          </div>
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
                className="min-h-[44px] w-full min-w-0 flex-1 rounded-md border border-border bg-border px-1 py-2 text-center text-sm text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
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
              className={`rounded-md px-3 py-2 text-xs font-medium transition-colors ${
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

      {/* Strava */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">Strava</p>
        {strava?.connected ? (
          <div className="rounded-md border border-border bg-border/30 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">
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
          <a
            href="/api/strava/authorize"
            className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-gold/15 px-3 py-2 text-sm font-medium text-gold ring-1 ring-gold/40 active:bg-gold/25"
          >
            Connect Strava
          </a>
        )}
      </section>

      {/* Save */}
      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </Button>

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
