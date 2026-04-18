import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { scheduleAlarms } from '@/lib/notifications'
import { Button } from '@/components/ui/button'
import { ScrollDrum } from '@/components/ui/ScrollDrum'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { useToast } from '@/components/ui/Toast'
import { PageHeader } from '@/components/PageHeader'

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
  const [activeDrum, setActiveDrum] = useState<'am' | 'pmTime' | 'pmLead' | null>(null)
  const [amDrumStep, setAmDrumStep] = useState<'hour' | 'minute'>('hour')
  const [pmTimeDrumStep, setPmTimeDrumStep] = useState<'hour' | 'minute'>('hour')

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
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

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
                <div className="animate-fade-in rounded-md border border-gold/30 bg-deep-forest p-3">
                  <div className="mb-2 flex gap-2 text-center">
                    <button onClick={() => setAmDrumStep('hour')} className={`flex-1 rounded py-1 text-xs font-medium ${amDrumStep === 'hour' ? 'bg-gold/20 text-gold' : 'text-muted-foreground'}`}>Hour</button>
                    <button onClick={() => setAmDrumStep('minute')} className={`flex-1 rounded py-1 text-xs font-medium ${amDrumStep === 'minute' ? 'bg-gold/20 text-gold' : 'text-muted-foreground'}`}>Minute</button>
                  </div>
                  {amDrumStep === 'hour' ? (
                    <ScrollDrum min={1} max={12} step={1} value={is12} onChange={(v) => {
                      const h24 = isPm ? (v === 12 ? 12 : v + 12) : (v === 12 ? 0 : v)
                      setAmReminder(`${String(h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
                    }} />
                  ) : (
                    <ScrollDrum min={0} max={45} step={15} value={Math.round(mm / 15) * 15} onChange={(v) => {
                      setAmReminder(`${String(hh).padStart(2, '0')}:${String(v).padStart(2, '0')}`)
                    }} suffix="min" />
                  )}
                  <div className="mt-2 flex gap-1">
                    <button onClick={() => { if (isPm) { const h24 = hh - 12; setAmReminder(`${String(h24 < 0 ? h24 + 24 : h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) } }} className={`min-h-[44px] flex-1 rounded py-2 text-sm font-medium ${!isPm ? 'bg-gold/20 text-gold' : 'bg-border text-muted-foreground'}`}>AM</button>
                    <button onClick={() => { if (!isPm) { const h24 = hh + 12; setAmReminder(`${String(h24 >= 24 ? h24 - 24 : h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) } }} className={`min-h-[44px] flex-1 rounded py-2 text-sm font-medium ${isPm ? 'bg-gold/20 text-gold' : 'bg-border text-muted-foreground'}`}>PM</button>
                  </div>
                  <button onClick={() => { setActiveDrum(null); setAmDrumStep('hour') }} className="mt-3 min-h-[44px] w-full rounded text-center text-sm font-medium text-gold active:text-gold/70">Done</button>
                </div>
              )
            })() : (
              <button onClick={() => { setActiveDrum('am'); setAmDrumStep('hour') }} className="min-h-[44px] w-full rounded-md border border-border bg-border px-3 py-2 text-center text-sm text-foreground">
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
                <div className="animate-fade-in rounded-md border border-gold/30 bg-deep-forest p-3">
                  <div className="mb-2 flex gap-2 text-center">
                    <button onClick={() => setPmTimeDrumStep('hour')} className={`flex-1 rounded py-1 text-xs font-medium ${pmTimeDrumStep === 'hour' ? 'bg-gold/20 text-gold' : 'text-muted-foreground'}`}>Hour</button>
                    <button onClick={() => setPmTimeDrumStep('minute')} className={`flex-1 rounded py-1 text-xs font-medium ${pmTimeDrumStep === 'minute' ? 'bg-gold/20 text-gold' : 'text-muted-foreground'}`}>Minute</button>
                  </div>
                  {pmTimeDrumStep === 'hour' ? (
                    <ScrollDrum min={1} max={12} step={1} value={is12} onChange={(v) => {
                      const h24 = isPm ? (v === 12 ? 12 : v + 12) : (v === 12 ? 0 : v)
                      setPmSessionTime(`${String(h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
                    }} />
                  ) : (
                    <ScrollDrum min={0} max={45} step={15} value={Math.round(mm / 15) * 15} onChange={(v) => {
                      setPmSessionTime(`${String(hh).padStart(2, '0')}:${String(v).padStart(2, '0')}`)
                    }} suffix="min" />
                  )}
                  <div className="mt-2 flex gap-1">
                    <button onClick={() => { if (isPm) { const h24 = hh - 12; setPmSessionTime(`${String(h24 < 0 ? h24 + 24 : h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) } }} className={`min-h-[44px] flex-1 rounded py-2 text-sm font-medium ${!isPm ? 'bg-gold/20 text-gold' : 'bg-border text-muted-foreground'}`}>AM</button>
                    <button onClick={() => { if (!isPm) { const h24 = hh + 12; setPmSessionTime(`${String(h24 >= 24 ? h24 - 24 : h24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`) } }} className={`min-h-[44px] flex-1 rounded py-2 text-sm font-medium ${isPm ? 'bg-gold/20 text-gold' : 'bg-border text-muted-foreground'}`}>PM</button>
                  </div>
                  <button onClick={() => { setActiveDrum(null); setPmTimeDrumStep('hour') }} className="mt-3 min-h-[44px] w-full rounded text-center text-sm font-medium text-gold active:text-gold/70">Done</button>
                </div>
              )
            })() : (
              <button onClick={() => { setActiveDrum('pmTime'); setPmTimeDrumStep('hour') }} className="min-h-[44px] w-full rounded-md border border-border bg-border px-3 py-2 text-center text-sm text-foreground">
                {(() => { const [hh, mm] = pmSessionTime.split(':').map(Number); const is12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh; return `${is12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}` })()}
              </button>
            )}
          </div>

          {/* Leave-By Reminder */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Leave-By Reminder</label>
            {activeDrum === 'pmLead' ? (
              <div className="rounded-md bg-deep-forest border border-gold/30 animate-fade-in">
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

      {/* One Pace */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">One Pace Progress</p>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">Current Arc</label>
            <input
              type="text"
              value={onePaceArc}
              onChange={(e) => setOnePaceArc(e.target.value)}
              placeholder="e.g. Water 7"
              className="min-h-[44px] w-full rounded-md border border-border bg-border px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">Episode</label>
            <input
              type="text"
              value={onePaceEp}
              onChange={(e) => setOnePaceEp(e.target.value)}
              placeholder="e.g. 3"
              className="min-h-[44px] w-full rounded-md border border-border bg-border px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
            />
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
