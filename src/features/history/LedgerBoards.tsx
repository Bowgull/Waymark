import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { FlapLabel, SessionIcon, useOutsideClose } from '@/design'
import type { ConsistencyView, TileState } from '@/lib/ledgerConsistency'
import { RING_COLOUR, avgFlap, avgName, linePoints, type LedgerRing, type RingState, type SleepDay, type HerbDay, type HerbSleepLine } from '@/lib/ledger'
import {
  FIVE_K_CHART, FIVE_K_GOAL_SEC, fightBars, fiveKChart, fiveKX, liftFlap, mmss, perKm, strengthLines,
  type EasyRunsView, type FightView, type FiveKView, type NextBlockView, type PartKey, type StrengthSinceView,
} from '@/lib/ledgerBoards'

// The Ledger's boards, drawn as page 32 draws them ("The Ledger · together").


const arc = (r: number, a0: number, a1: number) => {
  const p = (a: number) => [50 + Math.cos(a) * r, 50 + Math.sin(a) * r]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** B · flap-segment ring: one segment per planned session, two-tone with a hinge line; missed is clay, no strike (page 75 B). */
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
    return (
      <g key={i} className="lg-seg" style={{ animationDelay: `${(i * Math.min(0.18, 1.2 / n)).toFixed(2)}s` }}>
        <path d={arc(42.5, a0, a1)} stroke={outer} strokeWidth="6" fill="none" />
        <path d={arc(37.5, a0, a1)} stroke={outer} strokeWidth="5" fill="none" />
        <path d={arc(37.5, a0, a1)} stroke={inner} strokeWidth="5" fill="none" />
        <path d={arc(40, a0, a1)} stroke="rgba(0,0,0,.55)" strokeWidth=".7" fill="none" />
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

/** page 32's LINE drawn through given corners: a dark under-stroke, the coloured line, dots, the last one larger; optional faint fill. */
function PathLine({ pts, h, col, fill = false }: { pts: { x: number; y: number }[]; h: number; col: string; fill?: boolean }) {
  if (pts.length === 0) return null
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  return (
    <>
      {fill && pts.length >= 2 && <path d={`${d} L${pts[pts.length - 1].x} ${h} L${pts[0].x} ${h} Z`} fill={col} opacity=".08" />}
      {pts.length >= 2 && <path d={d} fill="none" stroke="#000" strokeWidth="7" opacity=".55" strokeLinejoin="round" />}
      {pts.length >= 2 && <path d={d} fill="none" stroke={col} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4.5 : 2.4} fill={col} />)}
    </>
  )
}

/** page 32's LINE over values (invert: lower is higher, so a faster pace climbs). */
function Line({ values, w, h, pad, invert, col, fill = false, domain }: { values: number[]; w: number; h: number; pad: number; invert: boolean; col: string; fill?: boolean; domain?: { min: number; max: number } }) {
  const pts = linePoints(values, w, h, pad, invert, domain)
  if (pts.length < 2) return null
  return <PathLine pts={pts} h={h} col={col} fill={fill} />
}

/** A board's head: its name and its flap (the Ledger's closed line shows the same head). */
export function BoardHead({ name, children }: { name: string; children?: ReactNode }) {
  return <div className="lg-head"><span>{name}</span>{children}</div>
}

const SORE_WORD = ['fresh', 'loose', 'normal', 'sore', 'cooked']
const SORE_COL = ['#4aa3c8', '#6fb85a', '#c4b070', '#d0843e', '#c63f34']

export function SleepFlap({ avg, mornings = 7 }: { avg: number | null; mornings?: number }) {
  return avg != null ? <FlapLabel text={avgFlap(`${avg.toFixed(1)} H`, mornings)} size="xs" tone="teal" animate={false} /> : null
}

export function SleepBoard({ days, avg, mornings = 7 }: { days: SleepDay[]; avg: number | null; mornings?: number }) {
  return (
    <section className="lg-glass lg-chart">
      <BoardHead name="Sleep + soreness"><SleepFlap avg={avg} mornings={mornings} /></BoardHead>
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
export function HerbFlap({ avg7, n7 = 7 }: { avg7: number | null; n7?: number }) {
  return avg7 != null ? <FlapLabel text={avgFlap(avg7.toFixed(1), n7)} size="xs" animate={false} /> : null
}

export function HerbBoard({ days, avg7, avg28, line, n7 = 7, n28 = 28 }: { days: HerbDay[]; avg7: number | null; avg28: number | null; line: HerbSleepLine | null; n7?: number; n28?: number }) {
  const W = 320, H = 112, base = 92, x0 = 4
  const yv = (v: number) => base - v / 9 * 72
  const oldStep = 166 / 21, newX0 = 180, newStep = (W - 2 - newX0) / 7
  const bx = (i: number): [number, number] => (i < 21 ? [x0 + i * oldStep, oldStep - 2] : [newX0 + (i - 21) * newStep, newStep - 4])
  return (
    <section className="lg-glass lg-chart lg-herb">
      <BoardHead name="Herb"><HerbFlap avg7={avg7} n7={n7} /></BoardHead>
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
        {avg28 != null && <span><i className="dash" />{avgName('28-day', n28)} {avg28.toFixed(1)}</span>}
      </div>
      {line && (
        <p className="lg-hline">
          On the {line.above} mornings above your {n28 >= 7 ? '28-day average' : 'average'} ({line.avg.toFixed(1)}), you slept {line.aboveSleep.toFixed(1)} h. On the other {line.rest}, {line.restSleep.toFixed(1)} h.
          <small>From your last {line.checkIns} check-ins.</small>
        </p>
      )}
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


// ─── Page 79: the boards that answer his goals ───────────────

/** One run of 6 flap tiles: brass as a part builds, teal when it's done (page 69 §5). */
function PartTiles({ n, met, className }: { n: number; met: boolean; className: string }) {
  return (
    <span className={className}>
      {Array.from({ length: 6 }, (_, i) => <span key={i} className={`lg-tl${i < n ? (met ? ' met' : ' lit') : ' todo'}`} />)}
    </span>
  )
}

export function NextBlockFlap({ view }: { view: NextBlockView }) {
  return <FlapLabel text={view.flap} size="xs" tone={view.tone} animate={false} />
}

/**
 * NEXT BLOCK in plain words (page 79 §5): Showing up, Running base, Lifting,
 * Back; "N OF 4 DONE"; one bar of 4 × 6 tiles; one line of what's left. Tap a
 * part: its one plain line (one open at a time). The rules are page 69 §5's.
 */
export function NextBlockBoard({ view }: { view: NextBlockView }) {
  const [on, setOn] = useState<PartKey>(view.openKey)
  return (
    <section
      className="lg-glass lg-chart lg-meter-new"
      aria-label={`Next block, ${view.flap.toLowerCase()}. ${view.parts.map(p => `${p.name} ${p.in ? 'done' : `${p.tiles} of 6`}`).join(', ')}. ${view.line}.`}
    >
      <BoardHead name="Next block"><NextBlockFlap view={view} /></BoardHead>
      <div className="lg-bar">
        <div className="track lanes">
          {view.parts.map(p => <PartTiles key={p.key} n={p.tiles} met={p.in} className="lane" />)}
        </div>
      </div>
      <div className="lg-lanek lg-lanek-4">
        {view.parts.map(p => <span key={p.key} className={p.in ? 'ok' : undefined}>{p.name.toUpperCase()}</span>)}
      </div>
      <div className="lg-bark one">{view.line}</div>
      <div className="nb-parts">
        {view.parts.map(p => (
          <button key={p.key} type="button" data-part={p.key} className={`nb-part${on === p.key ? ' is-on' : ''}`} aria-expanded={on === p.key} onClick={() => setOn(p.key)}>
            <span className="gh"><span>{p.name}</span><PartTiles n={p.tiles} met={p.in} className="mini" /></span>
            <span className="nb-say">{p.in && <><b>Done.</b> </>}{p.say}</span>
          </button>
        ))}
      </div>
      <p className="nb-foot">{view.foot}</p>
    </section>
  )
}

export function RunningFlap({ fiveK }: { fiveK: FiveKView }) {
  return <FlapLabel text={fiveK.flap} size="xs" tone="gold" animate={false} />
}

const GOLD = '#c9a656'
const BRASS = '#b8984a'

/**
 * RUNNING (page 79 §2): the 5K first. Each test a step up toward the dashed
 * 22:00 line at the top (up is better), the next test as a ring. Under it, easy
 * runs at his own heart line, a faster pace higher; treadmill runs count.
 */
export function RunningBoard({ fiveK, easy }: { fiveK: FiveKView; easy: EasyRunsView & { empty: string | null } }) {
  const ch = fiveKChart(fiveK)
  const { w, h, goalY } = FIVE_K_CHART
  const vals = easy.points.map(p => p.value)
  const lo = Math.min(...vals), hi = Math.max(...vals), m = (hi - lo) * 0.12
  return (
    <section className="lg-glass lg-chart">
      <BoardHead name="Running"><RunningFlap fiveK={fiveK} /></BoardHead>
      <svg viewBox={`0 0 ${w} ${h}`} aria-label={fiveK.tests.length ? fiveK.tests.map(t => `week ${t.week} ${mmss(t.sec)}`).join(', ') : `first test in week ${fiveK.nextWeek}`}>
        <GRID w={w} h={h} />
        <line x1="0" x2={w} y1={goalY} y2={goalY} stroke="#000" strokeWidth="4" opacity=".45" />
        <line x1="0" x2={w} y1={goalY} y2={goalY} stroke={BRASS} strokeWidth="1.6" strokeDasharray="5 3" />
        <text x="316" y={goalY - 5} textAnchor="end" className="lg-hbv">{mmss(FIVE_K_GOAL_SEC)} GOAL</text>
        <PathLine pts={ch.steps} h={h} col={GOLD} />
        {ch.labels.map((l, i) => <text key={i} x={l.x} y={l.y} className="lg-hbv">{l.text}</text>)}
        {ch.next && (
          <>
            <line x1={ch.next.x0} x2={ch.next.x} y1={ch.next.y} y2={ch.next.y} stroke={GOLD} strokeWidth="1.6" strokeDasharray="3 3" opacity=".7" />
            <circle cx={ch.next.x} cy={ch.next.y} r="3.6" fill="none" stroke={GOLD} strokeWidth="1.4" />
          </>
        )}
        {fiveK.tests.length === 0 && <text x={fiveKX(fiveK.nextWeek, fiveK.axisWeeks) + 8} y="97.6" className="lg-hbv">FIRST TEST · WEEK {fiveK.nextWeek}</text>}
        {ch.ticks.map(t => <text key={t.text} x={t.x} y="128" textAnchor={t.anchor} className="lg-hbd">{t.text}</text>)}
      </svg>
      <div className="lg-legend is-wrap">
        <span><i style={{ background: GOLD }} />your 5K tests</span>
        <span><i style={{ background: BRASS }} />goal {mmss(FIVE_K_GOAL_SEC)}</span>
      </div>
      <p className="lg-hline">{fiveK.line}</p>
      <div className="lg-label" style={{ margin: '14px 0 6px' }}>Easy runs · pace at heart {easy.bpm}</div>
      <svg viewBox="0 0 320 84" aria-hidden>
        <GRID w={320} h={84} />
        <Line values={vals} w={320} h={84} pad={10} invert col={GOLD} fill domain={vals.length ? { min: lo - m, max: hi + m } : undefined} />
      </svg>
      {easy.now != null
        ? (
          <div className="lg-legend">
            <span><i style={{ background: GOLD }} />{perKm(easy.now)} now</span>
            {easy.delta && <span className={`lg-delta${easy.delta.up ? '' : ' is-dn'}`}>{easy.delta.text}</span>}
          </div>
        )
        : easy.empty && <p className="lg-hline">{easy.empty}</p>}
    </section>
  )
}

export function FightFlap({ view }: { view: FightView }) {
  return <FlapLabel text={view.flap} size="xs" tone="gold" animate={false} />
}

/** FIGHT (page 79 §3): bag rounds each week (this week bright), MT classes this week, combos learned and mastered. */
export function FightBoard({ view }: { view: FightView }) {
  const bars = fightBars(view.weeks)
  const base = view.anyRounds ? 78 : 42
  const c = view.combos
  return (
    <section className="lg-glass lg-chart">
      <BoardHead name="Fight"><FightFlap view={view} /></BoardHead>
      <div className="lg-label" style={{ margin: '2px 0 6px' }}>Bag rounds · each week</div>
      <svg viewBox={`0 0 320 ${view.anyRounds ? 96 : 60}`} aria-label={view.weeks.map(wk => `${wk.now ? 'this week' : wk.label || 'before'} ${wk.rounds}`).join(', ')}>
        <line x1="0" x2="320" y1={base} y2={base} stroke="rgba(240,230,192,.12)" />
        {bars.map((b, i) => (
          <g key={i}>
            {b.h > 0 && <rect x={(b.x - b.w / 2).toFixed(1)} y={(base - b.h).toFixed(1)} width={b.w} height={b.h} rx="2" fill={b.now ? '#cfd9d2' : '#5d6863'} />}
            {b.value > 0 && <text x={b.x.toFixed(1)} y={(base - b.h - 4).toFixed(1)} textAnchor="middle" className="lg-hbv">{b.value}</text>}
            <text x={b.x.toFixed(1)} y={base + 14} textAnchor="middle" className="lg-hbd">{b.label}</text>
          </g>
        ))}
      </svg>
      {view.anyRounds
        ? (
          <div className="lg-legend">
            <span><i style={{ background: '#cfd9d2' }} />this week</span>
            <span><i style={{ background: '#5d6863' }} />weeks before</span>
          </div>
        )
        : <p className="lg-hline">No bag rounds yet. They count here from your first bag session.</p>}
      {view.classes.picked || view.classes.done > 0
        ? <div className="fx-row"><span className="fx-k">MT classes this week</span><FlapLabel text={String(view.classes.done)} size="xs" animate={false} /></div>
        : (
          <>
            <div className="fx-row"><span className="fx-k">MT classes</span><FlapLabel text="NONE PICKED" size="xs" animate={false} /></div>
            <div className="fx-sub">Pick class days in Settings when you know your week.</div>
          </>
        )}
      <div className="fx-row"><span className="fx-k">Combos</span><FlapLabel text={c.learned ? `${c.learned} LEARNED · ${c.mastered} MASTERED` : '0 LEARNED'} size="xs" animate={false} /></div>
      {c.learned === 0 && <div className="fx-sub">They count here as you rate them after bag rounds.</div>}
      {c.closest && (
        <div className="fx-combo">
          <span>{c.closest.name}</span>
          <span className="fx-dots" aria-hidden>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < c.closest!.dots ? 'on' : ''} />)}</span>
          <em>{c.closest.words}</em>
        </div>
      )}
    </section>
  )
}

const LIFT_COL = ['#e4dcc4', GOLD, '#7fd0b4', '#c8844e']

export function StrengthFlap({ view }: { view: StrengthSinceView }) {
  return <FlapLabel text={view.flap} size="xs" tone="gold" animate={false} />
}

/** STRENGTH since you started (page 79 §4): one line per lift he does, from 0 in week 1, reps included. */
export function StrengthSinceBoard({ view }: { view: StrengthSinceView }) {
  const lines = strengthLines(view)
  const rows = view.lifts.map((l, i) => (
    <div key={l.exerciseId} className="fx-row">
      <span className="fx-k"><i className="sw" style={{ background: LIFT_COL[i] }} />{l.name}</span>
      <FlapLabel text={liftFlap(l)} size="xs" animate={false} />
    </div>
  ))
  return (
    <section className="lg-glass lg-chart">
      <BoardHead name="Strength"><StrengthFlap view={view} /></BoardHead>
      <svg viewBox="0 0 320 130" aria-label={view.lifts.map(l => `${l.name} ${liftFlap(l).toLowerCase()}`).join(', ')}>
        <GRID w={320} h={130} />
        {view.started
          ? (
            <>
              <line x1="0" x2="320" y1="114" y2="114" stroke="rgba(240,230,192,.2)" />
              <text x="2" y="128" className="lg-hbd">WK 1</text>
              {view.currentWeek > 1 && <text x="318" y="128" textAnchor="end" className="lg-hbd">WK {view.currentWeek}</text>}
              {lines.map((l, i) => <PathLine key={l.exerciseId} pts={l.pts} h={130} col={LIFT_COL[i]} />)}
            </>
          )
          : (
            <>
              <line x1="0" x2="320" y1="120" y2="120" stroke="rgba(240,230,192,.2)" />
              <text x="4" y="116" className="lg-hbd">WEEK 1 = 0</text>
            </>
          )}
      </svg>
      {view.started && <div className="lg-legend is-wrap"><span>how much stronger since week 1, reps included</span></div>}
      {!view.started && <p className="lg-hline">{view.line}</p>}
      {rows}
      {view.started && <p className="lg-hline">{view.line}</p>}
    </section>
  )
}
