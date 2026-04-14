import { useState } from 'react'
import { getMarkAsset } from '@/lib/markAssets'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import { TRAINING_TARGETS } from '@/lib/trainingTargets'

interface SessionOption {
  type: string
  label: string
  timeSlot: 'am' | 'pm'
  runCategory?: string
}

// Build options from training targets (single source of truth)
const SESSION_OPTIONS: (SessionOption & { flexibleTimeSlot: boolean })[] = TRAINING_TARGETS
  .filter(t => t.type !== 'mt_class')
  .map(t => ({
    type: t.type,
    label: t.label,
    timeSlot: t.defaultTimeSlot,
    flexibleTimeSlot: t.flexibleTimeSlot,
    runCategory: t.runCategory,
  }))

interface SessionPickerProps {
  onSelect: (option: SessionOption) => void
  onClose: () => void
  filter?: (option: SessionOption) => boolean
  suggestions?: SuggestionsResponse | null
}

export type { SessionOption }

export function SessionPicker({ onSelect, onClose, filter, suggestions }: SessionPickerProps) {
  const baseOptions = filter ? SESSION_OPTIONS.filter(filter) : SESSION_OPTIONS

  if (suggestions && suggestions.suggestions.length > 0) {
    return (
      <SuggestedPicker
        baseOptions={baseOptions}
        suggestions={suggestions}
        onSelect={onSelect}
        onClose={onClose}
      />
    )
  }

  return (
    <PickerShell onClose={onClose}>
      <div className="flex flex-col gap-0.5">
        {baseOptions.map((opt, i) => (
          <FlexibleSessionRow key={i} opt={opt} onSelect={onSelect} />
        ))}
      </div>
    </PickerShell>
  )
}

// ─── Suggested Picker ───────────────────────────────────────────

function SuggestedPicker({ baseOptions, suggestions, onSelect, onClose }: {
  baseOptions: (SessionOption & { flexibleTimeSlot: boolean })[]
  suggestions: SuggestionsResponse
  onSelect: (option: SessionOption) => void
  onClose: () => void
}) {
  const suggestionMap = new Map(
    suggestions.suggestions.map(s => [s.runCategory ? `${s.type}:${s.runCategory}` : s.type, s])
  )

  const annotated = baseOptions.map(opt => {
    const key = opt.runCategory ? `${opt.type}:${opt.runCategory}` : opt.type
    const suggestion = suggestionMap.get(key)
    return {
      ...opt,
      flexibleTimeSlot: suggestion?.flexibleTimeSlot ?? opt.flexibleTimeSlot,
      priority: suggestion?.priority ?? 'neutral' as const,
      reason: suggestion?.reason ?? null,
    }
  })

  const suggested = annotated.filter(a => a.priority === 'suggested')
  const rest = annotated.filter(a => a.priority !== 'suggested')
  const { flags } = suggestions

  return (
    <PickerShell onClose={onClose} flags={flags}>
      <div className="flex flex-col gap-0.5">
        {suggested.length > 0 && (
          <>
            <p className="px-3 pb-1 font-cinzel text-[12px] font-medium uppercase tracking-[0.2em] text-gold/40">Suggested</p>
            {suggested.map((opt, i) => (
              <FlexibleSessionRow
                key={`s-${i}`}
                opt={opt}
                onSelect={onSelect}
                reason={opt.reason}
                accent="gold"
              />
            ))}
            {rest.length > 0 && (
              <div className="my-1.5 h-px bg-border/30" />
            )}
          </>
        )}

        {rest.map((opt, i) => (
          <FlexibleSessionRow
            key={`r-${i}`}
            opt={opt}
            onSelect={onSelect}
            reason={opt.priority === 'caution' ? opt.reason : null}
            accent={opt.priority === 'caution' ? 'amber' : undefined}
          />
        ))}
      </div>
    </PickerShell>
  )
}

// ─── Picker Shell ───────────────────────────────────────────────

function PickerShell({ children, onClose, flags }: { children: React.ReactNode; onClose: () => void; flags?: string[] }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md rounded-t-xl border-t border-gold/10 bg-surface p-4 pb-8 animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with inline flags */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <p className="text-display-sm text-foreground">Add Session</p>
            <button onClick={onClose} className="text-muted-foreground/60 text-xs uppercase tracking-wider active:text-muted-foreground">Cancel</button>
          </div>
          {flags && flags.length > 0 && (
            <p className="mt-1 text-xs text-gold/50">{flags.join(' · ')}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Session Row ────────────────────────────────────────────────

function FlexibleSessionRow({ opt, onSelect, reason, accent }: {
  opt: SessionOption & { flexibleTimeSlot: boolean }
  onSelect: (option: SessionOption) => void
  reason?: string | null
  accent?: 'gold' | 'amber'
}) {
  const [timeSlot, setTimeSlot] = useState<'am' | 'pm'>(opt.timeSlot)
  const mark = getMarkAsset(opt.type)

  function handleSelect() {
    onSelect({ type: opt.type, label: opt.label, timeSlot, runCategory: opt.runCategory })
  }

  return (
    <button
      onClick={handleSelect}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left active:bg-border/30 transition-colors"
    >
      {accent === 'gold' && <span className="h-1 w-1 rounded-full bg-gold/80" />}
      {accent === 'amber' && <span className="h-1 w-1 rounded-full bg-amber-500/60" />}
      {!accent && <span className="h-1 w-1" />}
      <img src={mark.png} alt="" className="h-4 w-4 object-contain opacity-40" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-foreground">{opt.label}</span>
        {reason && <span className="block text-[13px] text-muted-foreground/50 leading-tight">{reason}</span>}
      </span>
      {opt.flexibleTimeSlot ? (
        <span
          className="flex rounded-full border border-border/50 text-[11px] uppercase tracking-wider"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            onClick={(e) => { e.stopPropagation(); setTimeSlot('am') }}
            className={`rounded-l-full px-2 py-0.5 transition-colors cursor-pointer ${timeSlot === 'am' ? 'bg-gold/15 text-gold/80' : 'text-muted-foreground/30'}`}
          >AM</span>
          <span
            onClick={(e) => { e.stopPropagation(); setTimeSlot('pm') }}
            className={`rounded-r-full px-2 py-0.5 transition-colors cursor-pointer ${timeSlot === 'pm' ? 'bg-teal/15 text-teal/80' : 'text-muted-foreground/30'}`}
          >PM</span>
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground/40 uppercase tracking-wider">{opt.timeSlot}</span>
      )}
    </button>
  )
}
