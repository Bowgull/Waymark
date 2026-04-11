import { useState } from 'react'

interface WeeklyJournalCardProps {
  onSubmit: (reflection: string) => void
  existingReflection?: string | null
}

export function WeeklyJournalCard({ onSubmit, existingReflection }: WeeklyJournalCardProps) {
  const [reflection, setReflection] = useState(existingReflection ?? '')
  const [saved, setSaved] = useState(!!existingReflection)
  const [submitting, setSubmitting] = useState(false)

  function handleSubmit() {
    if (!reflection.trim()) return
    setSubmitting(true)
    onSubmit(reflection)
    setSaved(true)
    setSubmitting(false)
  }

  if (saved) {
    return (
      <div className="mb-4 rounded-xl border border-zinc-800 border-l-4 border-l-[#E8C860] bg-zinc-900 p-4">
        <p className="text-sm text-[#E8C860]">Weekly journal saved.</p>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 border-l-4 border-l-[#E8C860] bg-zinc-900 p-4">
      <p className="mb-1 text-sm font-medium text-zinc-300">Weekly Reflection</p>
      <p className="mb-3 text-xs text-zinc-500">
        How was your week? What went well? What needs work?
      </p>
      <textarea
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        rows={4}
        placeholder="Write your thoughts..."
        className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-[#E8C860] focus:outline-none"
      />
      <button
        onClick={handleSubmit}
        disabled={submitting || !reflection.trim()}
        className="min-h-[44px] w-full rounded-lg bg-[#E8C860] py-2 text-sm font-semibold text-zinc-950 active:bg-[#C8A030] disabled:opacity-40"
      >
        Save Reflection
      </button>
    </div>
  )
}
