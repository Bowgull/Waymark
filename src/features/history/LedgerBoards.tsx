import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { FlapLabel, SessionIcon, useOutsideClose } from '@/design'
import type { ConsistencyView, TileState } from '@/lib/ledgerConsistency'
import type { ReadinessReport } from '@/lib/brain/readinessParts'
import { RING_COLOUR, linePoints, paceDelta, paceFlap, spanWeeks, weightDelta, type LedgerRing, type LiftSeries, type RingState, type SleepDay, type WeeklyPoint, type HerbDay, type HerbSleepLine } from '@/lib/ledger'

// The Ledger's boards, drawn as page 32 draws them ("The Ledger · together").


const arc = (r: number, a0: number, a1: number) => {
  const p = (a: number) => [50 + Math.cos(a) * r, 50 + Math.sin(a) * r]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** B · flap-segment ring: one segment per planned session, two-tone with a hinge line; skipped is struck in clay. */
function SegRing({ ring }: { ring: LedgerRing }) {
  const n = ring.list.length
  const col = RING_COLOUR[ring.key]
  const done = ring.list.filter(s => s === 'done').length
  // page 32's gap (0.16 rad); a long range keeps each segment at least two thirds of its slice
  const gap = n > 0 ? Math.min(0.16, (Math.PI * 2 / n) / 3) : 0
  const seg = (st: RingState, i: number) => {
    const a0 = -Math.PI / 2 + i / n * Math.PI * 2 + gap / 2
    const a1 = -Math.PI / 2 + (i + 1) / n * Math.PI * 2 - gap / 2
    const outer = st === 'done' ? col : st === 'skip' ? '#9c5a40' : '#23281f'
    const inner = st === 'done' ? 'rgba(0,0,0,.28)' : st === 'skip' ? 'rgba(0,0,0,.3)' : 'rgba(0,0,0,.2)'
    const mid = (a0 + a1) / 2
    const sx = 50 + Math.cos(mid) * 40
    const sy = 50 + Math.sin(mid) * 40
    return (
      <g key={i} className="lg-seg" style={{ animationDelay: `${(i * Math.min(0.18, 1.2 / n)).toFixed(2)}s` }}>
        <path d={arc(42.5, a0, a1)} stroke={outer} strokeWidth="6" fill="none" />
        <path d={arc(37.5, a0, a1)} stroke={outer} strokeWidth="5" fill="none" />
        <path d={arc(37.5, a0, a1)} stroke={inner} strokeWidth="5" fill="none" />
        <path d={arc(40, a0, a1)} stroke="rgba(0,0,0,.55)" strokeWidth=".7" fill="none" />
        {st === 'skip' && <line x1={sx - 5} y1={sy + 4} x2={sx + 5} y2={sy - 4} stroke="#f0d8c8" strokeWidth="1.6" />}
      </g>
    )
  }
  return (
    <div className="lg-rcell">
      <div className="lg-ringbox">
        <svg viewBox="0 0 100 100" aria-hidden>
          {n === 0 ? <circle cx="50" cy="50" r="40" stroke="#23281f" strokeWidth="11" fill="none" /> : ring.list.map(seg)}
        </svg>
        <div className="lg-rc">
          <SessionIcon kind={ring.icon} size={30} label="" />
          <FlapLabel text={`${done}/${n}`} size="sm" animate={false} />
        </div>
      </div>
      <div className="lg-rlbl">{ring.label}</div>
    </div>
  )
}

/** WEEK: one segment per session (page 32); MONTH and SEASON read "done / planned" (page 46). */
export function RingBoard({ rings, title, sub = 'one segment per session' }: { rings: LedgerRing[]; title: string; sub?: string }) {
  return (
    <section className="lg-glass" aria-label={`${title}: ${rings.map(r => `${r.label} ${r.list.filter(s => s === 'done').length} of ${r.list.length}`).join(', ')}`}>
      <div className="lg-head"><span>{title}</span><span>{sub}</span></div>
      <div className="lg-rings">{rings.map(r => <SegRing key={r.key} ring={r} />)}</div>
    </section>
  )
}

const GRID = ({ w, h }: { w: number; h: number }) => (
  <>{[0.25, 0.5, 0.75].map(t => <line key={t} x1="0" x2={w} y1={h * t} y2={h * t} stroke="rgba(240,230,192,.08)" />)}</>
)

/** page 32's LINE: a dark under-stroke, the coloured line, dots, the last one larger; optional faint fill. */
function Line({ values, w, h, pad, invert, col, fill = false }: { values: number[]; w: number; h: number; pad: number; invert: boolean; col: string; fill?: boolean }) {
  const pts = linePoints(values, w, h, pad, invert)
  if (pts.length < 2) return null
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  return (
    <>
      {fill && <path d={`${d} L${pts[pts.length - 1].x} ${h} L${pts[0].x} ${h} Z`} fill={col} opacity=".08" />}
      <path d={d} fill="none" stroke="#000" strokeWidth="7" opacity=".55" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={col} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4.5 : 2.4} fill={col} />)}
    </>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function AerobicBoard({ points, runs }: { points: WeeklyPoint[]; runs: number }) {
  const drawn = points.length >= 2
  const last = points[points.length - 1]
  const delta = paceDelta(points)
  return (
    <section className="lg-glass lg-chart">
      <div className="lg-head"><span>Aerobic base</span>{last && <FlapLabel text={paceFlap(last.value)} size="xs" tone="gold" animate={false} />}</div>
      <svg viewBox="0 0 320 120" aria-hidden><GRID w={320} h={120} />{drawn && <Line values={points.map(p => p.value)} w={320} h={120} pad={10} invert col="#c9a656" fill />}</svg>
      <div className="lg-legend">
        <span><i style={{ background: '#c9a656' }} />pace at 140 bpm · {drawn ? plural(spanWeeks(points), 'week') : `${plural(runs, 'run')} so far`}</span>
        {delta && <span className={`lg-delta${delta.up ? '' : ' is-dn'}`}>{delta.text}</span>}
      </div>
    </section>
  )
}

/** Bone for the front squat, grey for the bench (the icon colours, page 32). */
const liftCol = (short: string) => short === 'bench' ? '#8a8a80' : '#e4dcc4'

export function StrengthBoard({ lifts, sets }: { lifts: LiftSeries[]; sets: number }) {
  const drawn = lifts.filter(l => l.points.length >= 2)
  const head = lifts[0]?.points[lifts[0].points.length - 1]
  return (
    <section className="lg-glass lg-chart">
      <div className="lg-head"><span>Strength</span>{head && <FlapLabel text={`${lifts[0].short.replace(/^front /, '').toUpperCase()} ${head.value}`} size="xs" tone="gold" animate={false} />}</div>
      <svg viewBox="0 0 320 130" aria-hidden>
        <GRID w={320} h={130} />
        {drawn.map((l) => <Line key={l.short} values={l.points.map(p => p.value)} w={320} h={130} pad={10} invert={false} col={liftCol(l.short)} />)}
      </svg>
      <div className="lg-legend">
        {lifts.map(l => <span key={l.short}><i style={{ background: liftCol(l.short) }} />{l.short}</span>)}
        <span>{drawn.length ? `top set, lbs · ${plural(Math.max(...drawn.map(l => spanWeeks(l.points))), 'week')}` : `${plural(sets, 'top set')} so far`}</span>
      </div>
    </section>
  )
}

const SORE_WORD = ['fresh', 'loose', 'normal', 'sore', 'cooked']
const SORE_COL = ['#4aa3c8', '#6fb85a', '#c4b070', '#d0843e', '#c63f34']

export function SleepBoard({ days, avg }: { days: SleepDay[]; avg: number | null }) {
  return (
    <section className="lg-glass lg-chart">
      <div className="lg-head"><span>Sleep + soreness</span>{avg != null && <FlapLabel text={`${avg.toFixed(1)} H AVG`} size="xs" tone="teal" animate={false} />}</div>
      <div className="lg-label" style={{ margin: '2px 0 4px' }}>Sleep · hours each night</div>
      <svg viewBox="0 0 320 96" aria-label={days.map(d => `${d.letter} ${d.sleepHours ?? 'no'} hours`).join(', ')}>
        {days.map((d, i) => {
          const x = 10 + i * 44
          const v = d.sleepHours
          const h = v == null ? 0 : Math.max(16, Math.min(78, (v - 4) * 18))
          return (
            <g key={d.epochDay}>
              {v != null && <rect x={x} y={78 - h} width="34" height={h} rx="4" fill={v < 6.5 ? '#3a5f55' : '#45796a'} />}
              {v != null && <text x={x + 17} y={78 - h + 13} textAnchor="middle" className="lg-bv">{v.toFixed(1)}</text>}
              <text x={x + 17} y="92" textAnchor="middle" className="lg-bd2">{d.letter}</text>
            </g>
          )
        })}
      </svg>
      <div className="lg-label" style={{ margin: '10px 0 6px' }}>Soreness · each morning</div>
      <div className="lg-sorerow">
        {days.map(d => (
          <div key={d.epochDay}>
            <span className="st" style={d.soreness != null ? { background: SORE_COL[d.soreness - 1] } : undefined} aria-label={d.soreness != null ? SORE_WORD[d.soreness - 1] : 'not logged'} />
            <span className="lg-bd3">{d.letter}</span>
          </div>
        ))}
      </div>
      <div className="lg-sorekey">{SORE_WORD.map((w, i) => <span key={w}><i style={{ background: SORE_COL[i] }} />{w}</span>)}</div>
    </section>
  )
}

/**
 * Herb (page 62, option B, approved 2026-10-19): every one of the last 28
 * mornings as a bar, 0 to 9. The last 7 wider and bright, with the number and
 * day printed; the three weeks before narrow and dim. One neutral tone, no
 * good or bad colours. The dashed brass line is his 28-day average; the flap
 * his 7-day average. One plain line from his own check-ins.
 */
export function HerbBoard({ days, avg7, avg28, line }: { days: HerbDay[]; avg7: number | null; avg28: number | null; line: HerbSleepLine | null }) {
  const W = 320, H = 112, base = 92, x0 = 4
  const yv = (v: number) => base - v / 9 * 72
  const oldStep = 166 / 21, newX0 = 180, newStep = (W - 2 - newX0) / 7
  const bx = (i: number): [number, number] => (i < 21 ? [x0 + i * oldStep, oldStep - 2] : [newX0 + (i - 21) * newStep, newStep - 4])
  return (
    <section className="lg-glass lg-chart lg-herb">
      <div className="lg-head"><span>Herb</span>{avg7 != null && <FlapLabel text={`${avg7.toFixed(1)} AVG`} size="xs" animate={false} />}</div>
      <svg viewBox={`0 0 ${W} ${H}`} aria-label={days.slice(-7).map(d => `${d.letter} ${d.herb ?? 'not logged'}`).join(', ')}>
        <line x1="0" x2={W} y1={base} y2={base} stroke="rgba(240,230,192,.12)" />
        {days.map((d, i) => {
          const [x, bw] = bx(i)
          const last7 = i >= 21
          const h = d.herb == null ? 0 : Math.max(2, base - yv(d.herb))
          return (
            <g key={d.epochDay}>
              {d.herb != null && <rect x={x.toFixed(1)} y={(base - h).toFixed(1)} width={bw.toFixed(1)} height={h.toFixed(1)} rx="2" fill={last7 ? '#cfd9d2' : '#5d6863'} />}
              {last7 && d.herb != null && <text x={(x + bw / 2).toFixed(1)} y={(base - h - 4).toFixed(1)} textAnchor="middle" className="lg-hbv">{d.herb}</text>}
              {last7 && <text x={(x + bw / 2).toFixed(1)} y={H - 4} textAnchor="middle" className="lg-hbd">{d.letter}</text>}
            </g>
          )
        })}
        {avg28 != null && (
          <>
            <line x1="0" x2={W} y1={yv(avg28).toFixed(1)} y2={yv(avg28).toFixed(1)} stroke="#000" strokeWidth="4" opacity=".45" />
            <line x1="0" x2={W} y1={yv(avg28).toFixed(1)} y2={yv(avg28).toFixed(1)} stroke="#b8984a" strokeWidth="1.6" strokeDasharray="5 3" />
          </>
        )}
        <text x={x0} y={H - 4} className="lg-hbd">4 weeks ago</text>
      </svg>
      <div className="lg-legend is-wrap">
        <span><i style={{ background: '#cfd9d2' }} />last 7 days</span>
        <span><i style={{ background: '#5d6863' }} />the 3 weeks before</span>
        {avg28 != null && <span><i className="dash" />28-day average {avg28.toFixed(1)}</span>}
      </div>
      {line && (
        <p className="lg-hline">
          On the {line.above} mornings above your 28-day average ({line.avg.toFixed(1)}), you slept {line.aboveSleep.toFixed(1)} h. On the other {line.rest}, {line.restSleep.toFixed(1)} h.
          <small>From your last {line.checkIns} check-ins.</small>
        </p>
      )}
    </section>
  )
}

export function BodyWeightBoard({ points, weighIns }: { points: WeeklyPoint[]; weighIns: number }) {
  const drawn = points.length >= 2
  const last = points[points.length - 1]
  const delta = weightDelta(points)
  return (
    <section className="lg-glass lg-chart">
      <div className="lg-head"><span>Body weight</span>{last && <FlapLabel text={`${last.value.toFixed(1)} LB`} size="xs" animate={false} />}</div>
      <svg viewBox="0 0 320 80" aria-hidden><GRID w={320} h={80} />{drawn && <Line values={points.map(p => p.value)} w={320} h={80} pad={8} invert={false} col="#cfd9d2" />}</svg>
      <div className="lg-legend">
        <span>from the Body Log · {drawn ? plural(spanWeeks(points), 'week') : `${plural(weighIns, 'weigh-in')} so far`}</span>
        {delta && <span className={`lg-delta${delta.down ? '' : ' is-dn'}`}>{delta.text}</span>}
      </div>
    </section>
  )
}

/** A flap-segment tile (page 32's ring segments laid flat): done in its colour, to come dark, missed in clay with a strike. */
function Tile({ st, col = '#c9a656' }: { st: TileState; col?: string }) {
  return <span className={`lg-tl${st === 'done' ? '' : st === 'todo' ? ' todo' : ' miss'}`} style={st === 'done' ? ({ '--c': col } as CSSProperties) : undefined} />
}

const TYPE_COL: Record<string, string> = { strength: '#c9a656', runwalk: '#c8844e', run: '#c8844e', bag: '#c8844e', mt: '#c8844e', foundation: '#5fa08c' }

const SUN_MARK = (
  <svg viewBox="0 0 16 16" fill="#c9a656" aria-hidden className="lg-ampm">
    <circle cx="8" cy="8" r="3.3" />
    <g stroke="#c9a656" strokeWidth="1.5" strokeLinecap="round"><path d="M8 1.2v1.8M8 13v1.8M1.2 8h1.8M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M3.2 12.8l1.3-1.3M11.5 4.5l1.3-1.3" /></g>
  </svg>
)
const MOON_MARK = (
  <svg viewBox="0 0 16 16" fill="#c9a656" aria-hidden className="lg-ampm"><path d="M10.6 1.6A6.6 6.6 0 1 0 14.4 12 5.5 5.5 0 0 1 10.6 1.6z" /></svg>
)

/**
 * Consistency (page 63 final, approved 2026-10-19). On the first screen,
 * between the week rings and Aerobic base. Closed: the flap and one bar of
 * the block's counted sessions (done | to come | missed) with a brass NEXT
 * BLOCK line. A tap opens it in place (it grows, then the detail fades in):
 * next block, when you train, what gets done, why missed. It closes the
 * page 61 ways: tap it again, tap outside, pull it down, or CLOSE.
 */
/**
 * A Ledger board that opens in place (page 63; page 61's dismiss rules): a tap
 * opens it (it grows, then the detail fades in) and scrolls it up under the
 * header; it closes on a tap again, a tap outside, a pull down, Escape or CLOSE.
 */
function useOpenBoard() {
  const [open, setOpen] = useState(false)
  const [press, setPress] = useState(false)
  const [pull, setPull] = useState(0)
  const ref = useRef<HTMLElement>(null)
  const drag = useRef<{ y: number; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const toggle = (on: boolean) => {
    setOpen(on)
    const el = ref.current
    // page 63 in page 67's one column: opened, it scrolls up to just under the header (the pond slides
    // away behind it); closed, back to the window
    const scroller = el?.closest('main') as HTMLElement | null
    if (!el || !scroller) return
    if (on) {
      window.setTimeout(() => {
        const box = scroller.getBoundingClientRect()
        const hd = el.closest('.lg-root')?.querySelector('.wm-scene-hd')
        const under = hd ? hd.getBoundingClientRect().bottom - box.top : 0
        scroller.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - box.top + scroller.scrollTop - under - 6), behavior: 'smooth' })
      }, 90)
    } else scroller.scrollTo({ top: 0, behavior: 'smooth' })
  }
  useOutsideClose(ref, open, () => toggle(false))
  const className = `${open ? ' is-open' : ''}${press ? ' is-press' : ''}${pull ? ' is-drag' : ''}`
  const props = {
    ref,
    role: 'button',
    tabIndex: 0,
    'aria-expanded': open,
    style: pull ? { transform: `translateY(${Math.min(pull, 120) * 0.6}px)` } : undefined,
    onPointerDown: (e: React.PointerEvent) => { drag.current = { y: e.clientY, moved: false }; setPress(true) },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current
      if (!d || !open) return
      const dy = Math.max(0, e.clientY - d.y)
      if (dy > 6) { d.moved = true; setPress(false); setPull(dy) }
    },
    onPointerUp: () => {
      const d = drag.current
      drag.current = null
      dragged.current = Boolean(d?.moved)
      setPress(false)
      if (d?.moved) { const dy = pull; setPull(0); if (dy > 50) toggle(false) }
    },
    onPointerLeave: () => { setPress(false) },
    onPointerCancel: () => { drag.current = null; setPress(false); setPull(0) },
    onClick: (e: React.MouseEvent) => {
      if (dragged.current) { dragged.current = false; return }
      if (open && (e.target as HTMLElement).closest('.lg-cdet')) return
      toggle(!open)
    },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(!open) } },
  }
  return { open, toggle, className, props }
}

const CHEV = <span className="lg-chev" aria-hidden><svg viewBox="0 0 12 12"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="#c9b27a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>

export function ConsistencyBoard({ view }: { view: ConsistencyView }) {
  const { open, toggle, className, props } = useOpenBoard()
  const total = view.done + view.toCome + view.missed
  const x = view.nextAt != null && total > 0 ? (view.nextAt / total) * 100 : null
  return (
    <section
      {...props}
      className={`lg-glass lg-cb${className}`}
      aria-label={`Consistency, ${view.flap.toLowerCase()}. ${view.done} done, ${view.toCome} to come, ${view.missed} missed.`}
    >
      <div className="lg-head">
        <span>Consistency</span>
        <span className="rt">
          <FlapLabel text={view.flap} size="xs" tone={view.tone} animate={false} />
          {open
            ? <button type="button" className="lg-closeb" onClick={e => { e.stopPropagation(); toggle(false) }}>Close</button>
            : CHEV}
        </span>
      </div>
      <div className="lg-bar">
        <div className="track">
          {Array.from({ length: view.done }, (_, i) => <Tile key={`d${i}`} st="done" />)}
          {Array.from({ length: view.toCome }, (_, i) => <Tile key={`t${i}`} st="todo" />)}
          {Array.from({ length: view.missed }, (_, i) => <Tile key={`m${i}`} st="miss" />)}
        </div>
        {x != null && <div className={`mk${x > 74 ? ' lft' : ''}`} style={{ left: `calc(${x}% - 1px)` }}><span>NEXT BLOCK</span></div>}
      </div>
      <div className="lg-bark">
        {view.mode === 'weeks'
          ? <><span><b>{view.done}</b> done</span><span>last {view.weeks} weeks</span><span><b>{view.missed}</b> missed</span></>
          : <><span><b>{view.done}</b> done</span><span><b>{view.toCome}</b> to come</span><span><b>{view.missed}</b> missed</span></>}
      </div>
      <div className="lg-cdet" aria-hidden={!open}>
        <div className="in">
          <div className="lg-grp"><div className="gh">{view.mode === 'weeks' ? 'Last weeks' : 'Next block'}</div><div className="nb">{view.nextLine}{view.nextSmall && <small>{view.nextSmall}</small>}</div></div>
          <div className="lg-grp"><div className="gh">When you train</div><div className="lg-when">
            <div>{SUN_MARK}<span className="grow">Mornings</span><FlapLabel text={`${view.am.done}/${view.am.of}`} size="xs" animate={false} /></div>
            <div>{MOON_MARK}<span className="grow">Evenings</span><FlapLabel text={`${view.pm.done}/${view.pm.of}`} size="xs" animate={false} /></div>
          </div></div>
          <div className="lg-grp"><div className="gh">What gets done</div>
            {view.types.map(t => (
              <div key={t.key} className="lg-tr">
                <span className="lbl">{t.label}<small>{t.sub}</small></span>
                <span className="tb">{t.tiles.map((st, i) => <Tile key={i} st={st} col={TYPE_COL[t.key]} />)}</span>
                <FlapLabel text={`${t.done}/${t.of}`} size="xs" animate={false} />
              </div>
            ))}
          </div>
          {(view.why.length > 0 || view.after) && (
            <div className="lg-grp"><div className="gh">Why missed</div>
              <div className="lg-chips">{view.why.map(w => <span key={w.label} className="lg-chip"><FlapLabel text={String(w.n)} size="xs" animate={false} />{w.label}</span>)}</div>
              {view.after && <div className="lg-aft">After a miss, back at the next session {view.after.back} of {view.after.of} times.</div>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** One run of 6 flap tiles: brass as a part builds, teal when it's in (page 69 §5). */
function PartTiles({ n, met, className }: { n: number; met: boolean; className: string }) {
  return (
    <span className={className}>
      {Array.from({ length: 6 }, (_, i) => <span key={i} className={`lg-tl${i < n ? (met ? ' met' : ' lit') : ' todo'}`} />)}
    </span>
  )
}

const METER_SEEN = 'wm.ledger.meter'

/** Which parts moved since he last saw the meter (their tiles flip once). Per phone; nothing breaks without it. */
function usePartFlips(parts: ReadonlyArray<{ key: string; tiles: number; in: boolean }>): Set<string> {
  const [flips] = useState(() => {
    const out = new Set<string>()
    try {
      const seen = JSON.parse(window.localStorage.getItem(METER_SEEN) ?? 'null') as Record<string, number> | null
      if (seen) for (const p of parts) if (seen[p.key] !== undefined && seen[p.key] !== p.tiles + (p.in ? 10 : 0)) out.add(p.key)
    } catch { /* no storage: no flips */ }
    return out
  })
  useEffect(() => {
    try { window.localStorage.setItem(METER_SEEN, JSON.stringify(Object.fromEntries(parts.map(p => [p.key, p.tiles + (p.in ? 10 : 0)])))) } catch { /* no storage */ }
  }, [parts])
  return flips
}

/**
 * NEXT BLOCK (page 69 §5, option A, approved 2026-10-20): page 63's board,
 * evolved in place on the Ledger's first screen. Closed: the header, a flap
 * (BUILDING / N OF 4 IN / READY / N DAY BREAK), one bar of 4 × 6 flap tiles
 * (brass as a part builds, teal when it's in), the part names under it and one
 * line naming what's left. Open: one group per part with its tiles and one
 * plain line of real numbers; page 63's details sit inside Habit. It opens and
 * closes as page 63 does (page 61's rules).
 */
export function ReadinessMeter({ view }: { view: ReadinessReport }) {
  const { open, toggle, className, props } = useOpenBoard()
  const flips = usePartFlips(view.parts)
  return (
    <section
      {...props}
      className={`lg-glass lg-cb lg-meter${className}`}
      aria-label={`Next block, ${view.flap.toLowerCase()}. ${view.parts.map(p => `${p.name} ${p.in ? 'in' : `${p.tiles} of 6`}`).join(', ')}. ${view.line}.`}
    >
      <div className="lg-head">
        <span>Next block</span>
        <span className="rt">
          <FlapLabel text={view.flap} size="xs" tone={view.tone} />
          {open
            ? <button type="button" className="lg-closeb" onClick={e => { e.stopPropagation(); toggle(false) }}>Close</button>
            : CHEV}
        </span>
      </div>
      <div className="lg-bar">
        <div className="track lanes">
          {view.parts.map(p => <PartTiles key={p.key} n={p.tiles} met={p.in} className={`lane${flips.has(p.key) ? ' is-flip' : ''}`} />)}
        </div>
      </div>
      <div className="lg-lanek">
        {view.parts.map(p => <span key={p.key} className={p.in ? 'ok' : undefined}>{p.name.toUpperCase()}</span>)}
      </div>
      <div className="lg-bark one">{view.line}</div>
      <div className="lg-cdet" aria-hidden={!open}>
        <div className="in">
          {view.parts.map(p => (
            <div key={p.key} className="lg-grp" data-part={p.key}>
              <div className="gh"><span>{p.name}</span><PartTiles n={p.tiles} met={p.in} className="mini" /></div>
              <div className="nb">{p.in && <span className="ok">In. </span>}{p.line}{p.small && <small>{p.small}</small>}</div>
            </div>
          ))}
          <div className="lg-grp"><div className="nb lg-foot">{view.foot}</div></div>
        </div>
      </div>
    </section>
  )
}
