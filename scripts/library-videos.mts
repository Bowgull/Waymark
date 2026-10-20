/**
 * The Library's video start times and swaps (approved by Josh 2026-10-20),
 * from docs/library/library-video-starts.csv (25 long videos: where the
 * move starts) and docs/library/library-video-replacements.csv (10 swaps;
 * combo-w12 stays as it is).
 *
 *   npx tsx scripts/library-videos.mts --check   checks every new and changed link live
 *                                                 (YouTube oEmbed, plus the watch page for the
 *                                                 length; TikTok oEmbed and the video page's
 *                                                 statusCode), about one call a second, and writes
 *                                                 docs/library/video-check.json
 *   npx tsx scripts/library-videos.mts           writes drizzle/0039_library_videos.sql and
 *                                                 src/db/libraryVideos.sql (appended to seed.sql)
 *
 * Content only: rows are updated by id. No user data is touched.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkLink, hostOf, youtubeId, type VideoStatus } from '../src/lib/videoLinks'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STARTS = join(ROOT, 'docs/library/library-video-starts.csv')
const SWAPS = join(ROOT, 'docs/library/library-video-replacements.csv')
const CHECK = join(ROOT, 'docs/library/video-check.json')
const CURRENT = join(ROOT, 'src/db/libraryContent.sql')

/** The swaps Josh kept as they are. */
const UNCHANGED = new Set(['combo-w12'])

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows.filter(r => r.length > 1)
  const keys = head.map(h => h.replace(new RegExp(String.fromCharCode(0x5e, 0xfeff)), ''))
  return body.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

const sq = (v: string | number | null | undefined) => (v == null || v === '' ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

const TABLE_OF = (id: string) =>
  id.startsWith('ex-') ? 'exercises' : id.startsWith('combo-') ? 'combos' : id.startsWith('tech-') ? 'techniques' : id.startsWith('run-') ? 'run_types' : null

const starts = parseCsv(readFileSync(STARTS, 'utf8'))
const swaps = parseCsv(readFileSync(SWAPS, 'utf8'))
if (starts.length !== 25) throw new Error(`expected 25 start times, got ${starts.length}`)
if (swaps.length !== 11) throw new Error(`expected 11 swap rows (10 swaps and combo-w12), got ${swaps.length}`)

/** What 0038 left in each row: the main video, the backup and its coach. */
interface Current { url: string | null; altUrl: string | null; altSource: string | null; source: string | null; title: string | null; length: string | null; status: string | null; tiktok: string | null }
function currentRows(): Map<string, Current> {
  const out = new Map<string, Current>()
  const field = (line: string, name: string) => {
    const m = new RegExp(`\\b${name} = (NULL|'((?:[^']|'')*)')`).exec(line)
    return m && m[1] !== 'NULL' ? m[2].replace(/''/g, "'") : null
  }
  for (const line of readFileSync(CURRENT, 'utf8').split(/\r?\n/)) {
    const id = /WHERE id = '([^']+)';$/.exec(line)?.[1]
    if (!id || !line.includes('form_video_url')) continue
    out.set(id, {
      url: field(line, 'form_video_url'), altUrl: field(line, 'alt_video_url'), altSource: field(line, 'alt_video_source'),
      source: field(line, 'video_source'), title: field(line, 'video_title'), length: field(line, 'video_length'),
      status: field(line, 'video_status'), tiktok: field(line, 'tiktok_url'),
    })
  }
  return out
}
const current = currentRows()

/** The swaps that apply: the proposed video becomes the main one. */
const applied = swaps.filter(s => !UNCHANGED.has(s.id))
for (const s of [...starts, ...swaps]) {
  if (!TABLE_OF(s.id)) throw new Error(`no table for ${s.id}`)
  const cur = current.get(s.id)
  if (!cur) throw new Error(`${s.id} is not in the Library content`)
  const was = s.url ?? s.current_url
  if (cur.url !== was) throw new Error(`${s.id}: the CSV's current video ${was} is not the one in the Library (${cur.url})`)
}
for (const s of applied) {
  const source = s.main_source || 'youtube'
  if (source !== 'youtube' && source !== 'tiktok') throw new Error(`${s.id}: main_source ${source}`)
  if (hostOf(s.proposed_url) !== source) throw new Error(`${s.id}: main_source ${source} but the link is ${hostOf(s.proposed_url)}`)
  if (s.second_url && hostOf(s.second_url) === 'other') throw new Error(`${s.id}: second link ${s.second_url}`)
  if (!/^\d+$/.test(s.start_seconds)) throw new Error(`${s.id}: start ${s.start_seconds}`)
}
for (const s of starts) if (!/^\d+$/.test(s.start_seconds)) throw new Error(`${s.id}: start ${s.start_seconds}`)

// ─── the link check ───────────────────────────────────────────

interface Checked { status: VideoStatus; title: string | null; author: string | null; length: string | null; via: string }
type CheckFile = { checkedAt: string; counts: Record<string, number>; links: Record<string, Checked> }

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const UA = { 'User-Agent': 'Mozilla/5.0 (Waymark link check)', 'Accept-Language': 'en' }

async function checkOne(url: string): Promise<Checked> {
  if (hostOf(url) === 'youtube') {
    const status = await checkLink(url, (u, init) => fetch(u, init))
    let title: string | null = null
    let author: string | null = null
    let length: string | null = null
    if (status === 'live') {
      const o = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`).then(r => r.json()) as { title?: string; author_name?: string }
      title = o.title ?? null
      author = o.author_name ?? null
      await wait(1100)
      const page = await fetch(`https://www.youtube.com/watch?v=${youtubeId(url)}`, { headers: UA }).then(r => r.text())
      const sec = /"lengthSeconds":"(\d+)"/.exec(page)?.[1]
      length = sec ? mmss(Number(sec)) : null
    }
    return { status, title, author, length, via: 'YouTube oEmbed' }
  }
  // TikTok: its oEmbed (the author and caption), then the page's statusCode (oEmbed answers 200 for anything)
  // TikTok's oEmbed now gives only the video's id (embed_product_id): it must be this video's
  const o = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`).then(r => (r.ok ? r.json() : {})).catch(() => ({})) as { embed_product_id?: string; title?: string; author_name?: string }
  const oembedOk = o.embed_product_id != null && url.endsWith(`/video/${o.embed_product_id}`)
  await wait(1100)
  const page = await checkLink(url, (u, init) => fetch(u, init))
  const status: VideoStatus = page === 'live' && !oembedOk ? 'unchecked' : page
  const author = /tiktok\.com\/@([^/]+)/.exec(url)?.[1] ?? null
  return { status, title: o.title ?? null, author: o.author_name ?? author, length: null, via: `TikTok oEmbed (${oembedOk ? 'id matches' : 'no match'}) + page statusCode (${page})` }
}

function linksToCheck(): string[] {
  const urls = new Set<string>()
  for (const s of starts) urls.add(s.url)
  for (const s of swaps) { urls.add(s.proposed_url); if (s.second_url) urls.add(s.second_url) }
  return [...urls]
}

async function check(): Promise<CheckFile> {
  const links: Record<string, Checked> = {}
  for (const [i, u] of linksToCheck().entries()) {
    if (i > 0) await wait(1100)
    links[u] = await checkOne(u)
    console.log(`${links[u].status.padEnd(9)} ${u}${links[u].title ? `  (${links[u].author}: ${links[u].title}${links[u].length ? ` · ${links[u].length}` : ''})` : ''}`)
  }
  const counts = Object.values(links).reduce<Record<string, number>>((m, c) => { m[c.status] = (m[c.status] ?? 0) + 1; return m }, {})
  const file = { checkedAt: new Date().toISOString(), counts, links }
  writeFileSync(CHECK, JSON.stringify(file, null, 2) + '\n')
  console.log(`link check: ${JSON.stringify(counts)}`)
  return file
}

// ─── the SQL ──────────────────────────────────────────────────

function contentSql(file: CheckFile): string[] {
  const checkedAt = Math.floor(Date.parse(file.checkedAt) / 1000)
  const info = (u: string) => {
    const c = file.links[u]
    if (!c) throw new Error(`${u} was not checked: run with --check`)
    if (c.status !== 'live') throw new Error(`${u} is ${c.status}: not applied`)
    return c
  }
  const swapped = new Map(applied.map(s => [s.id, s]))
  const out: string[] = []
  out.push('-- Start times: where the move starts in each long video (the CSV\'s evidence and confidence are in docs/library).')
  for (const s of starts) {
    if (swapped.has(s.id)) continue // the swap's own start time below
    info(s.url)
    out.push(`UPDATE ${TABLE_OF(s.id)} SET video_start_sec = ${Number(s.start_seconds)} WHERE id = ${sq(s.id)};`)
  }
  out.push('-- The swaps: the new main video with its start time, coach, title and length; the TikTok as the second link.')
  for (const s of applied) {
    const v = info(s.proposed_url)
    if (s.second_url) info(s.second_url)
    const cur = current.get(s.id)!
    const set = [
      `form_video_url = ${sq(s.proposed_url)}`,
      `video_start_sec = ${Number(s.start_seconds) || 'NULL'}`,
      `video_source = ${sq(s.channel)}`,
      `video_title = ${sq(v.title)}`,
      `video_length = ${sq(v.length)}`,
      `video_status = 'live'`,
      `video_checked_at = ${checkedAt}`,
    ]
    if (s.second_url) set.push(`tiktok_url = ${sq(s.second_url)}`)
    // the new video was this item's backup: the old main video takes its place, so nothing is lost
    if (cur.altUrl === s.proposed_url && cur.url) {
      set.push(`alt_video_url = ${sq(cur.url)}`, `alt_video_source = ${sq(cur.source)}`, `alt_video_status = ${sq(cur.status)}`)
    }
    out.push(`UPDATE ${TABLE_OF(s.id)} SET ${set.join(', ')} WHERE id = ${sq(s.id)};`)
  }
  const kept = swaps.filter(s => UNCHANGED.has(s.id))
  for (const s of kept) {
    const st = starts.find(x => x.id === s.id)
    out.push(`-- ${s.id}: kept as it is (no reputable clip of the combo found)${st ? '; its start time is above' : ''}.`)
  }
  return out
}

const HEAD = `-- Library videos: start times and swaps (approved by Josh 2026-10-20).
-- Generated by scripts/library-videos.mts from docs/library/library-video-starts.csv
-- and docs/library/library-video-replacements.csv; every link checked live first
-- (docs/library/video-check.json).
--
-- Additive only: no new tables or columns, content rows updated by id. No user
-- data is touched or wiped.
--
-- video_start_sec (0038) is where the move starts; the app opens YouTube at it
-- (t=). The main video may now be a TikTok (the Library reads the link's host);
-- tiktok_url is the quiet second link, whichever host it is on. combo-w12 stays.
`

async function main() {
  const file: CheckFile = process.argv.includes('--check')
    ? await check()
    : existsSync(CHECK) ? JSON.parse(readFileSync(CHECK, 'utf8')) : (() => { throw new Error('no video-check.json: run with --check') })()
  const content = contentSql(file)
  writeFileSync(join(ROOT, 'drizzle/0039_library_videos.sql'), `${HEAD}\n${content.join('\n')}\n`)
  writeFileSync(join(ROOT, 'src/db/libraryVideos.sql'), `-- The Library's video start times and swaps, the same rows as drizzle/0039_library_videos.sql.\n-- Appended to seed.sql after libraryContent.sql.\n${content.join('\n')}\n`)
  console.log(`wrote 0039 (${content.filter(l => !l.startsWith('--')).length} statements) and libraryVideos.sql`)
}

void main()
