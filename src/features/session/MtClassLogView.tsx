import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ApiError, apiFetch } from '@/lib/api'
import type { EngineState } from '@/lib/sessionResume'

import { resolveMtClassMoment, type MtClassType } from './mtClassMicrocopy'
import { SessionShell } from './SessionShell'

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
  /** Planned class length in minutes: the field's default. */
  plannedMin?: number | null
  /** Block Zero ramp weeks refuse 'general', so the default there is technique. */
  blockType?: string | null
  onComplete: () => void
  onExit?: () => void
  /** Unsaved form (session resume). */
  resume?: Extract<EngineState, { kind: 'mt' }> | null
  /** Called on every change so a reload keeps what was typed. */
  onPersist?: (state: Extract<EngineState, { kind: 'mt' }>) => void
}

const CLASS_TYPES: MtClassType[] = [
  'technical',
  'sparring',
  'padwork',
  'clinch',
  'general',
]

const ACCENT = '#4ACAAA'

export function MtClassLogView({
  mtLog,
  plannedMin,
  blockType,
  onComplete,
  onExit,
  resume,
  onPersist,
}: MtClassLogViewProps) {
  const draft = resume?.draft ?? {}
  const [classType, setClassType] = useState<MtClassType>(
    (draft.classType as MtClassType | undefined) ?? (mtLog.classType as MtClassType) ?? (blockType === 'block_zero' ? 'technical' : 'general'),
  )
  // Class minutes drive the session load (minutes x RPE), so the class length
  // is sent, not the time spent on this screen.
  const [durationMin, setDurationMin] = useState(draft.durationMin ?? String(mtLog.durationMin ?? plannedMin ?? 60))
  const [error, setError] = useState<string | null>(null)
  const [focusSkill, setFocusSkill] = useState(draft.focusSkill ?? mtLog.focusSkill ?? '')
  const [weakness, setWeakness] = useState(draft.weakness ?? mtLog.weakness ?? '')
  const [concept, setConcept] = useState(draft.concept ?? mtLog.concept ?? '')
  const [actionItems, setActionItems] = useState(draft.actionItems ?? mtLog.actionItems ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    onPersist?.({ kind: 'mt', draft: { classType, durationMin, focusSkill, weakness, concept, actionItems } })
  }, [onPersist, classType, durationMin, focusSkill, weakness, concept, actionItems])

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    const minutes = parseInt(durationMin, 10)
    try {
      await apiFetch(`/api/mt-class-logs/${mtLog.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          classType,
          ...(Number.isFinite(minutes) && minutes >= 1 && minutes <= 300 ? { durationMin: minutes } : {}),
          focusSkill: focusSkill || undefined,
          weakness: weakness || undefined,
          concept: concept || undefined,
          actionItems: actionItems || undefined,
        }),
      })
      onComplete()
    } catch (err) {
      console.error('Failed to save MT class log:', err)
      // The Block Zero ramp refuses some class types with a reason; show it.
      const body = err instanceof ApiError ? err.body : ''
      let reason: string | null = null
      try { reason = (JSON.parse(body) as { reason?: string; error?: string }).reason ?? null } catch { reason = null }
      setError(reason ?? "Couldn't save. Check connection and try again.")
      setSaving(false)
    }
  }

  const moment = resolveMtClassMoment({
    phase: saving ? 'saving' : 'logging',
    classType,
  })

  // Simple single-step progress — one dot filled on save
  const progress = {
    completed: 0,
    active: 0,
    total: 1,
  }

  const body = (
    <form
      id="mt-class-log-form"
      onSubmit={handleSave}
      className="mx-auto max-w-md animate-fade-in space-y-5"
    >
      <div>
        <h2 className="text-display-lg leading-[1.1] text-foreground">
          MT Class Log
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">
          Record what you worked on and what to improve.
        </p>
      </div>

      <div>
        <label className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
          Class Type
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {CLASS_TYPES.map((t) => {
            const active = classType === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => setClassType(t)}
                className="min-h-[44px] rounded-md border px-3 py-2 text-xs font-medium capitalize transition-colors"
                style={{
                  backgroundColor: active ? ACCENT : 'transparent',
                  borderColor: active ? ACCENT : 'rgba(232,200,96,0.15)',
                  color: active ? '#020A08' : 'var(--color-muted-foreground)',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
          Class Length (min)
        </label>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={300}
          value={durationMin}
          onChange={(e) => setDurationMin(e.target.value)}
          className="mt-2 min-h-[44px] w-full rounded-md border border-gold/15 bg-deep-forest/60 px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
        />
      </div>

      <div>
        <label className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
          Focus / Skill
        </label>
        <input
          type="text"
          value={focusSkill}
          onChange={(e) => setFocusSkill(e.target.value)}
          placeholder="e.g. Defense, teep timing"
          className="mt-2 min-h-[44px] w-full rounded-md border border-gold/15 bg-deep-forest/60 px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
        />
      </div>

      <div>
        <label className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
          Weakness / Struggle
        </label>
        <input
          type="text"
          value={weakness}
          onChange={(e) => setWeakness(e.target.value)}
          placeholder="e.g. Guard dropping after combos"
          className="mt-2 min-h-[44px] w-full rounded-md border border-gold/15 bg-deep-forest/60 px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
        />
      </div>

      <div>
        <label className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
          Concept to Learn
        </label>
        <input
          type="text"
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="e.g. Hands up, check kicks"
          className="mt-2 min-h-[44px] w-full rounded-md border border-gold/15 bg-deep-forest/60 px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
        />
      </div>

      <div>
        <label className="font-cinzel text-[11px] uppercase tracking-[0.28em] text-gold/60">
          Action Items
        </label>
        <textarea
          value={actionItems}
          onChange={(e) => setActionItems(e.target.value)}
          rows={2}
          placeholder="e.g. Add guard reset to bag work combos"
          className="mt-2 min-h-[44px] w-full rounded-md border border-gold/15 bg-deep-forest/60 px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-[#C45A3C]">{error}</p>}
    </form>
  )

  const footer = (
    <Button
      type="submit"
      form="mt-class-log-form"
      disabled={saving}
      size="lg"
      className="w-full"
      style={{ backgroundColor: ACCENT, color: '#020A08' }}
    >
      {saving ? 'Saving...' : 'Save Class Log'}
    </Button>
  )

  return (
    <SessionShell
      sessionType="mt_class"
      counter="Post-Class"
      progress={progress}
      moment={moment}
      onExit={onExit}
      footer={footer}
    >
      {body}
    </SessionShell>
  )
}
