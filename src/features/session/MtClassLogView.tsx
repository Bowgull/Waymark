import { useEffect, useState } from 'react'

import { glowRow, showPop } from '@/design'
import { logger } from '@/lib/logger'
import { classLogWrite } from '@/lib/logWrites'
import { queueWrite } from '@/lib/outboxSync'
import type { EngineState } from '@/lib/sessionResume'
import { setWorldBackdrop } from '@/world/worldStore'

import { MtClassLogCard } from '@/features/blockZero/ClassTypeCard'
import { refreshBagLibrary } from './classCombosClient'
import { classLogPatch, defaultClassType, type ClassTypeValue } from '@/features/blockZero/classType'

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
  /** The session: the log goes out in order with its writes, before the finish. */
  sessionId?: string | null
  /** Planned class length (a fixed hour; kept for callers). */
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
export function MtClassLogView({ mtLog, sessionId = null, onComplete, onExit, resume, onPersist }: MtClassLogViewProps) {
  const draft = resume?.draft ?? {}
  const [classType, setClassType] = useState<ClassTypeValue>(() => defaultClassType(draft.classType ?? mtLog.classType))
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
    onPersist?.({ kind: 'mt', draft: { classType, weakness: note } })
  }, [onPersist, classType, note])

  async function save(button: HTMLElement | null) {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      // Through the outbox: with no signal it is kept on this phone and the session goes on.
      const result = await queueWrite(classLogWrite(mtLog.id, sessionId, classLogPatch({ classType, note })))
      if (result === 'rejected') throw new Error('class log refused by the server')
      if (result === 'queued') {
        logger.warn('session', 'mt class log queued', { mtLogId: mtLog.id }, 'Class log save failed. Kept on this phone, retrying.')
        showPop("No connection. Class log saved on this phone. It syncs when you're back online.", 'info')
      }
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
      note={note}
      error={error}
      saving={saving}
      onType={t => setClassType(t)}
      onNote={setNote}
      onSave={b => void save(b)}
      onClose={onExit}
    />
  )
}
