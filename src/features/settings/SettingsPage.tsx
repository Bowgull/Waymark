import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface Settings {
  mtClassDays: string | null
  amReminder: string | null
  pmLeadMin: number | null
  onePaceArc: string | null
  onePaceEp: string | null
  lastDeploy: number | null
}

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
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Form state
  const [mtDays, setMtDays] = useState<Set<string>>(new Set())
  const [amReminder, setAmReminder] = useState('')
  const [pmLeadMin, setPmLeadMin] = useState('')
  const [onePaceArc, setOnePaceArc] = useState('')
  const [onePaceEp, setOnePaceEp] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const s = await apiFetch<Settings | null>('/api/settings')
        if (s) {
          setSettings(s)
          setMtDays(new Set((s.mtClassDays ?? '').split(',').filter(Boolean)))
          setAmReminder(s.amReminder ?? '06:30')
          setPmLeadMin(String(s.pmLeadMin ?? 60))
          setOnePaceArc(s.onePaceArc ?? '')
          setOnePaceEp(s.onePaceEp ?? '')
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
          pmLeadMin: parseInt(pmLeadMin) || 60,
          onePaceArc: onePaceArc || null,
          onePaceEp: onePaceEp || null,
        }),
      })
      setSettings(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error('Failed to save settings:', e)
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkDeployed() {
    const nowSec = Math.floor(Date.now() / 1000)
    try {
      const updated = await apiFetch<Settings>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ lastDeploy: nowSec }),
      })
      setSettings(updated)
    } catch (e) {
      console.error('Failed to mark deployed:', e)
    }
  }

  function toggleDay(day: string) {
    const next = new Set(mtDays)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    setMtDays(next)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  const deployDate = settings?.lastDeploy
    ? new Date(settings.lastDeploy * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never'
  const daysSinceDeploy = settings?.lastDeploy
    ? Math.floor((Date.now() / 1000 - settings.lastDeploy) / 86400)
    : null
  const deployWarning = daysSinceDeploy != null && daysSinceDeploy >= 6

  return (
    <div className="space-y-6">
      <h2 className="text-display-lg text-foreground">Settings</h2>

      {/* MT Class Schedule */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">MT Class Days</p>
        <div className="flex gap-2">
          {DAY_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => toggleDay(key)}
              className={`flex-1 py-2 text-xs font-medium ${
                mtDays.has(key)
                  ? 'bg-[#4ACAAA] text-background'
                  : 'bg-border text-muted-foreground active:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Notifications */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">Notifications</p>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">AM Reminder</label>
            <input
              type="time"
              value={amReminder}
              onChange={(e) => setAmReminder(e.target.value)}
              className="min-h-[44px] w-full border border-border bg-border px-3 py-2 text-sm text-foreground focus:border-[#4ACAAA] focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">PM Lead (min)</label>
            <input
              type="number"
              inputMode="numeric"
              value={pmLeadMin}
              onChange={(e) => setPmLeadMin(e.target.value)}
              className="min-h-[44px] w-full border border-border bg-border px-3 py-2 text-center text-sm text-foreground focus:border-[#4ACAAA] focus:outline-none"
            />
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
              className="min-h-[44px] w-full border border-border bg-border px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-[#4ACAAA] focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">Episode</label>
            <input
              type="text"
              value={onePaceEp}
              onChange={(e) => setOnePaceEp(e.target.value)}
              placeholder="e.g. 3"
              className="min-h-[44px] w-full border border-border bg-border px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-[#4ACAAA] focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Deploy Reminder */}
      <section>
        <p className="mb-2 text-sm font-medium text-foreground">Deploy Reminder</p>
        <div className={`border p-4 ${deployWarning ? 'border-red-500/50 bg-red-900/10' : 'border-border bg-card'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">Last deployed: {deployDate}</p>
              {daysSinceDeploy != null && (
                <p className={`text-xs ${deployWarning ? 'text-red-400' : 'text-muted-foreground'}`}>
                  {daysSinceDeploy} days ago {deployWarning ? '— redeploy soon!' : ''}
                </p>
              )}
            </div>
            <button
              onClick={handleMarkDeployed}
              className="min-h-[36px] bg-border px-3 py-1.5 text-xs font-medium text-foreground active:bg-muted"
            >
              Mark Deployed
            </button>
          </div>
        </div>
      </section>

      {/* Save */}
      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </Button>
    </div>
  )
}
