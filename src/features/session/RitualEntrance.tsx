import { useEffect, useState } from 'react'

import { getMarkAsset, getSessionLabel } from '@/lib/markAssets'

interface RitualEntranceProps {
  sessionType: string
  onComplete: () => void
}

export function RitualEntrance({ sessionType, onComplete }: RitualEntranceProps) {
  const [phase, setPhase] = useState<'drawing' | 'holding' | 'fading'>('drawing')
  const mark = getMarkAsset(sessionType)
  const label = getSessionLabel(sessionType)

  useEffect(() => {
    const holdTimer = setTimeout(() => setPhase('holding'), 1200)
    const fadeTimer = setTimeout(() => setPhase('fading'), 1800)
    const doneTimer = setTimeout(onComplete, 2200)
    return () => {
      clearTimeout(holdTimer)
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [onComplete])

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-near-black transition-opacity duration-400 ${
        phase === 'fading' ? 'opacity-0' : 'opacity-100'
      }`}
      onClick={onComplete}
    >
      <div
        className={`ritual-mark ${phase === 'drawing' ? 'ritual-mark-drawing' : 'ritual-mark-visible'}`}
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

      <p
        className={`mt-6 text-display-sm tracking-[0.25em] text-gold transition-opacity duration-500 ${
          phase === 'drawing' ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {label}
      </p>

      <p className="absolute bottom-12 text-xs text-muted-foreground">
        Tap to skip
      </p>
    </div>
  )
}
