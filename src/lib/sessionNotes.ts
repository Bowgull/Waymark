// The notes column on a session holds two kinds of text: system tags (a
// run's category, "zone2" / "progression", which prescriptions and icons
// read) and the athlete's own words. Finishing a session must never wipe
// either (D12). The athlete's words also live in context_json.userNotes so
// the injury rule can read them apart from the tags. Pure.

const RUN_TAGS: ReadonlySet<string> = new Set(['zone2', 'progression'])

export function isRunTag(notes: string | null | undefined): boolean {
  return notes != null && RUN_TAGS.has(notes)
}

/**
 * What a finish writes. The notes column keeps a run tag; otherwise it takes
 * the athlete's note when one was written, else keeps what was there (an
 * empty note never wipes). `userNotes` is set only when a note was written.
 */
export function notesOnComplete(existing: string | null | undefined, written: string | null | undefined): { notes: string | null; userNotes: string | null } {
  const userNotes = typeof written === 'string' && written.trim() ? written : null
  if (isRunTag(existing)) return { notes: existing ?? null, userNotes }
  return { notes: userNotes ?? existing ?? null, userNotes }
}

/**
 * The athlete's own words on a finished session: context_json.userNotes when
 * stored, else the notes column minus a run tag.
 */
export function userNotesFrom(s: { notes: string | null; contextJson: string | null }): string | null {
  try {
    const ctx = s.contextJson ? (JSON.parse(s.contextJson) as { userNotes?: unknown }) : {}
    if (typeof ctx.userNotes === 'string' && ctx.userNotes.trim()) return ctx.userNotes
  } catch { /* fall through to the column */ }
  const n = (s.notes ?? '').trim()
  return n && !isRunTag(n) ? n : null
}
