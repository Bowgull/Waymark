import { useEffect, useState } from 'react'

import { glowRow, showPop } from '@/design'
import { ApiError, apiFetch } from '@/lib/api'
import type { EngineState } from '@/lib/sessionResume'
import { setWorldBackdrop } from '@/world/worldStore'

import { MtClassLogCard } from '@/features/blockZero/ClassTypeCard'
import { clampClassMinutes, classLogPatch, defaultClassType, type ClassTypeValue } from '@/features/blockZero/classType'

interface MtLog {
  id: string
  classType: string | null
  durationMin?: number | null
  focusSkill: string | null
  weakness: string | null
  concept: string | null
  actionItems: string | null
}

interface MtClassLogViewProps {
  mtLog: MtLog
  /** Planned class length in minutes: the stepper's start. */
  plannedMin?: number | null
  /** Block Zero ramp weeks refuse 'general', so the default there is technical. */
  blockType?: string | null
  onComplete: () => void
  onExit?: () => void
  /** Unsaved form (session resume). */
  resume?: Extract<EngineState, { kind: 'mt' }> | null
  /** Called on every change so a reload keeps what was typed. */
  onPersist?: (state: Extract<EngineState, { kind: 'mt' }>) => void
}

/** The server's refusal line, if the body carries one. */
function refusalReason(err: unknown): string | null {
  const body = err instanceof ApiError ? err.body : ''
  try { return (JSON.parse(body) as { reason?: string }).reason ?? null } catch { return null }
}

const COULDNT_SAVE = "Couldn't save. Check your connection."

/**
 * The post-class log (page 31, "MT Class Log"): type, length, one note, as one
 * centred board over the forest. In Block Zero a tapped type is saved at once,
 * so a refusal (sparring, clinch too early, the weekly cap) shows on its chip.
 */
export function MtClassLogView({ mtLog, plannedMin, blockType, onComplete, onExit, resume, onPersist }: MtClassLogViewProps) {
  const draft = resume?.draft ?? {}
  const blockZero = blockType === 'block_zero'
  const [classType, setClassType] = useState<ClassTypeValue>(() => defaultClassType(draft.classType ?? mtLog.classType, blockZero))
  // Class minutes drive the session load (minutes x RPE), so the class length is sent, not the time on this screen.
  const [minutes, setMinutes] = useState(() => clampClassMinutes(Number(draft.durationMin ?? mtLog.durationMin ?? plannedMin ?? 60)))
  const [note, setNote] = useState(draft.weakness ?? mtLog.weakness ?? '')
  const [refused, setRefused] = useState<{ type: ClassTypeValue; reason: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Page 31 draws this board over the forest.
  useEffect(() => {
    setWorldBackdrop('clearing')
    return () => setWorldBackdrop(null)
  }, [])

  useEffect(() => {
    onPersist?.({ kind: 'mt', draft: { classType, durationMin: String(minutes), weakness: note } })
  }, [onPersist, classType, minutes, note])

  async function pickType(type: ClassTypeValue, chips: HTMLElement | null) {
    const before = classType
    setClassType(type)
    setRefused(null)
    if (!blockZero) return
    try {
      await apiFetch(`/api/mt-class-logs/${mtLog.id}`, { method: 'PATCH', body: JSON.stringify({ classType: type }) })
    } catch (err) {
      const reason = refusalReason(err)
      if (!reason) return // offline: SAVE CLASS LOG says so
      // The refused chip stays clay with its line; the lit pick goes back to what was allowed.
      setClassType(before)
      setRefused({ type, reason })
      glowRow(chips, 'bad')
      showPop(reason, 'bad', { title: 'NOT TODAY', durationMs: 4000 })
    }
  }

  async function save(button: HTMLElement | null) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/api/mt-class-logs/${mtLog.id}`, { method: 'PATCH', body: JSON.stringify(classLogPatch({ classType, minutes, note })) })
      onComplete()
    } catch (err) {
      console.error('Failed to save MT class log:', err)
      const reason = refusalReason(err)
      if (reason) {
        setRefused({ type: classType, reason })
        showPop(reason, 'bad', { title: 'NOT TODAY', durationMs: 4000 })
      } else {
        setError(COULDNT_SAVE)
        showPop(COULDNT_SAVE, 'bad')
      }
      glowRow(button, 'bad')
      setSaving(false)
    }
  }

  return (
    <MtClassLogCard
      classType={classType}
      minutes={minutes}
      note={note}
      refused={refused}
      error={error}
      saving={saving}
      onType={(t, chips) => void pickType(t, chips)}
      onMinutes={setMinutes}
      onNote={setNote}
      onSave={b => void save(b)}
      onClose={onExit}
    />
  )
}
