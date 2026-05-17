import { useState } from 'react'
import { getMarkAsset } from '@/lib/markAssets'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import { TRAINING_TARGETS } from '@/lib/trainingTargets'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { mediumHaptic, selectHaptic } from '@/lib/haptics'

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
  title?: string
  subtitle?: string
}

export type { SessionOption }

export function SessionPicker({ onSelect, onClose, filter, suggestions, title, subtitle }: SessionPickerProps) {
  const baseOptions = filter ? SESSION_OPTIONS.filter(filter) : SESSION_OPTIONS

  if (suggestions && suggestions.suggestions.length > 0) {
    return (
      <SuggestedPicker
        baseOptions={baseOptions}
        suggestions={suggestions}
        onSelect={onSelect}
        onClose={onClose}
        title={title}
        subtitle={subtitle}
      />
    )
  }

  return (
    <PickerShell onClose={onClose} title={title} subtitle={subtitle}>
      <div className="flex flex-col gap-0.5">
        {baseOptions.map((opt, i) => (
          <FlexibleSessionRow key={i} opt={opt} onSelect={onSelect} />
        ))}
      </div>
    </PickerShell>
  )
}

// ─── Suggested Picker ───────────────────────────────────────────

function SuggestedPicker({ baseOptions, suggestions, onSelect, onClose, title, subtitle }: {
  baseOptions: (SessionOption & { flexibleTimeSlot: boolean })[]
  suggestions: SuggestionsResponse
  onSelect: (option: SessionOption) => void
  onClose: () => void
  title?: string
  subtitle?: string
}) {
  const baseKeys = new Set(baseOptions.map(optionKey))

  const annotated = suggestions.suggestions
    .filter(suggestion => baseKeys.has(optionKey(suggestion)))
    .map(suggestion => {
      const base = baseOptions.find(opt => optionKey(opt) === optionKey(suggestion))
      return {
        type: suggestion.type,
        label: suggestion.label,
        timeSlot: suggestion.timeSlot,
        runCategory: suggestion.runCategory,
        flexibleTimeSlot: suggestion.flexibleTimeSlot ?? base?.flexibleTimeSlot ?? false,
        priority: suggestion.priority,
        reason: suggestion.reason ?? null,
      }
    })

  if (annotated.length === 0) {
    const fallback = baseOptions.map(opt => ({
      ...opt,
      priority: 'neutral' as const,
      reason: null,
    }))
    return (
      <PickerShell onClose={onClose} flags={suggestions.flags} title={title} subtitle={subtitle}>
        <div className="flex flex-col gap-0.5">
          {fallback.map((opt, i) => (
            <FlexibleSessionRow key={`f-${i}`} opt={opt} onSelect={onSelect} />
          ))}
        </div>
      </PickerShell>
    )
  }

  const suggested = annotated.filter(a => a.priority === 'suggested')
  const rest = annotated.filter(a => a.priority !== 'suggested')
  const { flags } = suggestions

  return (
    <PickerShell onClose={onClose} flags={flags} title={title} subtitle={subtitle}>
      <div className="flex flex-col gap-0.5">
        {suggested.length > 0 && (
          <>
            <p className="px-3 pb-1 font-cinzel text-[13px] font-medium uppercase tracking-[0.2em] text-gold/40">Coach Picks</p>
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

function optionKey(opt: { type: string; runCategory?: string }): string {
  return opt.runCategory ? `${opt.type}:${opt.runCategory}` : opt.type
}

// ─── Picker Shell ───────────────────────────────────────────────

function PickerShell({ children, onClose, flags, title, subtitle }: { children: React.ReactNode; onClose: () => void; flags?: string[]; title?: string; subtitle?: string }) {
  const heading = title ?? 'Add Session'
  return (
    <BottomSheet open onClose={onClose} ariaLabel={heading}>
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <p className="font-cinzel text-display-sm text-foreground">{heading}</p>
          <button onClick={onClose} className="min-h-[44px] px-3 text-muted-foreground/60 text-xs uppercase tracking-wider active:text-muted-foreground">Cancel</button>
        </div>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground/70">{subtitle}</p>
        )}
        {flags && flags.length > 0 && (
          <p className="mt-1 text-xs text-gold/50">{flags.join(' · ')}</p>
        )}
      </div>
      {children}
    </BottomSheet>
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
    mediumHaptic()
    onSelect({ type: opt.type, label: opt.label, timeSlot, runCategory: opt.runCategory })
  }

  function handleSlot(slot: 'am' | 'pm') {
    selectHaptic()
    setTimeSlot(slot)
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
            onClick={(e) => { e.stopPropagation(); handleSlot('am') }}
            className={`rounded-l-full px-2 py-0.5 transition-colors cursor-pointer ${timeSlot === 'am' ? 'bg-gold/15 text-gold/80' : 'text-muted-foreground/30'}`}
          >AM</span>
          <span
            onClick={(e) => { e.stopPropagation(); handleSlot('pm') }}
            className={`rounded-r-full px-2 py-0.5 transition-colors cursor-pointer ${timeSlot === 'pm' ? 'bg-teal/15 text-teal/80' : 'text-muted-foreground/30'}`}
          >PM</span>
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground/40 uppercase tracking-wider">{opt.timeSlot}</span>
      )}
    </button>
  )
}
