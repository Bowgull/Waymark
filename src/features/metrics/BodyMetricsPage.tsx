import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Board, FlapButton, glowRow, showPop } from '@/design'
import { apiFetch, idempotencyHeaders } from '@/lib/api'
import { bodyLbs, lbsToKg } from '@/lib/units'
import { logger } from '@/lib/logger'
import { FlapNumber, SettingsScreen } from '../settings/settingsParts'
import { cleanNumber, histDate, todayFlap } from '../settings/settingsModel'
import { Sparkline } from '../history/Sparkline'

interface BodyMetricEntry {
  id: string
  /** Unix seconds (the server normalises). */
  loggedAt: number
  weightKg: number | null
  restingHr: number | null
  bodyfatPct: number | null
  notes: string | null
}

/**
 * Body metrics, page 37 (approved): Log today (weight, resting HR and
 * bodyfat as flap numbers you tap to type, a notes box, LOG), then History,
 * newest first. The fields start from the last entry. Weight is in lb
 * everywhere on screen (typed in lb, stored as weightKg).
 */
export function BodyMetricsPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<BodyMetricEntry[]>([])
  const [weightLbs, setWeightLbs] = useState('')
  const [restingHr, setRestingHr] = useState('')
  const [bodyfatPct, setBodyfatPct] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)
  const boardRef = useRef<HTMLDivElement>(null)

  function loadEntries() {
    apiFetch<{ entries: BodyMetricEntry[] }>('/api/body-metrics')
      .then(r => {
        setEntries(r.entries)
        const last = r.entries[0]
        if (!seeded.current && last) {
          seeded.current = true
          if (last.weightKg != null) setWeightLbs(String(bodyLbs(last.weightKg)))
          if (last.restingHr != null) setRestingHr(String(last.restingHr))
          if (last.bodyfatPct != null) setBodyfatPct(String(last.bodyfatPct))
        }
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        logger.warn('system', 'body-metrics load failed', { message }, 'GET /body-metrics failed. Network or 5xx.')
      })
  }

  useEffect(() => { loadEntries() }, [])

  async function handleLog() {
    const row = boardRef.current?.querySelector('.wm-board') ?? null
    const w = parseFloat(weightLbs)
    if (!weightLbs || isNaN(w) || w <= 0) {
      setError('Weight is required.')
      glowRow(row, 'bad')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        weightKg: lbsToKg(w),
        loggedAt: Math.floor(Date.now() / 1000),
      }
      const hr = parseInt(restingHr, 10)
      if (restingHr && !isNaN(hr)) payload.restingHr = hr
      const bf = parseFloat(bodyfatPct)
      if (bodyfatPct && !isNaN(bf)) payload.bodyfatPct = bf
      if (notes.trim()) payload.notes = notes.trim()

      await apiFetch<{ entry: BodyMetricEntry }>('/api/body-metrics', {
        method: 'POST',
        headers: idempotencyHeaders(),
        body: JSON.stringify(payload),
      })

      setNotes('')
      glowRow(row, 'good')
      showPop('Logged.', 'good')
      loadEntries()
    } catch {
      setError('Could not save. Try again.')
      glowRow(row, 'bad')
    } finally {
      setSaving(false)
    }
  }

  const weightData = [...entries]
    .filter(e => e.weightKg != null)
    .reverse()
    .map(e => bodyLbs(e.weightKg!))

  const latest = entries[0]
  const fields: { label: string; unit: string; value: string; set: (v: string) => void; decimal: boolean; max: number }[] = [
    { label: 'WEIGHT', unit: 'LBS', value: weightLbs, set: v => setWeightLbs(cleanNumber(v, 5)), decimal: true, max: 5 },
    { label: 'RESTING HR', unit: 'BPM', value: restingHr, set: v => setRestingHr(cleanNumber(v, 3).replace('.', '')), decimal: false, max: 3 },
    { label: 'BODYFAT', unit: '%', value: bodyfatPct, set: v => setBodyfatPct(cleanNumber(v, 4)), decimal: true, max: 4 },
  ]

  return (
    <SettingsScreen title="BODY" backLabel="SETTINGS" onBack={() => navigate('/settings')}>
      <div ref={boardRef}>
        <Board head="Log today" headRight={<span className="wm-label">{todayFlap(new Date())}</span>} solid className="st-board">
          <div className="st-fields">
            {fields.map(f => (
              <label key={f.label} className="st-fld">
                <span className="wm-label">{f.label}</span>
                <FlapNumber value={f.value} onChange={f.set} label={f.label.toLowerCase()} decimal={f.decimal} maxChars={f.max} placeholderCells={f.max > 3 ? 3 : 2} size={f.value.length > 4 ? 'md' : 'lg'} />
                <span className="wm-label">{f.unit}</span>
              </label>
            ))}
          </div>
          <textarea className="st-nt" aria-label="Notes" placeholder="Dehydrated, post-travel, etc." value={notes} onChange={e => setNotes(e.target.value)} />
          {error && <p className="wm-row-note" role="alert">{error}</p>}
          <div className="wm-btns st-logbtn">
            <FlapButton label={saving ? 'SAVING' : 'LOG'} primary disabled={saving} onClick={() => void handleLog()} />
          </div>
        </Board>
      </div>

      <Board head="History" solid className="st-board">
        {entries.length === 0 ? (
          <p className="st-empty">No body metrics logged.</p>
        ) : entries.slice(0, 10).map(entry => (
          <div key={entry.id} className="st-hist">
            <span className="d">{histDate(entry.loggedAt * 1000)}</span>
            {entry.weightKg != null && <span className="w">{bodyLbs(entry.weightKg)}</span>}
            {entry.restingHr != null && <span className="o">{entry.restingHr} bpm</span>}
            {entry.bodyfatPct != null && <span className="o">{entry.bodyfatPct}%</span>}
            {entry.notes && <i>{entry.notes}</i>}
          </div>
        ))}
      </Board>

      {/* Not on page 37 (owner to place): the weight trend line, kept as it was. */}
      {weightData.length >= 2 && (
        <div className="flex items-center gap-4 rounded-md border border-border bg-secondary/30 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Weight</span>
            {latest?.weightKg && (
              <span className="text-lg text-foreground">
                {bodyLbs(latest.weightKg)} lbs
              </span>
            )}
          </div>
          <Sparkline data={weightData} width={120} height={32} className="ml-auto" />
        </div>
      )}
    </SettingsScreen>
  )
}
