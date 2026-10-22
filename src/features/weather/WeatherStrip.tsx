import { useLayoutEffect, useRef, useState } from 'react'

import { FlapLabel, SessionIcon, useDismissLayer, usePullDown, type SessionIconKey } from '@/design'
import { tapHaptic } from '@/lib/haptics'

import { PixelSky } from './PixelSky'
import { dayName, degText, hourShort, inUnit, type Sky, type Weather } from './weatherData'
import './weather.css'

// Weather in the week strip's place (page 72, layout A, approved 2026-10-22):
// one thin line on Today with a pixel sky, the temperature on flaps,
// feels-like and when the rain comes. Tap it and the board opens in place
// under the line: now, feels-like, high and low, the next hours with the
// run's hour marked by its icon, one line for when the rain comes, then the
// week behind 7 DAYS ›. CLOSE, a tap outside or a pull down closes it. No
// wind, no radar bar, no source or freshness words.

export interface WeatherMark {
  /** Epoch ms of the planned hour. */
  at: number
  icon: SessionIconKey
}

function Temp({ c, unit, size = 'md' }: { c: number; unit: 'C' | 'F'; size?: 'sm' | 'md' | 'lg' }) {
  const n = inUnit(c, unit)
  return (
    <span className="wx-tmp" aria-label={`${n} degrees`}>
      <FlapLabel text={String(n)} size={size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md'} animate={false} />
      <span className={`wx-deg is-${size}`} aria-hidden>°</span>
    </span>
  )
}

function CoachLine({ text, sky }: { text: string; sky: Sky }) {
  return <div className="wx-cline"><PixelSky sky={sky} size={16} /><span>{text}</span></div>
}

export function WeatherStrip({ weather, unit = 'C', line, marks = [] }: { weather: Weather; unit?: 'C' | 'F'; line?: { text: string; sky: Sky } | null; marks?: WeatherMark[] }) {
  const [open, setOpen] = useState<'hours' | 'week' | null>(null)
  const w = weather
  return (
    <div className="wm-backwrap wx-wrapo">
      <div
        className="wm-board wx-wrap"
        role="button"
        tabIndex={0}
        aria-expanded={open != null}
        aria-label={`Weather: ${inUnit(w.now.t, unit)} degrees, feels ${inUnit(w.now.feels, unit)}. ${w.next ?? w.now.words}.${line ? ` ${line.text}` : ''} Open the hours.`}
        onClick={() => { void tapHaptic(); setOpen(o => (o ? null : 'hours')) }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => (o ? null : 'hours')) } }}
      >
        <div className="wx-strip">
          <PixelSky sky={w.now.sky} size={30} />
          <Temp c={w.now.t} unit={unit} />
          <div className="tx">
            <span className="l1">Feels {degText(w.now.feels, unit)}°</span>
            <span className="l2">{w.next ? <b>{w.next}</b> : w.now.words}</span>
          </div>
          <span className="chev" aria-hidden>›</span>
        </div>
        {line && <CoachLine text={line.text} sky={line.sky} />}
      </div>
      {open && <WeatherBoard weather={w} unit={unit} view={open} marks={marks} onView={setOpen} onClose={() => setOpen(null)} />}
    </div>
  )
}

function WeatherBoard({ weather: w, unit, view, marks, onView, onClose }: { weather: Weather; unit: 'C' | 'F'; view: 'hours' | 'week'; marks: WeatherMark[]; onView: (v: 'hours' | 'week') => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [notch, setNotch] = useState<number | null>(null)
  // page 61: CLOSE, a tap outside, Escape, the edge swipe, and a pull down
  useDismissLayer(true, onClose)
  const pull = usePullDown(onClose)
  useLayoutEffect(() => {
    const b = ref.current
    const strip = b?.parentElement?.querySelector<HTMLElement>('.wx-strip')
    if (!b || !strip) return
    setNotch(strip.getBoundingClientRect().left + 24 - b.getBoundingClientRect().left - 7)
  }, [])
  const maxMm = 2
  return (
    <>
      <div className="wm-veil3 is-lite" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        className="wm-board wx-board"
        role="dialog"
        aria-label={view === 'week' ? 'The week ahead' : 'The weather, the next hours'}
        style={pull.dy ? { transform: `translateY(${pull.dy}px)`, opacity: 1 - Math.min(pull.dy / 260, 0.6) } : undefined}
        {...pull.handlers}
      >
        <span className="notch" style={notch != null ? { left: notch } : { visibility: 'hidden' }} />
        <div className="top"><span /><button type="button" className="wx-x" onClick={onClose}>CLOSE</button></div>
        {view === 'week' ? (
          <>
            <div className="wx-wk">
              {w.week.map((d, i) => (
                <div key={d.at} className={`w${i === 0 ? ' is-today' : ''}`}>
                  <FlapLabel text={dayName(d.at)} size="xs" animate={false} />
                  <PixelSky sky={d.sky} size={22} />
                  <span className="ww">{d.words}</span>
                  <span className="hl">{d.hi != null ? `${degText(d.hi, unit)}°` : ''} {d.lo != null && <s>{degText(d.lo, unit)}°</s>}</span>
                </div>
              ))}
            </div>
            <div className="foot"><span /><button type="button" className="wx-door" onClick={() => onView('hours')}>‹ TODAY</button></div>
          </>
        ) : (
          <>
            <div className="nowr">
              <PixelSky sky={w.now.sky} size={44} />
              <Temp c={w.now.t} unit={unit} size="lg" />
              <div className="d">
                <b>{w.now.words}, feels {degText(w.now.feels, unit)}°</b>
                {(w.hi != null || w.lo != null) && <span>{[w.hi != null ? `High ${degText(w.hi, unit)}°` : null, w.lo != null ? `low ${degText(w.lo, unit)}°` : null].filter(Boolean).join(' · ')}</span>}
              </div>
            </div>
            <div style={{ height: 12 }} />
            <div className="wx-hrs">
              {w.hours.map(h => {
                const mark = marks.find(m => m.at >= h.at && m.at < h.at + 3600000)
                return (
                  <div key={h.at} className={`h${mark ? ' is-run' : ''}`}>
                    {mark && <span className="sicon"><SessionIcon kind={mark.icon} size={18} label="" /></span>}
                    <small>{hourShort(h.at)}</small>
                    <PixelSky sky={h.sky} size={18} />
                    <b>{degText(h.t, unit)}°</b>
                    <span className="bar"><i style={{ height: `${Math.min(100, (h.mm / maxMm) * 100)}%` }} /></span>
                    <em className={h.pop ? '' : 'z'}>{Math.round(h.pop)}%</em>
                  </div>
                )
              })}
            </div>
            <CoachLine text={w.rain} sky={w.rainSky} />
            <div className="foot"><span /><button type="button" className="wx-door" onClick={() => onView('week')}>7 DAYS ›</button></div>
          </>
        )}
      </div>
    </>
  )
}
