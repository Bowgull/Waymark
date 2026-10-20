import { Fragment, type ReactNode } from 'react'

import { Board, FlapLabel, SessionIcon, type SessionIconKey } from '@/design'
import { videoButton, type VideoFields } from '@/lib/videoLinks'

import {
  MASTERY_MAX,
  TIER_NAMES,
  classDayLabel,
  comboStrikes,
  combosUsing,
  equipmentName,
  hintParts,
  muscleBadges,
  techniqueFor,
  techniqueSub,
  tipList,
  type LibraryCombo,
  type LibraryExercise,
  type LibraryRun,
  type LibraryTechnique,
} from './libraryModel'

// The Library's item pages (page 52, filled as page 60 shows): the hero, then
// boards for Cue, Tips and Coach hint, then the video, with the coach and the
// length under the button. Videos open outside the app.

/** A combo's strikes as tiles joined by ›, the glove after one from class. */
export function Strikes({ text, glove = false, size = 'xs' }: { text: string; glove?: boolean; size?: 'xs' | 'sm' }) {
  const strikes = comboStrikes(text)
  return (
    <span className="lib-strikes" aria-label={`${strikes.join(', ')}${glove ? ', from class' : ''}`}>
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

function Hero({ icon, title, sub }: { icon: SessionIconKey; title: string; sub: string }) {
  return (
    <Board className="lib-bd lib-hero-bd">
      <div className="lib-hero">
        <SessionIcon kind={icon} size={52} label="" />
        <div className="t">
          <FlapLabel text={title.toUpperCase()} size="md" fit />
          {sub && <span className="lib-sub">{sub}</span>}
        </div>
      </div>
    </Board>
  )
}

function ItemBoard({ head, children }: { head: string; children: ReactNode }) {
  return <Board className="lib-bd" head={head}>{children}</Board>
}

function Tips({ tips }: { tips: string | null | undefined }) {
  const list = tipList(tips)
  if (list.length === 0) return null
  return <ItemBoard head="Tips"><ul className="lib-tips">{list.map(t => <li key={t}>{t}</li>)}</ul></ItemBoard>
}

function Hint({ hint }: { hint: string | null | undefined }) {
  if (!hint) return null
  const [lead, rest] = hintParts(hint)
  return <ItemBoard head="Coach hint"><p className="lib-hint"><b>{lead}</b>{rest ? ` ${rest}` : ''}</p></ItemBoard>
}

const PLAY = <svg viewBox="0 0 10 10" fill="none" stroke="#e8c878" strokeWidth="1.4" strokeLinejoin="round" aria-hidden><path d="M2.5 1.5 L8 5 L2.5 8.5 Z" /></svg>
const LOOK = <svg viewBox="0 0 12 12" fill="none" stroke="#c9b27a" strokeWidth="1.5" strokeLinecap="round" aria-hidden><circle cx="5" cy="5" r="3.4" /><path d="M7.6 7.6 L10.6 10.6" /></svg>

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

/**
 * The video board (page 60): WATCH ON YOUTUBE (or TIKTOK), then who and how
 * long; a TikTok as a quiet second link. A dead link never shows a broken
 * WATCH: the backup, the technique's video, then SEARCH ON YOUTUBE.
 */
function VideoBoard({ name, video, technique }: { name: string; video: VideoFields; technique?: VideoFields | null }) {
  const b = videoButton(name, video, technique)
  if (!b) return null
  const tiktok = b.kind === 'watch' && video.tiktokUrl && !b.href.includes('tiktok.com') ? video.tiktokUrl : null
  return (
    <Board className="lib-bd lib-vid-bd">
      {b.note && <p className="lib-gone">{b.note}</p>}
      <a className={`wm-btn lib-vid${b.kind === 'watch' ? ' is-primary' : ' is-search'}`} href={b.href} target="_blank" rel="noopener noreferrer" aria-label={b.label}>
        {b.kind === 'watch' ? PLAY : LOOK}
        <FlapLabel text={b.label} size="sm" tone={b.kind === 'watch' ? 'gold' : 'ink'} />
      </a>
      {(b.source || b.detail) && (
        <div className="lib-vsrc">
          {b.source && <span className="who">{b.source}</span>}
          {b.detail && <span className="what">{b.detail}</span>}
        </div>
      )}
      {tiktok && (
        <a className="lib-also" href={tiktok} target="_blank" rel="noopener noreferrer">
          {PLAY}<span>Also on TikTok{video.source ? ` · ${tiktokWho(tiktok)}` : ''}</span>
        </a>
      )}
    </Board>
  )
}

const tiktokWho = (url: string) => /tiktok\.com\/@([^/]+)/.exec(url)?.[1] ?? 'TikTok'

// ─── the four item pages ──────────────────────────────────────

const GROUP_ICON: Record<string, SessionIconKey> = { strength: 'strength', core: 'core', posture: 'foundation', mobility: 'mobility' }

export function ExercisePage({ ex }: { ex: LibraryExercise }) {
  const eq = equipmentName(ex.equipment)
  const sub = [eq, muscleBadges(ex.muscleGroups).join(', ')].filter(Boolean).join(' · ')
  return (
    <>
      <Hero icon={GROUP_ICON[ex.category] ?? 'strength'} title={ex.name} sub={sub} />
      {ex.formCues && <ItemBoard head="Cue"><p className="lib-cue2">{ex.formCues}</p></ItemBoard>}
      <Tips tips={ex.tips} />
      <Hint hint={ex.coachHint} />
      <VideoBoard name={ex.name} video={videoOf(ex)} />
    </>
  )
}

export function ComboPage({ combo, techniques, onFavourite }: { combo: LibraryCombo; techniques: LibraryTechnique[]; onFavourite: () => void }) {
  const fromClass = combo.source === 'class'
  const fav = combo.isFavourite === 1
  // a class combo still new: page 52's hint
  const hint = fromClass && combo.masteryScore === 0 ? 'New in your bag. It comes up often until you\'ve rated it a few times.' : combo.coachHint
  // the first strike with a technique video stands in when the combo's own is gone
  const tech = comboStrikes(combo.text).map(s => techniqueFor(s, techniques)).find(t => t?.formVideoUrl) ?? null
  return (
    <>
      <Board className="lib-bd">
        <div className="lib-ctop">
          <FlapLabel text={TIER_NAMES[combo.tier] ?? combo.tier.toUpperCase()} size="xs" />
          <button type="button" className={`lib-anvil${fav ? ' is-fav' : ''}`} aria-pressed={fav} aria-label={fav ? 'Favourite' : 'Make favourite'} onClick={onFavourite}>
            <svg viewBox="0 0 26 20" aria-hidden><path d="M2 5h16c0 3 2 4 6 4v1c-4 0-6 1-7 3l1 3H7l1-3c-1-2-3-3-6-3z" /></svg>
          </button>
        </div>
        <Strikes text={combo.text} size="sm" />
        {fromClass && (
          <div className="lib-from"><SessionIcon kind="mt" size={22} label="" />From your class{combo.classDate != null ? `, ${classDayLabel(combo.classDate)}` : ''}</div>
        )}
      </Board>
      {combo.cue && (
        <ItemBoard head="Cue"><div className="lib-cueflap"><span className="wm-label">Cue</span><FlapLabel text={combo.cue} size="sm" tone="teal" /></div></ItemBoard>
      )}
      <Tips tips={combo.formTips} />
      <ItemBoard head="Mastery">
        <div className="lib-rows">
          <div className="lib-r"><span className="wm-label">Mastery</span><FlapLabel text={`${combo.masteryScore}/${MASTERY_MAX}`} size="sm" /></div>
          <div className="lib-r"><span className="wm-label">Sharp ratings</span><FlapLabel text={String(combo.timesSharp)} size="sm" /></div>
        </div>
      </ItemBoard>
      <Hint hint={hint} />
      <VideoBoard name={comboStrikes(combo.text).join(' ').toLowerCase()} video={videoOf(combo)} technique={tech ? videoOf(tech) : null} />
    </>
  )
}

export function TechniquePage({ t, combos, techniques }: { t: LibraryTechnique; combos: LibraryCombo[]; techniques: LibraryTechnique[] }) {
  const uses = combosUsing(t, combos.filter(c => c.unlocked), techniques)
  return (
    <>
      <Hero icon="mt" title={t.name} sub={techniqueSub(t)} />
      {t.cue && <ItemBoard head="Cue"><p className="lib-cue2">{t.cue}</p></ItemBoard>}
      <Tips tips={t.tips} />
      {uses.length > 0 && (
        <ItemBoard head="In your combos"><div className="lib-uses">{uses.map(c => <Strikes key={c.id} text={c.text} glove={c.source === 'class'} />)}</div></ItemBoard>
      )}
      <Hint hint={t.coachHint} />
      <VideoBoard name={t.name} video={videoOf(t)} />
    </>
  )
}

export function RunPage({ r }: { r: LibraryRun }) {
  return (
    <>
      <Hero icon={r.runType === 'zone2' ? 'zone2' : 'run'} title={r.name} sub={`Run · ${r.sub ?? ''}`} />
      {r.what && <ItemBoard head="What it is"><p className="lib-cue2">{r.what}</p></ItemBoard>}
      <Tips tips={r.tips} />
      <Hint hint={r.coachHint} />
      <VideoBoard name={r.name} video={videoOf(r)} />
    </>
  )
}
