import { useEffect, useState } from 'react'
import logoPng from '@/assets/brand/Logo.png'

interface LoadingScreenProps {
  onReady?: () => void
  minDisplayMs?: number
}

export function LoadingScreen({ onReady, minDisplayMs = 2000 }: LoadingScreenProps) {
  const [fading, setFading] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setFading(true)
      setTimeout(() => onReady?.(), 500)
    }, minDisplayMs)
    return () => clearTimeout(timer)
  }, [minDisplayMs, onReady])

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-[#0a0a0a] transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {/* Ambient radial glow */}
        <div
          className="animate-loading-glow-pulse pointer-events-none absolute"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(232,200,96,0.1) 0%, transparent 70%)',
            width: '320px',
            height: '320px',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
        <img
          src={logoPng}
          alt="Waymark"
          width={200}
          height={200}
          className={`relative object-contain ${entered ? 'animate-loading-breathe' : 'animate-loading-entrance'}`}
          style={{ mixBlendMode: 'screen' }}
          onAnimationEnd={() => setEntered(true)}
        />
      </div>
    </div>
  )
}
