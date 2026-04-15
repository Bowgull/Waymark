import { useEffect, useState } from 'react'
import logoPng from '@/assets/brand/Logo.png'

interface LoadingScreenProps {
  onReady?: () => void
  minDisplayMs?: number
}

export function LoadingScreen({ onReady, minDisplayMs = 1500 }: LoadingScreenProps) {
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setFading(true)
      setTimeout(() => onReady?.(), 500)
    }, minDisplayMs)
    return () => clearTimeout(timer)
  }, [minDisplayMs, onReady])

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a] transition-opacity duration-500 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <img
        src={logoPng}
        alt="Waymark"
        width={80}
        height={80}
        className="animate-loading-breathe object-contain"
        style={{ mixBlendMode: 'screen' }}
      />
    </div>
  )
}
