import { useEffect, useState } from 'react'

import { glowRow, showPop } from '@/design'
import { apiFetch } from '@/lib/api'
import type { EngineState } from '@/lib/sessionResume'
import { setWorldBackdrop } from '@/world/worldStore'

import { MtClassLogCard } from '@/features/blockZero/ClassTypeCard'
import { refreshBagLibrary } from './classCombosClient'
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
  /** The block (kept for callers; the class type is never refused). */
  blockType?: string | null
  onComplete: () => void
  onExit?: () => void
  /** Unsaved form (session resume). */
  resume?: Extract<EngineState, { kind: 'mt' }> | null
  /** Called on every change so a reload keeps what was typed. */
  onPersist?: (state: Extract<EngineState, { kind: 'mt' }>) => void
}

const COULDNT_SAVE = "Couldn't save. Check your connection."

/**
 * The post-class log (page 31, "MT Class Log"): type, length, one note, as one
 * centred board over the forest. Everything is saved with SAVE CLASS LOG; the
 * type is his record of the class, never refused (coach-brain §14).
 */
export function MtClassLogView({ mtLog, plannedMin, onComplete, onExit, resume, onPersist }: MtClassLogViewProps) {
  const draft = resume?.draft ?? {}
  const [classType, setClassType] = useState<ClassTypeValue>(() => defaultClassType(draft.classType ?? mtLog.classType))
  // Class minutes drive the session load (minutes x RPE), so the class length is sent, not the time on this screen.
  const [minutes, setMinutes] = useState(() => clampClassMinutes(Number(draft.durationMin ?? mtLog.durationMin ?? plannedMin ?? 60)))
  const [note, setNote] = useState(draft.weakness ?? mtLog.weakness ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // A copy of the bag on the phone, so "What you learned" can check combos with no connection.
  useEffect(() => { void refreshBagLibrary() }, [])

  // Page 31 draws this board over the forest.
  useEffect(() => {
    setWorldBackdrop('clearing')
    return () => setWorldBackdrop(null)
  }, [])

  useEffect(() => {
    onPersist?.({ kind: 'mt', draft: { classType, durationMin: String(minutes), weakness: note } })
  }, [onPersist, classType, minutes, note])

  async function save(button: HTMLElement | null) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/api/mt-class-logs/${mtLog.id}`, { method: 'PATCH', body: JSON.stringify(classLogPatch({ classType, minutes, note })) })
      onComplete()
    } catch (err) {
      console.error('Failed to save MT class log:', err)
      setError(COULDNT_SAVE)
      showPop(COULDNT_SAVE, 'bad')
      glowRow(button, 'bad')
      setSaving(false)
    }
  }

  return (
    <MtClassLogCard
      classType={classType}
      minutes={minutes}
      note={note}
      error={error}
      saving={saving}
      onType={t => setClassType(t)}
      onMinutes={setMinutes}
      onNote={setNote}
      onSave={b => void save(b)}
      onClose={onExit}
    />
  )
}
