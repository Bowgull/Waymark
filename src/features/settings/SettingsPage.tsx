import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

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
        <p className="text-sm text-zinc-500">Loading...</p>
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
      <h2 className="text-xl font-semibold text-zinc-100">Settings</h2>

      {/* MT Class Schedule */}
      <section>
        <p className="mb-2 text-sm font-medium text-zinc-300">MT Class Days</p>
        <div className="flex gap-2">
          {DAY_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => toggleDay(key)}
              className={`flex-1 rounded-lg py-2 text-xs font-medium ${
                mtDays.has(key)
                  ? 'bg-[#4ACAAA] text-zinc-950'
                  : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Notifications */}
      <section>
        <p className="mb-2 text-sm font-medium text-zinc-300">Notifications</p>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-zinc-500">AM Reminder</label>
            <input
              type="time"
              value={amReminder}
              onChange={(e) => setAmReminder(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-[#4ACAAA] focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-zinc-500">PM Lead (min)</label>
            <input
              type="number"
              inputMode="numeric"
              value={pmLeadMin}
              onChange={(e) => setPmLeadMin(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-sm text-zinc-100 focus:border-[#4ACAAA] focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* One Pace */}
      <section>
        <p className="mb-2 text-sm font-medium text-zinc-300">One Pace Progress</p>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-zinc-500">Current Arc</label>
            <input
              type="text"
              value={onePaceArc}
              onChange={(e) => setOnePaceArc(e.target.value)}
              placeholder="e.g. Water 7"
              className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-[#4ACAAA] focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-zinc-500">Episode</label>
            <input
              type="text"
              value={onePaceEp}
              onChange={(e) => setOnePaceEp(e.target.value)}
              placeholder="e.g. 3"
              className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-[#4ACAAA] focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Deploy Reminder */}
      <section>
        <p className="mb-2 text-sm font-medium text-zinc-300">Deploy Reminder</p>
        <div className={`rounded-xl border p-4 ${deployWarning ? 'border-red-500/50 bg-red-900/10' : 'border-zinc-800 bg-zinc-900'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-100">Last deployed: {deployDate}</p>
              {daysSinceDeploy != null && (
                <p className={`text-xs ${deployWarning ? 'text-red-400' : 'text-zinc-500'}`}>
                  {daysSinceDeploy} days ago {deployWarning ? '— redeploy soon!' : ''}
                </p>
              )}
            </div>
            <button
              onClick={handleMarkDeployed}
              className="min-h-[36px] rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 active:bg-zinc-700"
            >
              Mark Deployed
            </button>
          </div>
        </div>
      </section>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="min-h-[48px] w-full rounded-xl bg-[#E8C860] py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030] disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  )
}
