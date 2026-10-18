import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { useReducedMotion } from '@/design/motion'
import { useNetworkStatus } from '@/lib/network'
import { placeForPath } from './places'
import { useWorldMode } from './useWorldTime'
import { getWorldState, setWorldOffline, subscribeWorld, type WorldPlace } from './worldStore'
import type { WorldHandle } from './engine'
import { loadWorldEngine } from './loadEngine'
import './world.css'

// The ASCII forest behind the whole app (design-decisions.md "World map").
// One canvas, fixed behind the shell; the tabs glide its camera. The engine
// (three.js + glyph shaders) is its own chunk, loaded after first paint.
// Paused whenever it can't be seen: a screen with no world (Settings, a
// session), the app in the background, or the page hidden.

declare global {
  interface Window { __waymarkWorld?: WorldHandle }
}

export function WorldLayer() {
  const location = useLocation()
  const routePlace = placeForPath(location.pathname)
  const ws = useSyncExternalStore(subscribeWorld, getWorldState)
  const reduced = useReducedMotion()
  const mode = useWorldMode()
  const online = useNetworkStatus()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<WorldHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [appActive, setAppActive] = useState(true)
  const [shown, setShown] = useState<WorldPlace | null>(null)

  // Today's rest-day home stands in for the clearing; a screen with no place may ask for one behind it.
  const place: WorldPlace | null = routePlace === 'clearing' && ws.place === 'home' ? 'home' : (routePlace ?? ws.backdrop)
  const visible = place != null || ws.bare
  const live = visible && appActive && !failed

  useEffect(() => { setWorldOffline(!online) }, [online])

  // App foreground / background (Capacitor), plus the page's own visibility.
  useEffect(() => {
    const onVis = () => setAppActive(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    let remove: (() => void) | null = null
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', s => setAppActive(s.isActive)).then(h => { remove = () => { void h.remove() } }).catch(() => {})
    }
    return () => { document.removeEventListener('visibilitychange', onVis); remove?.() }
  }, [])

  // Create the world the first time there's somewhere to show.
  const firstPlace = useRef<WorldPlace>(place ?? 'clearing')
  const firstMode = useRef(mode)
  const firstReduced = useRef(reduced)
  // One canvas holds one WebGL context: start creating once (StrictMode runs effects twice), and only
  // a real unmount disposes it.
  const creating = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      // StrictMode's rehearsal unmount comes before the world exists; a real unmount disposes it.
      mounted.current = false
      handleRef.current?.dispose(); handleRef.current = null; window.__waymarkWorld = undefined
    }
  }, [])
  useEffect(() => {
    if (!visible || creating.current || failed) return
    const canvas = canvasRef.current
    if (!canvas) return
    creating.current = true
    const s = getWorldState()
    loadWorldEngine()
      .then(m => m.createWorld(canvas, { place: firstPlace.current, mode: firstMode.current, weeks: s.weeks, lantern: s.lantern, offline: s.offline, reducedMotion: firstReduced.current }))
      .then(h => {
        if (!mounted.current) { h.dispose(); return }
        handleRef.current = h
        window.__waymarkWorld = h
        setShown(firstPlace.current)
        requestAnimationFrame(() => setReady(true))
      })
      .catch(e => { console.warn('World unavailable; plain background instead.', e); if (mounted.current) setFailed(true) })
  }, [visible, failed])


  // Place: glide (or, under Reduce Motion, a quick dip to dark and a still of the new place).
  const [dip, setDip] = useState(false)
  useEffect(() => {
    const h = handleRef.current
    if (!h || !place || place === shown) return
    if (reduced) {
      const t0 = window.setTimeout(() => setDip(true), 0)
      const t1 = window.setTimeout(() => { h.setPlace(place, true); setShown(place); window.setTimeout(() => setDip(false), 40) }, 170)
      return () => { window.clearTimeout(t0); window.clearTimeout(t1) }
    }
    h.setPlace(place)
    const t = window.setTimeout(() => setShown(place), 0)
    return () => window.clearTimeout(t)
  }, [place, shown, reduced, ready])

  useEffect(() => { handleRef.current?.setMode(mode) }, [mode, ready])
  useEffect(() => { handleRef.current?.setWeeks(ws.weeks) }, [ws.weeks, ready])
  useEffect(() => { handleRef.current?.setLantern(ws.lantern) }, [ws.lantern, ready])
  useEffect(() => { handleRef.current?.setOffline(ws.offline) }, [ws.offline, ready])
  useEffect(() => { handleRef.current?.setReducedMotion(reduced) }, [reduced, ready])
  useEffect(() => {
    const h = handleRef.current
    if (!h) return
    if (live && !ws.bare) h.resume(); else h.pause()
  }, [live, ws.bare, ready])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => handleRef.current?.resize())
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  const cls = ['wm-world', ready && visible && !failed ? 'is-ready' : '', dip ? 'is-dip' : '', ws.bare ? 'is-bare' : ''].filter(Boolean).join(' ')
  return (
    <div className={cls} data-place={place ?? shown ?? 'none'} data-mode={mode} aria-hidden="true">
      <canvas ref={canvasRef} className="wm-world-canvas" />
      <div className="wm-world-scrim" />
    </div>
  )
}
