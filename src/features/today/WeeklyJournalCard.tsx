import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface WeeklyJournalCardProps {
  onSubmit: (reflection: string) => void
  existingReflection?: string | null
}

function JournalLines({ content }: { content: string }) {
  const lines = content.split('\n').filter((l) => l.trim())
  return (
    <div className="space-y-2">
      {lines.map((line, i) => (
        <p key={i} className="font-[Cinzel] text-sm leading-relaxed text-foreground">
          <span className="text-gold/60">· </span>
          {line}
        </p>
      ))}
    </div>
  )
}

export function WeeklyJournalCard({ onSubmit, existingReflection }: WeeklyJournalCardProps) {
  const [reflection, setReflection] = useState(existingReflection ?? '')
  const [saved, setSaved] = useState(!!existingReflection)
  const [editing, setEditing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function handleSubmit() {
    if (!reflection.trim()) return
    setSubmitting(true)
    onSubmit(reflection)
    setSaved(true)
    setEditing(false)
    setSubmitting(false)
  }

  const showEditor = !saved || editing

  return (
    <div className="rounded-xl border border-gold/10 border-t-gold/20 bg-near-black/50 p-4">
      <p className="text-display mb-1 text-gold">Weekly Debrief</p>

      {showEditor ? (
        <>
          <div className="mb-3 space-y-1">
            <p className="text-xs italic text-muted-foreground">What went well this week?</p>
            <p className="text-xs italic text-muted-foreground">What needs work?</p>
            <p className="text-xs italic text-muted-foreground">Your intention for next week?</p>
          </div>
          <textarea
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && reflection.trim() && !submitting) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            rows={5}
            placeholder="Reflect on your week... (Cmd+Enter to save)"
            className="mb-3 w-full rounded-md border border-gold/10 bg-deep-forest px-3 py-2 font-[Cinzel] text-base italic text-foreground placeholder-muted-foreground focus:border-gold/40 focus:outline-none"
          />
          <div className="flex gap-2">
            <Button
              onClick={handleSubmit}
              disabled={submitting || !reflection.trim()}
              className="flex-1"
            >
              Save Debrief
            </Button>
            {editing && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false)
                  setReflection(existingReflection ?? '')
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <JournalLines content={reflection} />
          <button
            onClick={() => setEditing(true)}
            className="mt-3 text-xs text-gold/50 hover:text-gold/80"
          >
            Edit
          </button>
        </>
      )}
    </div>
  )
}
