import { useState } from 'react'

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
    <div className="space-y-5">
      <div>
        <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">Post-Class</p>
        <h2 className="text-2xl font-bold text-zinc-100">MT Class Log</h2>
        <p className="mt-1 text-sm text-zinc-400">Record what you worked on and what to improve.</p>
      </div>

      {/* Class type */}
      <div>
        <label className="mb-2 block text-xs text-zinc-500">Class Type</label>
        <div className="flex flex-wrap gap-2">
          {CLASS_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setClassType(t)}
              className={`rounded-lg px-3 py-2 text-xs font-medium capitalize ${
                classType === t
                  ? 'bg-[#4ACAAA] text-zinc-950'
                  : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Focus / Skill */}
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Focus / Skill</label>
        <input
          type="text"
          value={focusSkill}
          onChange={(e) => setFocusSkill(e.target.value)}
          placeholder="e.g. Defense, teep timing"
          className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-[#4ACAAA] focus:outline-none"
        />
      </div>

      {/* Weakness */}
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Weakness / Struggle</label>
        <input
          type="text"
          value={weakness}
          onChange={(e) => setWeakness(e.target.value)}
          placeholder="e.g. Guard dropping after combos"
          className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-[#4ACAAA] focus:outline-none"
        />
      </div>

      {/* Concept to learn */}
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Concept to Learn</label>
        <input
          type="text"
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="e.g. Hands up, check kicks"
          className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-[#4ACAAA] focus:outline-none"
        />
      </div>

      {/* Action items */}
      <div>
        <label className="mb-1 block text-xs text-zinc-500">Action Items</label>
        <textarea
          value={actionItems}
          onChange={(e) => setActionItems(e.target.value)}
          rows={2}
          placeholder="e.g. Add guard reset to bag work combos"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-[#4ACAAA] focus:outline-none"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="min-h-[48px] w-full rounded-xl bg-[#E8C860] py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030] disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Class Log'}
      </button>
    </div>
  )
}
