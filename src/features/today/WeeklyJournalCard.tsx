import { useState } from 'react'
import { Button } from '@/components/ui/button'

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
      <div className="mb-4 border border-gold/10 bg-near-black/50 p-4">
        <p className="text-sm text-gold">Weekly debrief saved.</p>
      </div>
    )
  }

  return (
    <div className="mb-4 border border-gold/10 border-t-gold/20 bg-near-black/50 p-4">
      <p className="text-display mb-1 text-gold">Weekly Debrief</p>
      <p className="mb-3 text-xs text-muted-foreground">
        How was your week? What went well? What needs work?
      </p>
      <textarea
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        rows={4}
        placeholder="Write your thoughts..."
        className="mb-3 w-full border border-gold/10 bg-deep-forest px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-gold/40 focus:outline-none"
      />
      <Button
        onClick={handleSubmit}
        disabled={submitting || !reflection.trim()}
        className="w-full"
      >
        Save Debrief
      </Button>
    </div>
  )
}
