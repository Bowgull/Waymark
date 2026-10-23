import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Board, CloseWord, Expand, FlapLabel, SessionIcon, type SessionIconKey } from '@/design'
import { runWalkShape, runWalkTotal, setText, type LastSet, type RunWalkNow } from '@/lib/libraryHints'
import { coachName, secondLink, videoButton, type VideoFields, type VideoHost } from '@/lib/videoLinks'

import {
  TIER_NAMES,
  classDayLabel,
  comboStrikes,
  combosUsing,
  cueSplit,
  equipmentName,
  exerciseMeta,
  isMastered,
  lastSetWhen,
  masteryDots,
  masteryWords,
  moreSummary,
  sharpLine,
  techniqueFor,
  techniqueMeta,
  tipList,
  type LibraryCombo,
  type LibraryExercise,
  type LibraryRun,
  type LibraryTechnique,
} from './libraryModel'

// The Library's item pages (page 65, approved 2026-10-20): one board on top
// with the move, the one number that helps right now and WATCH (cream on
// charcoal in a gold frame, the platform's mark, the coach named, ↗); one
// short cue line with no heading; everything else behind MORE, which opens in
// place. The data stays whole: only what shows first changed. Videos open
// outside the app.

/** The smallest a strike's flap goes when a long combo is fitted to one line (the xs minimum). */
const STRIKE_MIN_PX = 14

/**
 * A combo's strikes as tiles joined by ›, the glove after one from class.
 * `fit` (page 65's top board): a long combo's tiles step down a pixel at a
 * time to stay on one line, never below 14 px; past that it wraps.
 */
export function Strikes({ text, glove = false, size = 'xs', fit = false }: { text: string; glove?: boolean; size?: 'xs' | 'sm'; fit?: boolean }) {
  const strikes = comboStrikes(text)
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (!fit || !box) return
    const flaps = Array.from(box.querySelectorAll<HTMLElement>(':scope > .lib-stk > .wm-flap'))
    if (flaps.length === 0) return
    flaps.forEach(f => f.style.removeProperty('font-size'))
    box.style.flexWrap = 'nowrap'
    const kids = Array.from(box.children) as HTMLElement[]
    const span = () => kids[kids.length - 1].getBoundingClientRect().right - kids[0].getBoundingClientRect().left
    let px = parseFloat(getComputedStyle(flaps[0]).fontSize)
    while (span() > box.clientWidth + 1 && px > STRIKE_MIN_PX) {
      px -= 1
      flaps.forEach(f => f.style.setProperty('font-size', `${px}px`))
    }
    box.style.flexWrap = ''
  }, [fit, text, size])
  return (
    <span ref={ref} className="lib-strikes" aria-label={`${strikes.join(', ')}${glove ? ', from class' : ''}`}>
      {strikes.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="lib-arr" aria-hidden>›</span>}
          <span className="lib-stk"><FlapLabel text={s} size={size} /></span>
        </Fragment>
      ))}
      {glove && <SessionIcon kind="mt" size={20} className="lib-glove" label="" />}
    </span>
  )
}

/** The five brass dots (mastery A, page 21). */
export function MasteryDots({ score }: { score: number }) {
  const n = masteryDots(score)
  return (
    <span className="lib-dots" aria-hidden>
      {'●'.repeat(n)}<i>{'●'.repeat(5 - n)}</i>
    </span>
  )
}

// ─── the top board ────────────────────────────────────────────

function Hero({ icon, title, meta }: { icon: SessionIconKey; title: string; meta: string | null }) {
  return (
    <div className="lib-ihero">
      <SessionIcon kind={icon} size={48} label="" />
      <div className="t">
        <FlapLabel text={title.toUpperCase()} size="md" fit />
        {meta && <span className="lib-imeta">{meta}</span>}
      </div>
    </div>
  )
}

/** The platforms' own marks, small, so leaving the app is plain (page 65). */
function PlatformMark({ host }: { host: VideoHost }) {
  if (host === 'tiktok') {
    return (
      <svg className="lib-pf" viewBox="0 0 30 30" aria-hidden>
        <rect x="1" y="1" width="28" height="28" rx="7" fill="#111" />
        <g fill="none" strokeWidth="2.6" strokeLinecap="round">
          <path d="M14.4 7.5v11.2a3.4 3.4 0 1 1-3.4-3.4" stroke="#25f4ee" transform="translate(-.8 -.6)" />
          <path d="M14.4 7.5c.5 2.6 2.2 4.1 4.8 4.3" stroke="#25f4ee" transform="translate(-.8 -.6)" />
          <path d="M14.4 7.5v11.2a3.4 3.4 0 1 1-3.4-3.4" stroke="#fe2c55" transform="translate(.8 .6)" />
          <path d="M14.4 7.5c.5 2.6 2.2 4.1 4.8 4.3" stroke="#fe2c55" transform="translate(.8 .6)" />
          <path d="M14.4 7.5v11.2a3.4 3.4 0 1 1-3.4-3.4M14.4 7.5c.5 2.6 2.2 4.1 4.8 4.3" stroke="#fff" />
        </g>
      </svg>
    )
  }
  return (
    <svg className="lib-pf" viewBox="0 0 30 30" aria-hidden>
      <rect x="1" y="6" width="28" height="19" rx="6" fill="#d8352a" />
      <path d="M12.2 10.6 L19.8 15.5 L12.2 20.4 Z" fill="#fff" />
    </svg>
  )
}

type HasVideo = { formVideoUrl?: string | null; videoStartSec?: number | null; videoSource?: string | null; videoTitle?: string | null; videoLength?: string | null; videoStatus?: string | null; altVideoUrl?: string | null; altVideoSource?: string | null; altVideoStatus?: string | null; tiktokUrl?: string | null }

function videoOf(x: HasVideo): VideoFields {
  return {
    url: x.formVideoUrl ?? null,
    startSec: x.videoStartSec ?? null,
    source: x.videoSource ?? null,
    title: x.videoTitle ?? null,
    length: x.videoLength ?? null,
    status: x.videoStatus ?? null,
    altUrl: x.altVideoStatus === 'dead' ? null : x.altVideoUrl ?? null,
    altSource: x.altVideoSource ?? null,
    tiktokUrl: x.tiktokUrl ?? null,
  }
}

const HOST_NAME: Record<VideoHost, string> = { youtube: 'YouTube', tiktok: 'TikTok', other: 'the web' }

/**
 * WATCH (page 65): the platform's mark, WATCH, the coach, ↗; under it only the
 * length and "from 0:08" when it has a start time; the other link quietly
 * under that ("also on TikTok ›"). No raw video title. A dead link never shows
 * a broken WATCH: the backup, the technique's video, then a search.
 */
function Watch({ name, video, technique }: { name: string; video: VideoFields; technique?: VideoFields | null }) {
  const b = videoButton(name, video, technique)
  if (!b) return null
  const also = secondLink(video, b)
  const search = b.kind === 'search'
  const who = search ? name.toLowerCase() : coachName(b.source)
  return (
    <>
      {b.note && <p className="lib-gone">{b.note}</p>}
      <a className="lib-watch" href={b.href} target="_blank" rel="noopener noreferrer" aria-label={`${search ? 'Search' : 'Watch'} on ${HOST_NAME[b.host]}${who ? `: ${who}` : ''}`}>
        <PlatformMark host={b.host} />
        <FlapLabel text={search ? 'SEARCH' : 'WATCH'} size="sm" />
        {who && <span className="who">{who}</span>}
        <span className="out" aria-hidden>↗</span>
      </a>
      {(b.length || b.start) && (
        <div className="lib-vline">{b.length}{b.length && b.start ? ' · ' : ''}{b.start && <span>from {b.start}</span>}</div>
      )}
      {also && <a className="lib-alsoq" href={also.href} target="_blank" rel="noopener noreferrer">{also.label.replace(/^Also/, 'also')} ›</a>}
    </>
  )
}

function TopBoard({ children }: { children: ReactNode }) {
  return <Board className="lib-bd lib-top">{children}</Board>
}

/** The one cue line, no heading. */
function CueLine({ text }: { text: string | null }) {
  return text ? <p className="lib-cueline">{text}</p> : null
}

// ─── MORE ─────────────────────────────────────────────────────

/** MORE (page 65): one row that opens in place to one board; CLOSE or a tap on its head folds it. */
function More({ summary, children }: { summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="lib-morewrap">
      <Expand open={!open}>
        <button type="button" className="lib-more" aria-expanded={false} onClick={() => setOpen(true)}>
          <span className="t"><b>MORE</b>{summary}</span>
          <span className="chev" aria-hidden>▾</span>
        </button>
      </Expand>
      <Expand open={open}>
        <Board
          className="lib-mbd"
          head={<button type="button" className="lib-fold" aria-expanded onClick={() => setOpen(false)}>More ▴</button>}
          headRight={<CloseWord onClose={() => setOpen(false)} />}
        >
          {children}
        </Board>
      </Expand>
    </div>
  )
}

function MoreTips({ tips }: { tips: string[] }) {
  if (tips.length === 0) return null
  return (
    <>
      <div className="lib-mlab">TIPS</div>
      <ul className="lib-mtips">{tips.map(t => <li key={t}>{t}</li>)}</ul>
    </>
  )
}

function MoreNote({ label, text }: { label?: string; text: string | null | undefined }) {
  if (!text) return null
  return (
    <>
      {label && <div className="lib-mlab">{label}</div>}
      <p className={`lib-mnote${label ? '' : ' is-lead'}`}>{text}</p>
    </>
  )
}

// ─── the four item pages ──────────────────────────────────────

/** Today's local epoch day (the session days the hints carry are local days). */
const localToday = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000)

const GROUP_ICON: Record<string, SessionIconKey> = { strength: 'strength', core: 'core', posture: 'foundation', mobility: 'mobility' }

export function ExercisePage({ ex, last = null }: { ex: LibraryExercise; last?: LastSet | null }) {
  const cue = cueSplit(ex.formCues, ex.cueLine)
  const tips = tipList(ex.tips)
  const coach = ex.coachNote ?? ex.coachHint ?? null
  return (
    <>
      <TopBoard>
        <Hero icon={GROUP_ICON[ex.category] ?? 'strength'} title={ex.name} meta={exerciseMeta(equipmentName(ex.equipment), last ? setText(last) : null, last ? lastSetWhen(last.day, localToday()) : '') || null} />
        <Watch name={ex.name} video={videoOf(ex)} />
      </TopBoard>
      <CueLine text={cue.line} />
      {(cue.rest || tips.length > 0 || coach) && (
        <More summary={moreSummary({ tips: tips.length, coach: !!coach, how: !!cue.rest })}>
          <MoreNote text={cue.rest} />
          <MoreTips tips={tips} />
          <MoreNote label="COACH" text={coach} />
        </More>
      )}
    </>
  )
}

export function ComboPage({ combo, techniques, onFavourite }: { combo: LibraryCombo; techniques: LibraryTechnique[]; onFavourite: () => void }) {
  const fromClass = combo.source === 'class'
  const fav = combo.isFavourite === 1
  const tips = tipList(combo.formTips)
  // a combo still locked: the static hint says how it opens (the per-tier line is cut, page 65)
  const coach = !combo.unlocked ? combo.coachHint ?? null : null
  // the first strike with a technique video stands in when the combo's own is gone
  const tech = comboStrikes(combo.text).map(s => techniqueFor(s, techniques)).find(t => t?.formVideoUrl) ?? null
  const cls = ['lib-anvil', fav ? 'is-fav' : '', isMastered(combo) ? 'is-mastered' : ''].filter(Boolean).join(' ')
  return (
    <>
      <TopBoard>
        <div className="lib-ctop">
          <FlapLabel text={TIER_NAMES[combo.tier] ?? combo.tier.toUpperCase()} size="xs" />
          <button type="button" className={cls} aria-pressed={fav} aria-label={fav ? 'Favourite' : 'Make favourite'} onClick={onFavourite}>
            <svg viewBox="0 0 26 20" aria-hidden><path d="M2 5h16c0 3 2 4 6 4v1c-4 0-6 1-7 3l1 3H7l1-3c-1-2-3-3-6-3z" /></svg>
          </button>
        </div>
        <Strikes text={combo.text} size="sm" fit />
        {fromClass && (
          <div className="lib-from"><SessionIcon kind="mt" size={22} label="" />From your class{combo.classDate != null ? `, ${classDayLabel(combo.classDate)}` : ''}</div>
        )}
        <div className="lib-mast" aria-label={`Mastery ${combo.masteryScore} of 15`}><MasteryDots score={combo.masteryScore} /><span>{masteryWords(combo.masteryScore)}</span></div>
        <Watch name={comboStrikes(combo.text).join(' ').toLowerCase()} video={videoOf(combo)} technique={tech ? videoOf(tech) : null} />
      </TopBoard>
      {combo.cue && <div className="lib-cuef"><FlapLabel text={combo.cue} size="sm" tone="teal" /></div>}
      {(tips.length > 0 || combo.timesSharp > 0 || coach) && (
        <More summary={moreSummary({ tips: tips.length, sharp: combo.timesSharp, coach: !!coach })}>
          <MoreTips tips={tips} />
          {combo.timesSharp > 0 && <MoreNote label="RATINGS" text={sharpLine(combo.timesSharp)} />}
          <MoreNote label="COACH" text={coach} />
        </More>
      )}
    </>
  )
}

export function TechniquePage({ t, combos, techniques, onSearch }: { t: LibraryTechnique; combos: LibraryCombo[]; techniques: LibraryTechnique[]; onSearch?: (q: string) => void }) {
  const uses = combosUsing(t, combos.filter(c => c.unlocked), techniques)
  const cue = cueSplit(t.cue, t.cueLine)
  const tips = tipList(t.tips)
  return (
    <>
      <TopBoard>
        <Hero icon="mt" title={t.name} meta={techniqueMeta(t, uses.length)} />
        <Watch name={t.name} video={videoOf(t)} />
      </TopBoard>
      <CueLine text={cue.line} />
      {(cue.rest || tips.length > 0 || uses.length > 0) && (
        <More summary={moreSummary({ tips: tips.length, combos: uses.length > 0, how: !!cue.rest })}>
          <MoreNote text={cue.rest} />
          <MoreTips tips={tips} />
          {uses.length > 0 && (
            <>
              <div className="lib-mlab">IN YOUR COMBOS</div>
              <div className="lib-uses">
                {uses.slice(0, 3).map(c => <Strikes key={c.id} text={c.text} glove={c.source === 'class'} />)}
                {uses.length > 3 && (
                  <button type="button" className="lib-and" onClick={() => onSearch?.(t.name.toLowerCase())}>and {uses.length - 3} more ›</button>
                )}
              </div>
            </>
          )}
        </More>
      )}
    </>
  )
}

export function RunPage({ r, runWalk = null }: { r: LibraryRun; runWalk?: RunWalkNow | null }) {
  const live = r.runType === 'run_walk' && runWalk ? runWalk : null
  const cue = cueSplit(r.what, r.cueLine)
  const tips = tipList(r.tips)
  // this week's shape is on top; the whole time joins the note; the hint has nothing left to say
  const note = live ? [cue.rest, runWalkTotal(live)].filter(Boolean).join(' ') : cue.rest
  const coach = live ? null : r.coachHint ?? null
  return (
    <>
      <TopBoard>
        <Hero icon={r.runType === 'zone2' ? 'zone2' : 'run'} title={r.name} meta={live ? `This week: ${runWalkShape(live)}` : r.sub ? `Run · ${r.sub}` : 'Run'} />
        <Watch name={r.name} video={videoOf(r)} />
      </TopBoard>
      <CueLine text={cue.line} />
      {(note || tips.length > 0 || coach) && (
        <More summary={moreSummary({ tips: tips.length, coach: !!coach, how: !!note })}>
          <MoreNote text={note} />
          <MoreTips tips={tips} />
          <MoreNote label="COACH" text={coach} />
        </More>
      )}
    </>
  )
}
