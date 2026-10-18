import { useState, useRef, useEffect } from 'react'
import { Moon, Leaf, Wine, Activity } from 'lucide-react'
import { apiFetch, idempotencyHeaders } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import { Button } from '@/components/ui/button'
import { ScrollDrum } from '@/components/ui/ScrollDrum'
import { SlidingGauge } from '@/components/ui/SlidingGauge'

export interface WellnessData {
  sleepHours?: number
  weedGrams?: number
  alcoholScale?: number
  soreness?: number
  notes?: string
}

interface ExistingWellness {
  sleepHours?: number | null
  weedGrams?: number | null
  alcoholScale?: number | null
  soreness?: number | null
}

interface WellnessPromptCardProps {
  onSubmit: (data: WellnessData) => void
  isLogged?: boolean
  existing?: ExistingWellness | null
}

const SORENESS_LABELS = ['Fresh', 'Loose', 'Normal', 'Sore', 'Cooked']

export function WellnessPromptCard({ onSubmit, isLogged, existing }: WellnessPromptCardProps) {
  // Nothing is recorded unless the athlete touches it: an untouched field is
  // left out of the log (sleep stays empty, not a pre-filled 7 h).
  const [sleep, setSleepValue] = useState<number | null>(existing?.sleepHours ?? null)
  const [weed, setWeedValue] = useState(existing?.weedGrams ?? 0)
  const [alcohol, setAlcoholValue] = useState(existing?.alcoholScale ?? 0)
  const [soreness, setSorenessValue] = useState<number | null>(existing?.soreness ?? null)
  const [touched, setTouched] = useState<Set<keyof WellnessData>>(() => new Set())
  const touch = (field: keyof WellnessData) => setTouched(prev => (prev.has(field) ? prev : new Set(prev).add(field)))
  const setSleep = (v: number) => { touch('sleepHours'); setSleepValue(v) }
  const setWeed = (v: number) => { touch('weedGrams'); setWeedValue(v) }
  const setAlcohol = (v: number) => { touch('alcoholScale'); setAlcoholValue(v) }
  const setSoreness = (v: number | null) => { touch('soreness'); setSorenessValue(v) }
  const [notes, setNotes] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [collapsed, setCollapsed] = useState(!!isLogged)
  const [activeDrum, setActiveDrum] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)

  // Close drum on any pointerdown that lands outside the drum body
  useEffect(() => {
    if (!activeDrum) return
    function handleOutside(e: PointerEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-drum-body="true"]')) return
      setActiveDrum('')
    }
    document.addEventListener('pointerdown', handleOutside)
    return () => document.removeEventListener('pointerdown', handleOutside)
  }, [activeDrum])

  async function handleSubmit() {
    setSubmitting(true)
    // Save only the fields the athlete set this time.
    const data: WellnessData = {}
    if (touched.has('sleepHours') && sleep != null) data.sleepHours = sleep
    if (touched.has('weedGrams')) data.weedGrams = weed
    if (touched.has('alcoholScale')) data.alcoholScale = alcohol
    if (touched.has('soreness') && soreness != null) data.soreness = soreness
    if (Object.keys(data).length > 0) onSubmit(data)
    setTouched(new Set())
    // Save notes as a wellness journal entry if provided. A second note that
    // day is added to the first, not written over it.
    if (notes.trim()) {
      try {
        await apiFetch('/api/journal', {
          method: 'POST',
          headers: idempotencyHeaders(),
          body: JSON.stringify({ date: getTodayISO(), type: 'wellness', content: notes.trim(), append: true }),
        })
      } catch (e) {
        console.error('Failed to save wellness note:', e)
      }
    }
    setCollapsed(true)
    setNotes('')
    setShowNotes(false)
  }

  const hasAnyData = touched.size > 0 || notes.trim().length > 0

  function openDrum(name: string) {
    setActiveDrum(activeDrum === name ? '' : name)
  }

  if (collapsed) {
    return (
      <div className="rounded-xl border border-gold/10 border-t-gold/20 bg-near-black/50 p-4">
        <div className="flex items-center justify-between">
          <p className="text-display text-gold">Morning Report</p>
          <button
            onClick={() => { setCollapsed(false); setShowNotes(true) }}
            className="font-cinzel min-h-[44px] px-1 text-[11px] uppercase tracking-[0.2em] text-gold/60 active:text-gold"
          >
            + Add Note
          </button>
        </div>
        <p className="mt-1 text-xs text-gold/50 italic">Logged</p>
      </div>
    )
  }

  return (
    <div ref={cardRef} className="rounded-xl border border-gold/10 border-t-gold/20 bg-near-black/50 p-4">
      <p className="text-display mb-5 text-gold">
        Morning Report
      </p>

      {/* Ledger lines */}
      <div className="space-y-1">
        {/* Sleep */}
        <div className="flex items-center gap-3 py-2 border-b border-gold/[0.06]">
          <Moon className="h-4 w-4 text-gold/50 shrink-0" />
          <span className="text-sm text-foreground flex-1">Sleep</span>
          {activeDrum === 'sleep' ? (
            <div data-drum-body="true" className="w-24 rounded-md bg-deep-forest border border-gold/30 animate-fade-in">
              <ScrollDrum min={0} max={12} step={0.5} value={sleep ?? 7} onChange={setSleep} suffix="hrs" />
            </div>
          ) : (
            <button
              onClick={() => {
                // Opening the drum is the touch: it starts at 7 h, and that is what's logged.
                if (sleep == null) setSleep(7)
                openDrum('sleep')
              }}
              className="min-w-[64px] rounded-md border border-gold/10 bg-deep-forest px-3 py-1.5 text-center text-sm text-foreground"
            >
              {sleep ?? '—'} <span className="text-xs text-muted-foreground">hrs</span>
            </button>
          )}
        </div>

        {/* Weed */}
        <div className="flex items-center gap-3 py-2 border-b border-gold/[0.06]">
          <Leaf className="h-4 w-4 text-gold/50 shrink-0" />
          <span className="text-sm text-foreground flex-1">Herb</span>
          {activeDrum === 'weed' ? (
            <div data-drum-body="true" className="w-24 rounded-md bg-deep-forest border border-gold/30 animate-fade-in">
              <ScrollDrum min={0} max={10} step={0.5} value={weed} onChange={setWeed} suffix="g" />
            </div>
          ) : (
            <button
              onClick={() => openDrum('weed')}
              className="min-w-[64px] rounded-md border border-gold/10 bg-deep-forest px-3 py-1.5 text-center text-sm text-foreground"
            >
              {weed} <span className="text-xs text-muted-foreground">g</span>
            </button>
          )}
        </div>

        {/* Alcohol */}
        <div className="flex items-center gap-3 py-2 border-b border-gold/[0.06]">
          <Wine className="h-4 w-4 text-gold/50 shrink-0" />
          <span className="text-sm text-foreground flex-1">Alcohol</span>
          {activeDrum === 'alcohol' ? (
            <div data-drum-body="true" className="w-24 rounded-md bg-deep-forest border border-gold/30 animate-fade-in">
              <ScrollDrum min={0} max={10} step={1} value={alcohol} onChange={setAlcohol} />
            </div>
          ) : (
            <button
              onClick={() => openDrum('alcohol')}
              className="min-w-[64px] rounded-md border border-gold/10 bg-deep-forest px-3 py-1.5 text-center text-sm text-foreground"
            >
              {alcohol}
            </button>
          )}
        </div>

        {/* Soreness */}
        <div className="py-3 border-b border-gold/[0.06]" onClick={() => setActiveDrum('')}>
          <div className="flex items-center gap-3 mb-3">
            <Activity className="h-4 w-4 text-gold/50 shrink-0" />
            <span className="text-sm text-foreground">Soreness</span>
          </div>
          <SlidingGauge
            labels={SORENESS_LABELS}
            value={soreness}
            onChange={setSoreness}
          />
        </div>
      </div>

      {/* Notes — togglable */}
      {showNotes ? (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && hasAnyData && !submitting) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          rows={2}
          placeholder="How does the body feel..."
          className="mt-4 mb-3 w-full rounded-md border border-gold/10 bg-deep-forest px-3 py-2 text-base text-foreground placeholder-muted-foreground/50 focus:border-gold/40 focus:outline-none animate-fade-in"
          autoFocus
        />
      ) : (
        <button
          onClick={() => setShowNotes(true)}
          className="font-cinzel mt-3 mb-1 min-h-[44px] px-1 text-left text-[11px] uppercase tracking-[0.2em] text-gold/40 active:text-gold transition-colors"
        >
          + Add Note
        </button>
      )}

      <Button
        onClick={handleSubmit}
        disabled={submitting || !hasAnyData}
        className="w-full"
      >
        Log
      </Button>
    </div>
  )
}
