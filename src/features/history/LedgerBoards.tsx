import { FlapLabel, SessionIcon } from '@/design'
import { RING_COLOUR, linePoints, paceDelta, paceFlap, spanWeeks, weightDelta, type LedgerRing, type LiftSeries, type RingState, type SleepDay, type WeeklyPoint } from '@/lib/ledger'

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

/** Consistency (page 46): the streak flap, then one bar per week (oldest first), lit when the week counted. */
export function ConsistencyBoard({ streak, weeks }: { streak: number; weeks: boolean[] }) {
  const lit = weeks.filter(Boolean).length
  return (
    <section className="lg-glass">
      <div className="lg-rows"><div className="r"><span className="lg-label grow">Consistency</span><FlapLabel text={`${streak}D STREAK`} size="xs" tone="gold" animate={false} /></div></div>
      {weeks.length > 0 && (
        <>
          <div className={`lg-wbar${weeks.length > 26 ? ' is-fine' : weeks.length > 13 ? ' is-mid' : ''}`} role="img" aria-label={`${lit} of the last ${weeks.length} weeks counted`}>
            {weeks.map((on, i) => <i key={i} className={on ? undefined : 'off'} />)}
          </div>
          <div className="lg-wbar-k"><span>{weeks.length} weeks ago</span><span>this week</span></div>
        </>
      )}
    </section>
  )
}
