import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'

const LAST_CHECK_KEY = 'waymark.injury_check_last'
const CHECK_INTERVAL_DAYS = 14

export function InjuryCheckCard() {
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_CHECK_KEY)
      if (!last) {
        setVisible(true)
        return
      }
      const lastMs = Number(last)
      if (!Number.isFinite(lastMs)) {
        setVisible(true)
        return
      }
      const daysSince = (Date.now() - lastMs) / (86400 * 1000)
      if (daysSince >= CHECK_INTERVAL_DAYS) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [])

  function markChecked() {
    try {
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
    } catch {
      // storage blocked, skip
    }
  }

  async function handleCommit() {
    setSubmitting(true)
    try {
      await apiFetch('/api/user-profile/injury-check', {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || null }),
      })
      markChecked()
      setVisible(false)
    } catch (e) {
      console.error('Failed to save injury note:', e)
      setSubmitting(false)
    }
  }

  function handleAllClear() {
    markChecked()
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="rounded-md border border-gold/15 bg-near-black/50 p-4 space-y-3">
      <div>
        <p className="text-display text-gold">Body Check</p>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          Anything flaring up. Joints, pulls, old issues coming back.
        </p>
      </div>

      {expanded ? (
        <>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="Left knee twinging on squats. Right shoulder tight."
            className="w-full resize-none rounded-md border border-gold/10 bg-deep-forest px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 focus:border-gold/40 focus:outline-none"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              onClick={handleCommit}
              disabled={submitting || !note.trim()}
              className="flex-1"
            >
              {submitting ? 'Saving.' : 'Commit'}
            </Button>
            <button
              onClick={() => { setExpanded(false); setNote('') }}
              className="px-3 py-2 text-sm text-muted-foreground active:text-foreground"
            >
              Close
            </button>
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          <Button onClick={() => setExpanded(true)} className="flex-1">
            Flag something
          </Button>
          <button
            onClick={handleAllClear}
            className="px-3 py-2 text-sm text-muted-foreground active:text-foreground"
          >
            All clear
          </button>
        </div>
      )}
    </div>
  )
}
