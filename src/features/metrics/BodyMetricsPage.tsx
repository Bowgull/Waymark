import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { kgToLbsDisplay } from '@/lib/chartTheme'
import { logger } from '@/lib/logger'
import { PageHeader } from '@/components/PageHeader'
import { Sparkline } from '../history/Sparkline'

interface BodyMetricEntry {
  id: string
  loggedAt: number
  weightKg: number | null
  restingHr: number | null
  bodyfatPct: number | null
  notes: string | null
}

const LBS_PER_KG = 2.20462

function lbsToKg(lbs: number): number {
  return lbs / LBS_PER_KG
}

export function BodyMetricsPage() {
  const [entries, setEntries] = useState<BodyMetricEntry[]>([])
  const [weightLbs, setWeightLbs] = useState('')
  const [restingHr, setRestingHr] = useState('')
  const [bodyfatPct, setBodyfatPct] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function loadEntries() {
    apiFetch<{ entries: BodyMetricEntry[] }>('/api/body-metrics')
      .then(r => setEntries(r.entries))
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        logger.warn('system', 'body-metrics load failed', { message })
      })
  }

  useEffect(() => { loadEntries() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const w = parseFloat(weightLbs)
    if (!weightLbs || isNaN(w) || w <= 0) {
      setError('Weight is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        weightKg: lbsToKg(w),
        loggedAt: Date.now(),
      }
      const hr = parseInt(restingHr, 10)
      if (restingHr && !isNaN(hr)) payload.restingHr = hr
      const bf = parseFloat(bodyfatPct)
      if (bodyfatPct && !isNaN(bf)) payload.bodyfatPct = bf
      if (notes.trim()) payload.notes = notes.trim()

      await apiFetch<{ entry: BodyMetricEntry }>('/api/body-metrics', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      setWeightLbs('')
      setRestingHr('')
      setBodyfatPct('')
      setNotes('')
      loadEntries()
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const weightData = [...entries]
    .filter(e => e.weightKg != null)
    .reverse()
    .map(e => kgToLbsDisplay(e.weightKg!))

  const latest = entries[0]

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <PageHeader title="Body metrics" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Weight (lbs)</span>
          <input
            type="number"
            step="0.1"
            min="1"
            value={weightLbs}
            onChange={e => setWeightLbs(e.target.value)}
            placeholder="185"
            className="min-h-[44px] rounded-md border border-border bg-secondary/50 px-3 py-2 text-base text-foreground placeholder:text-muted-foreground/50 focus:border-gold/60 focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Resting HR</span>
            <input
              type="number"
              step="1"
              min="1"
              value={restingHr}
              onChange={e => setRestingHr(e.target.value)}
              placeholder="60"
              className="min-h-[44px] rounded-md border border-border bg-secondary/50 px-3 py-2 text-base text-foreground placeholder:text-muted-foreground/50 focus:border-gold/60 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Bodyfat %</span>
            <input
              type="number"
              step="0.1"
              min="1"
              max="60"
              value={bodyfatPct}
              onChange={e => setBodyfatPct(e.target.value)}
              placeholder="18"
              className="min-h-[44px] rounded-md border border-border bg-secondary/50 px-3 py-2 text-base text-foreground placeholder:text-muted-foreground/50 focus:border-gold/60 focus:outline-none"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Notes</span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="dehydrated, post-travel, etc."
            rows={2}
            className="resize-none rounded-md border border-border bg-secondary/50 px-3 py-2 text-base text-foreground placeholder:text-muted-foreground/50 focus:border-gold/60 focus:outline-none"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] rounded-md border border-gold/40 px-5 py-2 text-sm text-gold transition-colors hover:border-gold/70 hover:bg-gold/10 disabled:opacity-40"
        >
          {saving ? 'Saving' : 'Commit'}
        </button>
      </form>

      {weightData.length >= 2 && (
        <div className="flex items-center gap-4 rounded-md border border-border bg-secondary/30 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Weight</span>
            {latest?.weightKg && (
              <span className="text-lg text-foreground">
                {kgToLbsDisplay(latest.weightKg)} lbs
              </span>
            )}
          </div>
          <Sparkline data={weightData} width={120} height={32} className="ml-auto" />
        </div>
      )}

      {entries.length > 0 && (
        <ul className="flex flex-col gap-0">
          {entries.slice(0, 10).map((entry, i) => (
            <li
              key={entry.id}
              className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 text-sm ${i < entries.length - 1 ? 'border-b border-border/50' : ''}`}
            >
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {new Date(entry.loggedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              {entry.weightKg != null && (
                <span className="text-foreground">{kgToLbsDisplay(entry.weightKg)} lbs</span>
              )}
              {entry.restingHr != null && (
                <span className="text-muted-foreground">{entry.restingHr} bpm</span>
              )}
              {entry.bodyfatPct != null && (
                <span className="text-muted-foreground">{entry.bodyfatPct}%</span>
              )}
              {entry.notes && (
                <span className="text-muted-foreground/60 italic">{entry.notes}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground/60">No marks yet. Show up a few more times and they start showing up.</p>
      )}
    </div>
  )
}
