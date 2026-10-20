// Link health for the Library's videos (page 60 item 12, approved 2026-10-19).
// Runs from the Worker's nightly cron: each night it checks the links not
// checked in the last 7 days, oldest first, about one a second, so every
// link is checked about once a week within the Worker's request limit.
// A dead link is marked dead (the app then falls back: the backup, the
// technique's video, a YouTube search) and gets a proposed replacement in
// video_reviews. Nothing is replaced by itself: Josh approves it.

import { and, asc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'

import type { createDB } from '../db/client'
import { combos, exercises, runTypes, techniques, videoReviews } from '../db/schema'
import { checkLink, searchUrl, type Fetcher, type VideoStatus } from '../lib/videoLinks'

type DB = ReturnType<typeof createDB>

export const RECHECK_AFTER_SEC = 7 * 86400
/** Links per night: under the Worker's subrequest limit (oEmbed, and the backup when a link is dead). */
export const LINKS_PER_RUN = 20

const TABLES = { exercise: exercises, combo: combos, technique: techniques, run: runTypes } as const
type Kind = keyof typeof TABLES

interface Due { kind: Kind; id: string; name: string; url: string; source: string | null; altUrl: string | null; checkedAt: number | null }

async function dueLinks(db: DB, nowSec: number, limit: number): Promise<Due[]> {
  const all: Due[] = []
  for (const [kind, t] of Object.entries(TABLES) as Array<[Kind, (typeof TABLES)[Kind]]>) {
    const nameCol = 'name' in t ? t.name : (t as typeof combos).text
    const rows = await db.select({ id: t.id, name: nameCol, url: t.formVideoUrl, source: t.videoSource, altUrl: t.altVideoUrl, checkedAt: t.videoCheckedAt })
      .from(t)
      .where(and(isNotNull(t.formVideoUrl), or(isNull(t.videoCheckedAt), lt(t.videoCheckedAt, nowSec - RECHECK_AFTER_SEC))))
      .orderBy(asc(t.videoCheckedAt))
      .limit(limit)
    for (const r of rows) if (r.url) all.push({ kind, id: r.id, name: r.name, url: r.url, source: r.source, altUrl: r.altUrl, checkedAt: r.checkedAt })
  }
  return all.sort((a, b) => (a.checkedAt ?? 0) - (b.checkedAt ?? 0)).slice(0, limit)
}

export interface LinkCheckResult { checked: number; dead: number; reviews: number }

/**
 * One night's check. `sleep` spaces the calls (YouTube answers 429 to bursts);
 * the tests pass a no-op and a stand-in fetcher, so no network is used there.
 */
export async function runLinkCheck(db: DB, fetcher: Fetcher, nowSec: number, opts: { limit?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<LinkCheckResult> {
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const due = await dueLinks(db, nowSec, opts.limit ?? LINKS_PER_RUN)
  let dead = 0
  let reviews = 0
  for (const [i, d] of due.entries()) {
    if (i > 0) await sleep(1000)
    const status: VideoStatus = await checkLink(d.url, fetcher)
    const t = TABLES[d.kind]
    const set: Record<string, unknown> = { videoStatus: status, videoCheckedAt: nowSec }
    if (status === 'dead') {
      dead++
      let altStatus: VideoStatus | null = null
      if (d.altUrl) { await sleep(1000); altStatus = await checkLink(d.altUrl, fetcher); set.altVideoStatus = altStatus }
      // the replacement to approve: the backup if it is live, else a search from the same coach
      const proposal = d.altUrl && altStatus === 'live' ? d.altUrl : `search: ${searchUrl(d.name, d.source)}`
      const res = await db.insert(videoReviews).values({
        id: crypto.randomUUID(), itemKind: d.kind, itemId: d.id, url: d.url, foundDeadAt: nowSec, proposal, status: 'proposed', createdAt: nowSec,
      }).onConflictDoNothing().returning({ id: videoReviews.id })
      reviews += res.length
    }
    await db.update(t).set(set).where(eq(t.id, d.id))
  }
  if (dead > 0) console.log(`[links] ${dead} dead of ${due.length} checked; ${reviews} new replacement(s) proposed for review`)
  return { checked: due.length, dead, reviews }
}

/** What waits for Josh's OK. */
export async function pendingReviews(db: DB) {
  return db.select().from(videoReviews).where(eq(videoReviews.status, 'proposed'))
}
