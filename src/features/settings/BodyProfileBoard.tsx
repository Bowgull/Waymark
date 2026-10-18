import { useEffect, useState, type MouseEvent } from 'react'

import { Board, FlapButton, glowRow, showPop } from '@/design'
import { apiFetch } from '@/lib/api'

interface Profile {
  dob: string | null
  maxHr: number | null
  injuries: string | null
}

/**
 * What the coach needs from you (onboarding isn't redesigned): birth date
 * (max HR estimate until real runs refine it), max HR if you know it, and
 * your back / pain status. Saved with PATCH /api/user-profile. Minimal board
 * in the new style; the full Settings boards (page 37) come later.
 */
export function BodyProfileBoard() {
  const [dob, setDob] = useState('')
  const [maxHr, setMaxHr] = useState('')
  const [injuries, setInjuries] = useState('')
  const [initial, setInitial] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    apiFetch<Profile | null>('/api/user-profile')
      .then(p => {
        if (!alive) return
        const profile = { dob: p?.dob ?? null, maxHr: p?.maxHr ?? null, injuries: p?.injuries ?? null }
        setInitial(profile)
        setDob(profile.dob ?? '')
        setMaxHr(profile.maxHr != null ? String(profile.maxHr) : '')
        setInjuries(profile.injuries ?? '')
      })
      .catch(() => { if (alive) setInitial({ dob: null, maxHr: null, injuries: null }) })
    return () => { alive = false }
  }, [])

  async function save(e: MouseEvent<HTMLButtonElement>) {
    const row = (e.currentTarget as HTMLElement).closest('.wm-board')
    setError(null)
    const hr = maxHr.trim() === '' ? null : Number(maxHr)
    if (hr != null && (!Number.isInteger(hr) || hr < 120 || hr > 230)) {
      setError('Max HR is a whole number from 120 to 230, or empty.')
      glowRow(row, 'bad')
      return
    }
    setSaving(true)
    try {
      const saved = await apiFetch<Profile>('/api/user-profile', {
        method: 'PATCH',
        body: JSON.stringify({ dob: dob || null, maxHr: hr, injuries: injuries.trim() || null }),
      })
      setInitial({ dob: saved.dob ?? null, maxHr: saved.maxHr ?? null, injuries: saved.injuries ?? null })
      glowRow(row, 'good')
      showPop('Saved.', 'good')
    } catch (err) {
      let reason: string | null = null
      try { reason = (JSON.parse((err as { body?: string }).body ?? '') as { error?: string }).error ?? null } catch { reason = null }
      setError(reason ?? "Couldn't save. Check your connection.")
      glowRow(row, 'bad')
    } finally {
      setSaving(false)
    }
  }

  const dirty = initial != null && (
    (initial.dob ?? '') !== dob ||
    (initial.maxHr != null ? String(initial.maxHr) : '') !== maxHr.trim() ||
    (initial.injuries ?? '') !== injuries
  )

  return (
    <Board head="For the coach" solid>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="wm-label">Birth date</span>
          <input className="wm-input" type="date" value={dob} max={new Date().toISOString().slice(0, 10)} onChange={e => setDob(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="wm-label">Max heart rate</span>
          <input className="wm-input" type="number" inputMode="numeric" min={120} max={230} placeholder="From your birth date" value={maxHr} onChange={e => setMaxHr(e.target.value)} />
          <span className="wm-prose is-dim">Leave it empty and it comes from your birth date. Real runs raise it.</span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="wm-label">Back and pain</span>
          <textarea className="wm-input" rows={3} maxLength={1000} placeholder="Lower back stiffness. Right shoulder occasionally." value={injuries} onChange={e => setInjuries(e.target.value)} />
        </label>
        {error && <p className="wm-row-note" role="alert">{error}</p>}
        <FlapButton label={saving ? 'SAVING' : 'SAVE'} primary onClick={e => void save(e)} disabled={saving || !dirty} />
      </div>
    </Board>
  )
}
