// UNDO (page 56 items 8-10, approved 2026-10-19). One tap, no "are you
// sure", until the session starts. Pure: given the change, the week's other
// changes and the sessions as they are now, the plan of writes that puts it
// back. The server applies the plan (POST /api/changes/:id/undo).
//
// - A change restores only its own fields and context keys, field by field.
// - A later change that wrote the same field of the same session (or touched
//   a session this change created) goes first: both come back (spec §4.4).
// - Undoing his own change also puts back what the coach did because of it
//   (the rest of its change set), when those can still be undone.
// - Undoing a coach change holds the session: the coach leaves it as he set
//   it for the rest of the week (rebalance and the weekly pass skip it).
// - Done is done: a started or logged session, or a passed day, can't be undone.

import {
  changeLock,
  isCoachActor,
  touchedSessions,
  writtenKeys,
  type ChangeEffect,
  type ChangeLock,
  type ChangeRowLike,
  type SessionFields,
  type SessionNow,
} from './changes'

export interface SessionRestore {
  id: string
  f: SessionFields
  /** Context keys to put back (null deletes the key). */
  ctx: Record<string, unknown>
}

export interface UndoStep {
  changeId: string
  /** Session fields and context keys to put back. */
  restore: SessionRestore[]
  /** Sessions the change created: removed. */
  remove: string[]
  /** Effects outside the sessions table, put back as they were before. */
  effects: ChangeEffect[]
  /** A coach change he undid: the coach holds the session this week. */
  hold: boolean
}

export type UndoPlan =
  | { ok: true; steps: UndoStep[] }
  | { ok: false; lock: Exclude<ChangeLock, 'open'> }

/** The plan that puts one change back, newest first. */
function stepFor(c: ChangeRowLike, held: boolean): UndoStep {
  const restore: SessionRestore[] = []
  const created = new Set(c.after.created ?? [])
  for (const a of c.after.sessions) {
    if (created.has(a.id)) continue
    const b = c.before.sessions.find(s => s.id === a.id)
    if (!b) continue
    const f: SessionFields = {}
    for (const k of Object.keys(a.f) as Array<keyof SessionFields>) (f as Record<string, unknown>)[k] = (b.f as Record<string, unknown>)[k] ?? null
    const ctx: Record<string, unknown> = {}
    for (const k of Object.keys(a.ctx ?? {})) ctx[k] = b.ctx?.[k] ?? null
    restore.push({ id: a.id, f, ctx })
  }
  const effects: ChangeEffect[] = (c.before.effects ?? []).map(e => e)
  return { changeId: c.id, restore, remove: [...created], effects, hold: held }
}

function collides(later: ChangeRowLike, c: ChangeRowLike): boolean {
  const mine = writtenKeys(c)
  const created = new Set(c.after.created ?? [])
  for (const k of writtenKeys(later)) {
    if (mine.has(k)) return true
    const [, id] = k.split('@')
    if (created.has(id)) return true
  }
  // A later change on a session this change created is about that session.
  return touchedSessions(later).some(id => created.has(id))
}

/**
 * Plan the undo of `target`. `all` is every change of the week (the target
 * included); `sessions` the sessions they touch, as they are now.
 */
export function planUndo(target: ChangeRowLike, all: ReadonlyArray<ChangeRowLike>, sessions: ReadonlyMap<string, SessionNow>, todayDay: number): UndoPlan {
  const lock = changeLock(target, sessions, todayDay)
  if (lock !== 'open') return { ok: false, lock }

  const steps: UndoStep[] = []
  const done = new Set<string>()
  const live = all.filter(c => c.undoneAt == null)

  const visit = (c: ChangeRowLike, hold: boolean) => {
    if (done.has(c.id)) return
    done.add(c.id)
    // Later changes that wrote over this one come back first (newest first).
    const later = live
      .filter(o => o.id !== c.id && !done.has(o.id) && (o.createdAt > c.createdAt || (o.createdAt === c.createdAt && o.id > c.id)) && collides(o, c))
      .sort((a, b) => b.createdAt - a.createdAt)
    for (const o of later) {
      if (changeLock(o, sessions, todayDay) !== 'open') continue
      visit(o, false)
    }
    steps.push(stepFor(c, hold))
  }

  // His own change: what the coach did because of it comes back first.
  if (!isCoachActor(target.actor) && target.changeSetId) {
    const caused = live
      .filter(o => o.id !== target.id && o.changeSetId === target.changeSetId && isCoachActor(o.actor))
      .sort((a, b) => b.createdAt - a.createdAt)
    for (const o of caused) if (changeLock(o, sessions, todayDay) === 'open') visit(o, false)
  }
  visit(target, isCoachActor(target.actor))
  return { ok: true, steps }
}

/** Sessions the coach leaves alone this week: those of coach changes he undid. */
export function heldSessionIds(changes: ReadonlyArray<Pick<ChangeRowLike, 'held' | 'targetSessionId' | 'before' | 'after'>>): Set<string> {
  const out = new Set<string>()
  for (const c of changes) {
    if (!c.held) continue
    if (c.targetSessionId) out.add(c.targetSessionId)
    for (const id of touchedSessions(c)) out.add(id)
  }
  return out
}
