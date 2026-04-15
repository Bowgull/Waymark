import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'

interface MtLog {
  id: string
  classType: string | null
  focusSkill: string | null
  weakness: string | null
  concept: string | null
  actionItems: string | null
}

interface MtClassLogViewProps {
  mtLog: MtLog
  onComplete: () => void
}

const CLASS_TYPES = ['technical', 'sparring', 'padwork', 'clinch', 'general']

export function MtClassLogView({ mtLog, onComplete }: MtClassLogViewProps) {
  const [classType, setClassType] = useState(mtLog.classType ?? 'general')
  const [focusSkill, setFocusSkill] = useState(mtLog.focusSkill ?? '')
  const [weakness, setWeakness] = useState(mtLog.weakness ?? '')
  const [concept, setConcept] = useState(mtLog.concept ?? '')
  const [actionItems, setActionItems] = useState(mtLog.actionItems ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await apiFetch(`/api/mt-class-logs/${mtLog.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          classType,
          focusSkill: focusSkill || undefined,
          weakness: weakness || undefined,
          concept: concept || undefined,
          actionItems: actionItems || undefined,
        }),
      })
      onComplete()
    } catch (e) {
      console.error('Failed to save MT class log:', e)
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <p className="text-label mb-1 text-muted-foreground">Post-Class</p>
        <h2 className="text-display-lg text-foreground">MT Class Log</h2>
        <p className="mt-1 text-sm text-muted-foreground">Record what you worked on and what to improve.</p>
      </div>

      <div>
        <label className="text-label mb-2 block text-muted-foreground">Class Type</label>
        <div className="flex flex-wrap gap-2">
          {CLASS_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setClassType(t)}
              className={`min-h-[44px] px-3 py-2 text-xs font-medium capitalize ${
                classType === t
                  ? 'bg-teal text-near-black'
                  : 'bg-surface-light text-muted-foreground active:bg-border'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-label mb-1 block text-muted-foreground">Focus / Skill</label>
        <input type="text" value={focusSkill} onChange={(e) => setFocusSkill(e.target.value)}
          placeholder="e.g. Defense, teep timing"
          className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
      </div>

      <div>
        <label className="text-label mb-1 block text-muted-foreground">Weakness / Struggle</label>
        <input type="text" value={weakness} onChange={(e) => setWeakness(e.target.value)}
          placeholder="e.g. Guard dropping after combos"
          className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
      </div>

      <div>
        <label className="text-label mb-1 block text-muted-foreground">Concept to Learn</label>
        <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)}
          placeholder="e.g. Hands up, check kicks"
          className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
      </div>

      <div>
        <label className="text-label mb-1 block text-muted-foreground">Action Items</label>
        <textarea value={actionItems} onChange={(e) => setActionItems(e.target.value)} rows={2}
          placeholder="e.g. Add guard reset to bag work combos"
          className="min-h-[44px] w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none" />
      </div>

      <Button onClick={handleSave} disabled={saving} size="lg" className="w-full">
        {saving ? 'Saving...' : 'Save Class Log'}
      </Button>
    </div>
  )
}
