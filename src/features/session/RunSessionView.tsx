import { useCallback, useEffect, useRef, useState } from 'react'

import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { onePaceSvg } from '@/lib/markAssets'

interface RunSession {
  id: string
  runType: string | null
  distanceKm: number | null
  durationSec: number | null
  isIndoor: number
  onePaceArc: string | null
  onePaceEp: string | null
}

interface RunPrescription {
  weekNumber: number
  runType: string
  targetDesc: string
  targetDurSec: number | null
  targetDistKm: number | null
}

type RunPhase = 'ready' | 'running' | 'logging'

const RUN_TYPE_LABELS: Record<string, string> = {
  zone2: 'Zone 2 Run',
  easy: 'Easy Run',
  easy_strides: 'Easy + Strides',
  tempo: 'Tempo Run',
  intervals: 'Intervals',
  '5k_test': '5K Test',
}

interface RunSessionViewProps {
  runSession: RunSession
  prescription?: RunPrescription | null
  onComplete: () => void
}

export function RunSessionView({ runSession, prescription, onComplete }: RunSessionViewProps) {
  const [phase, setPhase] = useState<RunPhase>('ready')
  const [isIndoor, setIsIndoor] = useState(runSession.isIndoor === 1)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number>(0)

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

  // Auto-fill One Pace arc/ep from settings if not already set
  useEffect(() => {
    if (runSession.onePaceArc || runSession.onePaceEp) return
    apiFetch<{ onePaceArc?: string | null; onePaceEp?: string | null } | null>('/api/settings')
      .then((s) => {
        if (s?.onePaceArc) setOnePaceArc(s.onePaceArc)
        if (s?.onePaceEp) setOnePaceEp(s.onePaceEp)
      })
      .catch(() => {})
  }, [])

  const startRun = useCallback(() => {
    startedAtRef.current = Date.now()
    setPhase('running')
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 500)
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

  const isZone2 = prescription?.runType === 'zone2'
  const runTypeLabel = prescription
    ? (RUN_TYPE_LABELS[prescription.runType] ?? 'Run')
    : 'Easy Run'
  const runDesc = prescription?.targetDesc
    ?? 'Keep it conversational pace. Focus on form: upright posture, relaxed shoulders, short strides.'
  const timerEstimate = prescription?.targetDurSec ?? 3600

  // Build inscription-style target segments
  const targetSegments: string[] = []
  if (prescription?.targetDurSec) {
    targetSegments.push(`${Math.round(prescription.targetDurSec / 60)} min`)
  }
  if (prescription?.targetDistKm) {
    targetSegments.push(`${prescription.targetDistKm} km`)
  }
  if (isZone2) {
    targetSegments.push('HR 130–145')
    targetSegments.push('nasal breathing')
  }

  if (phase === 'ready') {
    return (
      <div className="animate-fade-in">
        <p className="text-label mb-1 text-muted-foreground">
          {isZone2 ? 'Morning Run' : prescription ? `Week ${prescription.weekNumber}` : 'Run'}
        </p>
        <h2 className="text-display-lg text-foreground">{runTypeLabel}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {runDesc}
        </p>

        {targetSegments.length > 0 && (
          <p className="mt-3 font-[family-name:var(--font-display)] text-xs tracking-wider text-gold/60">
            {targetSegments.join(' · ')}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => setIsIndoor(false)}
            className={`flex-1 rounded-md py-3 text-sm font-medium ${
              !isIndoor ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
            }`}
          >
            Outdoor
          </button>
          <button
            onClick={() => setIsIndoor(true)}
            className={`flex-1 flex items-center justify-center gap-2 rounded-md py-3 text-sm font-medium ${
              isIndoor ? 'bg-teal-dark text-foreground' : 'bg-surface-light text-muted-foreground'
            }`}
          >
            <img src={onePaceSvg} alt="" className="h-5 w-5 object-contain" />
            Indoor
          </button>
        </div>

        {isIndoor ? (
          <div className="mt-8 flex flex-col items-center gap-4">
            <button
              onClick={() => window.open('https://onepace.net', '_blank')}
              className="w-full flex flex-col items-center gap-4 rounded-md border border-gold/15 bg-deep-forest px-6 py-8"
            >
              <img
                src={onePaceSvg}
                alt="One Pace"
                className="h-24 w-24 object-contain"
                style={{ mixBlendMode: 'screen' }}
              />
              <span className="font-[family-name:var(--font-display)] text-sm tracking-wider text-gold/70">
                Open One Pace
              </span>
            </button>
            <button
              onClick={() => setPhase('logging')}
              className="w-full rounded-md border border-border bg-surface-light px-4 py-3 text-sm text-muted-foreground"
            >
              Log Run
            </button>
          </div>
        ) : (
          <div className="mt-8 flex justify-center">
            <Button onClick={startRun} size="lg" style={{ backgroundColor: '#1E8A68' }}>
              Start Run
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (phase === 'running') {
    const estimatedTotal = timerEstimate
    const remaining = Math.max(0, estimatedTotal - elapsed)

    return (
      <div className="flex flex-col items-center py-8 animate-fade-in">
        <RingTimer
          totalSeconds={estimatedTotal}
          secondsRemaining={remaining}
          label="Running"
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
            className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-center text-lg text-foreground placeholder-muted-foreground focus:border-teal-dark focus:outline-none"
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
            className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-center text-lg text-foreground placeholder-muted-foreground focus:border-teal-dark focus:outline-none"
          />
        </div>
      </div>

      {isIndoor && (
        <div className="rounded-md border border-border bg-deep-forest p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={onePaceSvg} alt="" className="h-6 w-6 object-contain" style={{ mixBlendMode: 'screen' }} />
              <p className="text-sm font-medium text-teal">One Pace</p>
            </div>
            <a
              href="https://onepace.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-teal/70 underline decoration-teal/30 active:text-teal"
            >
              onepace.net ↗
            </a>
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-label mb-1 block text-muted-foreground">Arc</label>
              <input type="text" value={onePaceArc} onChange={(e) => setOnePaceArc(e.target.value)}
                placeholder="e.g. Water 7"
                className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
            </div>
            <div className="flex-1">
              <label className="text-label mb-1 block text-muted-foreground">Episode</label>
              <input type="text" value={onePaceEp} onChange={(e) => setOnePaceEp(e.target.value)}
                placeholder="e.g. 3"
                className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
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
