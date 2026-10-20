// Library videos (page 60, approved 2026-10-19). YouTube first (Shorts are the
// main video), TikTok as an optional second link. Since 2026-10-20 a TikTok
// may be the main video too (the replacements' main_source); the host is read
// from the link, and the second link is then whichever host it is on. Videos
// open outside the app. A link that dies never leaves a broken button: the item's backup
// video, then (for a combo) its technique's video, then a YouTube search for
// the move from a trusted coach, labelled SEARCH, not WATCH.
//
// The weekly link check (server/linkHealth.ts) and the pre-commit check
// (scripts/library-content.mts --check) both use checkLink here.

export type VideoStatus = 'live' | 'dead' | 'unchecked'

export interface VideoFields {
  url: string | null
  startSec?: number | null
  source?: string | null
  title?: string | null
  length?: string | null
  status?: string | null
  altUrl?: string | null
  altSource?: string | null
  tiktokUrl?: string | null
}

export type VideoHost = 'youtube' | 'tiktok' | 'other'

export function hostOf(url: string): VideoHost {
  if (/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url)) return 'youtube'
  if (/^https?:\/\/(www\.|m\.|vm\.)?tiktok\.com\//i.test(url)) return 'tiktok'
  return 'other'
}

/** The YouTube video id of a watch, shorts or youtu.be link. */
export function youtubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i.exec(url)
  return m ? m[1] : null
}

/** The link that opens at its start time (YouTube's t=, in seconds). */
export function withStart(url: string, startSec: number | null | undefined): string {
  if (!startSec || startSec <= 0 || hostOf(url) !== 'youtube') return url
  return `${url}${url.includes('?') ? '&' : '?'}t=${Math.round(startSec)}`
}

/** "1:03" → 63. */
export function parseStart(text: string | null | undefined): number | null {
  const m = /^(\d+):(\d{2})$/.exec((text ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** A YouTube search for the move from a trusted coach: "band row E3 Rehab". */
export function searchUrl(name: string, channel: string | null | undefined): string {
  const q = [name, channel].filter(Boolean).join(' ')
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
}

export interface VideoButton {
  /** WATCH ON YOUTUBE, WATCH ON TIKTOK, or SEARCH ON YOUTUBE. */
  label: string
  /** Where it opens (page 65: the platform's mark on the button). */
  host: VideoHost
  /** The video's length ("1:20"), and where it starts ("0:08") when it has a start time. */
  length: string | null
  start: string | null
  href: string
  /** The line under the button: the coach and the title with its length, or the search words. */
  source: string | null
  detail: string | null
  /** "Video gone. Showing a search." when it fell back to a search. */
  note: string | null
  kind: 'watch' | 'search'
}

/** "0:08": where a YouTube link opens (its t=), for the line under the button. Null without one. */
export function startText(url: string, startSec: number | null | undefined): string | null {
  if (!startSec || startSec <= 0 || hostOf(url) !== 'youtube') return null
  const s = Math.round(startSec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The coach on the WATCH button (page 65): the channel's short name.
 * 'Sean "Muay Thai Guy" Fagan' → Muay Thai Guy; 'Empower Gym Tampa (James)' →
 * Empower Gym Tampa; 'National Academy of Sports Medicine (NASM)' → NASM;
 * 'Sylvie von Duuglas-Ittu - Muay Thai' → Sylvie von Duuglas-Ittu;
 * 'E3 Rehab Exercise Library' → E3 Rehab. The stored credit stays as it is.
 */
export function coachName(source: string | null | undefined): string | null {
  let s = (source ?? '').replace(/™/g, '').trim()
  if (!s) return null
  const nick = /"([^"]+)"/.exec(s)
  if (nick) return nick[1].trim()
  const paren = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(s)
  if (paren) s = /^[A-Z0-9]{2,6}$/.test(paren[2].trim()) ? paren[2].trim() : paren[1].trim()
  s = s.split(/\s+-\s+/)[0].trim()
  return s.replace(/\s+Exercise Library$/i, '').trim() || null
}

const watchLabel = (url: string) => (hostOf(url) === 'tiktok' ? 'WATCH ON TIKTOK' : 'WATCH ON YOUTUBE')
const dead = (s: string | null | undefined) => s === 'dead'

/**
 * The button an item shows. Its own video while live; else the backup; else
 * (a combo) its technique's video; else a search on YouTube. Never a dead
 * WATCH button.
 */
export function videoButton(name: string, v: VideoFields, technique?: VideoFields | null): VideoButton | null {
  if (v.url && !dead(v.status)) {
    return { label: watchLabel(v.url), host: hostOf(v.url), length: v.length ?? null, start: startText(v.url, v.startSec), href: withStart(v.url, v.startSec), source: v.source ?? null, detail: v.title ? `${v.title}${v.length ? ` · ${v.length}` : ''}` : v.length ?? null, note: null, kind: 'watch' }
  }
  if (!v.url) return null
  if (v.altUrl) return { label: watchLabel(v.altUrl), host: hostOf(v.altUrl), length: null, start: null, href: v.altUrl, source: v.altSource ?? null, detail: null, note: null, kind: 'watch' }
  if (technique?.url && !dead(technique.status)) {
    return { label: watchLabel(technique.url), host: hostOf(technique.url), length: technique.length ?? null, start: startText(technique.url, technique.startSec), href: withStart(technique.url, technique.startSec), source: technique.source ?? null, detail: technique.title ?? null, note: null, kind: 'watch' }
  }
  const channel = v.source ?? null
  return { label: 'SEARCH ON YOUTUBE', host: 'youtube', length: null, start: null, href: searchUrl(name.toLowerCase(), channel), source: null, detail: [name.toLowerCase(), channel].filter(Boolean).join(' · '), note: 'Video gone. Showing a search.', kind: 'search' }
}

export interface SecondLink { label: string; href: string; who: string | null }

const sameVideo = (a: string, b: string) => a.replace(/[?&]t=\d+$/, '') === b.replace(/[?&]t=\d+$/, '')

/**
 * The quiet second link under the button (tiktok_url, whichever host): "Also
 * on TikTok" under a YouTube video, "Also on YouTube" under a TikTok one. Not
 * shown under a search, or when it is the video the button already opens.
 */
export function secondLink(v: Pick<VideoFields, 'tiktokUrl'>, button: VideoButton | null): SecondLink | null {
  const url = v.tiktokUrl
  if (!url || !button || button.kind !== 'watch' || sameVideo(url, button.href)) return null
  const host = hostOf(url)
  if (host === 'other') return null
  if (host === 'tiktok') return { label: 'Also on TikTok', href: url, who: /tiktok\.com\/@([^/?]+)/.exec(url)?.[1] ?? null }
  return { label: 'Also on YouTube', href: url, who: null }
}

// ─── the link check ───────────────────────────────────────────

export type Fetcher = (url: string, init?: RequestInit) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>

/**
 * Is the video there? YouTube: its oEmbed answers 200 (401, 403, 404: dead
 * or not embeddable). TikTok: the video page's JSON says "statusCode":0 when
 * live, 10204 when gone (TikTok's own oEmbed answers 200 for anything).
 * Anything else (a network error, a 429): unchecked, try again later.
 */
export async function checkLink(url: string, fetcher: Fetcher): Promise<VideoStatus> {
  try {
    if (hostOf(url) === 'tiktok') {
      const res = await fetcher(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Waymark link check)' } })
      if (!res.ok) return res.status === 404 ? 'dead' : 'unchecked'
      const body = await res.text()
      if (/"statusCode":\s*0\b/.test(body)) return 'live'
      if (/"statusCode":\s*10204\b/.test(body)) return 'dead'
      return 'unchecked'
    }
    if (hostOf(url) === 'youtube') {
      const res = await fetcher(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`)
      if (res.ok) return 'live'
      if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 400) return 'dead'
      return 'unchecked'
    }
    return 'unchecked'
  } catch {
    return 'unchecked'
  }
}
