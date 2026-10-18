import { useEffect, useRef, useState } from 'react'

import { Crest, useReducedMotion } from '@/design'
import { loadWorldEngine } from './loadEngine'
import type { CrestStage } from './engine'

// Loading (page 38, A, approved): the crest taken apart. Its layers float apart
// and drift while the app works ("Reading your profile."), then snap together
// when the answer arrives; `onDone` fires once the crest has locked (0.5 s).
// Reduce Motion: the still crest, then straight on.

export function CrestLoading({ message, done = false, onDone }: { message: string; done?: boolean; onDone?: () => void }) {
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<CrestStage | null>(null)
  const started = useRef(false)
  const mounted = useRef(true)
  const stillRef = useRef(reduced)
  const [fallback, setFallback] = useState(false)
  const doneRef = useRef(onDone)
  useEffect(() => { doneRef.current = onDone }, [onDone])

  // One canvas holds one WebGL context: create once (StrictMode runs effects twice); a real unmount disposes.
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stageRef.current?.dispose(); stageRef.current = null }
  }, [])
  useEffect(() => {
    const canvas = canvasRef.current
    if (started.current || !canvas) return
    started.current = true
    loadWorldEngine()
      .then(m => m.createCrestStage(canvas, 'loading', { still: stillRef.current, frustum: 4.4, shieldY: 0.2, transparent: true }))
      .then(s => { if (!mounted.current) s.dispose(); else stageRef.current = s })
      .catch(() => { if (mounted.current) setFallback(true) })
  }, [])

  useEffect(() => {
    if (!done) return
    stageRef.current?.finish()
    const t = window.setTimeout(() => doneRef.current?.(), reduced || fallback || !stageRef.current ? 0 : 520)
    return () => window.clearTimeout(t)
  }, [done, reduced, fallback])

  return (
    <div className="wm-crest-loading" role="status" aria-live="polite">
      <canvas ref={canvasRef} style={fallback ? { display: 'none' } : undefined} />
      {fallback && <Crest big width={150} />}
      {(message || done) && <p>{done ? 'Ready.' : message}</p>}
    </div>
  )
}
