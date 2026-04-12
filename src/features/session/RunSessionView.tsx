import { useCallback, useEffect, useRef, useState } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'

interface RunSession {
  id: string
  runType: string | null
  distanceKm: number | null
  durationSec: number | null
  isIndoor: number
  onePaceArc: string | null
  onePaceEp: string | null
}

type RunPhase = 'ready' | 'running' | 'logging'

interface RunSessionViewProps {
  runSession: RunSession
  onComplete: () => void
}

export function RunSessionView({ runSession, onComplete }: RunSessionViewProps) {
  const [phase, setPhase] = useState<RunPhase>('ready')
  const [isIndoor, setIsIndoor] = useState(runSession.isIndoor === 1)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [distance, setDistance] = useState('')
  const [duration, setDuration] = useState('')
  const [onePaceArc, setOnePaceArc] = useState(runSession.onePaceArc ?? '')
  const [onePaceEp, setOnePaceEp] = useState(runSession.onePaceEp ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const startRun = useCallback(() => {
    setPhase('running')
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)
  }, [])

  function finishRun() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    setDuration(secs > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : String(mins))
    setPhase('logging')
  }

  async function handleSave() {
    setSaving(true)
    let durationSec: number | undefined
    if (duration) {
      const parts = duration.split(':')
      durationSec = parts.length === 2
        ? parseInt(parts[0]) * 60 + parseInt(parts[1])
        : parseInt(parts[0]) * 60
    }
    const distanceKm = distance ? parseFloat(distance) : undefined
    const paceSecKm = distanceKm && durationSec ? Math.round(durationSec / distanceKm) : undefined

    try {
      await apiFetch(`/api/run-sessions/${runSession.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          distanceKm, durationSec, paceSecKm,
          isIndoor: isIndoor ? 1 : 0,
          onePaceArc: isIndoor && onePaceArc ? onePaceArc : undefined,
          onePaceEp: isIndoor && onePaceEp ? onePaceEp : undefined,
        }),
      })
      onComplete()
    } catch (e) {
      console.error('Failed to save run:', e)
      setSaving(false)
    }
  }

  if (phase === 'ready') {
    return (
      <div className="animate-fade-in">
        <p className="text-label mb-1 text-muted-foreground">Run</p>
        <h2 className="text-display-lg text-foreground">Easy Run</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Keep it conversational pace. Focus on form: upright posture, relaxed shoulders, short strides.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => setIsIndoor(false)}
            className={`flex-1 py-3 text-sm font-medium ${
              !isIndoor ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
            }`}
          >
            Outdoor
          </button>
          <button
            onClick={() => setIsIndoor(true)}
            className={`flex-1 py-3 text-sm font-medium ${
              isIndoor ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
            }`}
          >
            Indoor
          </button>
        </div>

        {isIndoor && (
          <p className="mt-3 text-sm italic text-teal/80">
            Put on One Pace and enjoy the run.
          </p>
        )}

        <div className="mt-8 flex justify-center">
          <Button onClick={startRun} size="lg" style={{ backgroundColor: '#1E8A68' }}>
            Start Run
          </Button>
        </div>
      </div>
    )
  }

  if (phase === 'running') {
    const estimatedTotal = 3600
    const remaining = Math.max(0, estimatedTotal - elapsed)

    return (
      <div className="flex flex-col items-center py-8 animate-fade-in">
        <RingTimer
          totalSeconds={estimatedTotal}
          secondsRemaining={remaining}
          label={isIndoor ? 'Treadmill' : 'Running'}
          accentColor="#1E8A68"
          size={260}
        />
        <Button onClick={finishRun} size="lg" className="mt-8">
          Finish Run
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="text-center">
        <p className="text-display text-foreground">Log Your Run</p>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className="text-label mb-1 block text-muted-foreground">Distance (km)</label>
          <input
            type="number"
            inputMode="decimal"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="5.0"
            className="min-h-[44px] w-full border border-border bg-surface px-3 py-2 text-center text-lg text-foreground placeholder-muted-foreground focus:border-teal-dark focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="text-label mb-1 block text-muted-foreground">Duration</label>
          <input
            type="text"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="25:00"
            className="min-h-[44px] w-full border border-border bg-surface px-3 py-2 text-center text-lg text-foreground placeholder-muted-foreground focus:border-teal-dark focus:outline-none"
          />
        </div>
      </div>

      {isIndoor && (
        <div className="border border-border bg-deep-forest p-4">
          <p className="mb-3 text-sm font-medium text-teal">One Pace</p>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-label mb-1 block text-muted-foreground">Arc</label>
              <input type="text" value={onePaceArc} onChange={(e) => setOnePaceArc(e.target.value)}
                placeholder="e.g. Water 7"
                className="min-h-[44px] w-full border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
            </div>
            <div className="flex-1">
              <label className="text-label mb-1 block text-muted-foreground">Episode</label>
              <input type="text" value={onePaceEp} onChange={(e) => setOnePaceEp(e.target.value)}
                placeholder="e.g. 3"
                className="min-h-[44px] w-full border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
            </div>
          </div>
        </div>
      )}

      <Button onClick={handleSave} disabled={saving} size="lg" className="w-full">
        {saving ? 'Saving...' : 'Save Run'}
      </Button>
    </div>
  )
}
