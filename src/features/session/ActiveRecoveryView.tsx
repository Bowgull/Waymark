import { useState } from 'react'

import { apiFetch } from '@/lib/api'

interface RecoverySession {
  id: string
  hipMobility: number
  foamRolling: number
}

interface ActiveRecoveryViewProps {
  recoverySession: RecoverySession
  onComplete: () => void
}

export function ActiveRecoveryView({ recoverySession, onComplete }: ActiveRecoveryViewProps) {
  const [hipMobility, setHipMobility] = useState(recoverySession.hipMobility === 1)
  const [foamRolling, setFoamRolling] = useState(recoverySession.foamRolling === 1)

  function toggle(field: 'hipMobility' | 'foamRolling') {
    const newVal = field === 'hipMobility' ? !hipMobility : !foamRolling
    if (field === 'hipMobility') setHipMobility(newVal)
    else setFoamRolling(newVal)

    apiFetch(`/api/recovery-sessions/${recoverySession.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ [field]: newVal ? 1 : 0 }),
    }).catch(console.error)
  }

  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">Recovery</p>
      <h2 className="mb-2 text-2xl font-bold text-zinc-100">Active Recovery</h2>
      <p className="mb-6 text-sm text-zinc-400">
        Take it easy. Move gently, breathe deep, let your body recover.
      </p>

      <div className="space-y-3">
        <button
          onClick={() => toggle('hipMobility')}
          className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left ${
            hipMobility
              ? 'border-[#4ACAAA] bg-[#4ACAAA]/10'
              : 'border-zinc-800 bg-zinc-900'
          }`}
        >
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm ${
            hipMobility ? 'bg-[#4ACAAA] text-zinc-950' : 'bg-zinc-800 text-zinc-500'
          }`}>
            {hipMobility ? '\u2713' : ''}
          </span>
          <div>
            <p className="font-medium text-zinc-100">Hip Mobility</p>
            <p className="text-xs text-zinc-400">Cossack squats, 90/90, pigeon, wall hip CARs</p>
          </div>
        </button>

        <button
          onClick={() => toggle('foamRolling')}
          className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left ${
            foamRolling
              ? 'border-[#4ACAAA] bg-[#4ACAAA]/10'
              : 'border-zinc-800 bg-zinc-900'
          }`}
        >
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm ${
            foamRolling ? 'bg-[#4ACAAA] text-zinc-950' : 'bg-zinc-800 text-zinc-500'
          }`}>
            {foamRolling ? '\u2713' : ''}
          </span>
          <div>
            <p className="font-medium text-zinc-100">Foam Rolling</p>
            <p className="text-xs text-zinc-400">Quads, IT band, glutes, thoracic spine</p>
          </div>
        </button>
      </div>

      <div className="mt-8 flex justify-center">
        <button
          onClick={onComplete}
          className="min-h-[48px] rounded-xl bg-[#E8C860] px-8 py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030]"
        >
          Done
        </button>
      </div>
    </div>
  )
}
