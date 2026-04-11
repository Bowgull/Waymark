import { useCallback, useEffect, useRef, useState } from 'react'

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

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function RunSessionView({ runSession, onComplete }: RunSessionViewProps) {
  const [phase, setPhase] = useState<RunPhase>('ready')
  const [isIndoor, setIsIndoor] = useState(runSession.isIndoor === 1)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Logging fields
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
    // Pre-fill duration from timer
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    setDuration(secs > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : String(mins))
    setPhase('logging')
  }

  async function handleSave() {
    setSaving(true)

    // Parse duration (supports "25" for minutes or "25:30" for min:sec)
    let durationSec: number | undefined
    if (duration) {
      const parts = duration.split(':')
      if (parts.length === 2) {
        durationSec = parseInt(parts[0]) * 60 + parseInt(parts[1])
      } else {
        durationSec = parseInt(parts[0]) * 60
      }
    }

    const distanceKm = distance ? parseFloat(distance) : undefined
    const paceSecKm = distanceKm && durationSec ? Math.round(durationSec / distanceKm) : undefined

    try {
      await apiFetch(`/api/run-sessions/${runSession.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          distanceKm,
          durationSec,
          paceSecKm,
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

  // ─── Ready phase ───────────────────────────────────────────

  if (phase === 'ready') {
    return (
      <div>
        <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">Run</p>
        <h2 className="text-2xl font-bold text-zinc-100">Easy Run</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Keep it conversational pace. You should be able to talk comfortably.
          Focus on form: upright posture, relaxed shoulders, short strides.
        </p>

        {/* Indoor toggle */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => setIsIndoor(false)}
            className={`flex-1 rounded-lg py-3 text-sm font-medium ${
              !isIndoor ? 'bg-[#1E8A68] text-zinc-100' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            Outdoor
          </button>
          <button
            onClick={() => setIsIndoor(true)}
            className={`flex-1 rounded-lg py-3 text-sm font-medium ${
              isIndoor ? 'bg-[#1E8A68] text-zinc-100' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            Indoor
          </button>
        </div>

        {isIndoor && (
          <p className="mt-3 text-sm italic text-[#4ACAAA]/80">
            Put on One Pace and enjoy the run.
          </p>
        )}

        <div className="mt-8 flex justify-center">
          <button
            onClick={startRun}
            className="min-h-[48px] rounded-xl bg-[#1E8A68] px-8 py-3 text-base font-bold text-zinc-100 active:bg-[#4ACAAA]"
          >
            Start Run
          </button>
        </div>
      </div>
    )
  }

  // ─── Running phase ─────────────────────────────────────────

  if (phase === 'running') {
    return (
      <div className="flex flex-col items-center py-12">
        <p className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
          {isIndoor ? 'Treadmill' : 'Running'}
        </p>
        <p className="text-8xl font-bold tabular-nums text-zinc-100">
          {formatElapsed(elapsed)}
        </p>
        <p className="mt-2 text-sm text-zinc-500">Elapsed</p>

        <button
          onClick={finishRun}
          className="mt-12 min-h-[48px] rounded-xl bg-[#E8C860] px-8 py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030]"
        >
          Finish Run
        </button>
      </div>
    )
  }

  // ─── Logging phase ─────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-xl font-bold text-zinc-100">Log Your Run</p>
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className="mb-1 block text-xs text-zinc-500">Distance (km)</label>
          <input
            type="number"
            inputMode="decimal"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="5.0"
            className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-lg text-zinc-100 placeholder-zinc-600 focus:border-[#1E8A68] focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs text-zinc-500">Duration (min or min:sec)</label>
          <input
            type="text"
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="25:00"
            className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-lg text-zinc-100 placeholder-zinc-600 focus:border-[#1E8A68] focus:outline-none"
          />
        </div>
      </div>

      {isIndoor && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="mb-3 text-sm font-medium text-[#4ACAAA]">One Pace</p>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-500">Arc</label>
              <input
                type="text"
                value={onePaceArc}
                onChange={(e) => setOnePaceArc(e.target.value)}
                placeholder="e.g. Water 7"
                className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-[#4ACAAA] focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-500">Episode</label>
              <input
                type="text"
                value={onePaceEp}
                onChange={(e) => setOnePaceEp(e.target.value)}
                placeholder="e.g. 3"
                className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-[#4ACAAA] focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="min-h-[48px] w-full rounded-xl bg-[#E8C860] py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030] disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Run'}
      </button>
    </div>
  )
}
