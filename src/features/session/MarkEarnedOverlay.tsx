import { useEffect, useState } from 'react'

import { getMarkAsset, getSessionLabel, logoPng } from '@/lib/markAssets'
import { completeHaptic } from '@/lib/haptics'

interface MarkEarnedOverlayProps {
  sessionType: string
  onComplete: () => void
}

export function MarkEarnedOverlay({ sessionType, onComplete }: MarkEarnedOverlayProps) {
  const [phase, setPhase] = useState<'illuminate' | 'glow' | 'fading'>('illuminate')
  const mark = getMarkAsset(sessionType)
  const label = getSessionLabel(sessionType)

  useEffect(() => {
    completeHaptic()
    const glowTimer = setTimeout(() => setPhase('glow'), 600)
    const fadeTimer = setTimeout(() => setPhase('fading'), 2200)
    const doneTimer = setTimeout(onComplete, 2600)
    return () => {
      clearTimeout(glowTimer)
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [onComplete])

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-near-black transition-opacity duration-400 ${
        phase === 'fading' ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Logo backdrop — faint, behind the mark */}
      <img
        src={logoPng}
        alt=""
        draggable={false}
        className={`absolute h-72 w-72 object-contain pointer-events-none transition-opacity duration-700 ${
          phase === 'illuminate' ? 'opacity-0' : 'opacity-[0.04]'
        }`}
      />

      {/* Mark illuminating */}
      <div
        className={`relative ${
          phase === 'illuminate'
            ? 'animate-mark-illuminate'
            : 'animate-glow-pulse'
        }`}
      >
        {mark && (
          <img
            src={mark.png}
            alt={label}
            className="h-48 w-48 object-contain"
            draggable={false}
          />
        )}
      </div>
    </div>
  )
}
