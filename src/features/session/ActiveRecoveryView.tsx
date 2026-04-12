import { useState } from 'react'

import { Button } from '@/components/ui/button'
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
    <div className="animate-fade-in">
      <p className="text-label mb-1 text-muted-foreground">Recovery</p>
      <h2 className="text-display-lg mb-2 text-foreground">Active Recovery</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Take it easy. Move gently, breathe deep, let your body recover.
      </p>

      <div className="space-y-3">
        <button
          onClick={() => toggle('hipMobility')}
          className={`flex w-full items-center gap-3 border p-4 text-left ${
            hipMobility
              ? 'border-teal bg-teal/10'
              : 'border-border bg-deep-forest'
          }`}
        >
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center text-sm ${
            hipMobility ? 'bg-teal text-near-black' : 'bg-surface-light text-muted-foreground'
          }`}>
            {hipMobility ? '\u2713' : ''}
          </span>
          <div>
            <p className="font-medium text-foreground">Hip Mobility</p>
            <p className="text-xs text-muted-foreground">Cossack squats, 90/90, pigeon, wall hip CARs</p>
          </div>
        </button>

        <button
          onClick={() => toggle('foamRolling')}
          className={`flex w-full items-center gap-3 border p-4 text-left ${
            foamRolling
              ? 'border-teal bg-teal/10'
              : 'border-border bg-deep-forest'
          }`}
        >
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center text-sm ${
            foamRolling ? 'bg-teal text-near-black' : 'bg-surface-light text-muted-foreground'
          }`}>
            {foamRolling ? '\u2713' : ''}
          </span>
          <div>
            <p className="font-medium text-foreground">Foam Rolling</p>
            <p className="text-xs text-muted-foreground">Quads, IT band, glutes, thoracic spine</p>
          </div>
        </button>
      </div>

      <div className="mt-8 flex justify-center">
        <Button onClick={onComplete} size="lg">
          Done
        </Button>
      </div>
    </div>
  )
}
