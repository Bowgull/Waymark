import { useState, useRef, useEffect } from 'react'
import { Moon, Leaf, Wine, Activity } from 'lucide-react'
import { apiFetch } from '@/lib/api'
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
  const [sleep, setSleep] = useState(existing?.sleepHours ?? 7)
  const [weed, setWeed] = useState(existing?.weedGrams ?? 0)
  const [alcohol, setAlcohol] = useState(existing?.alcoholScale ?? 0)
  const [soreness, setSoreness] = useState<number | null>(existing?.soreness ?? null)
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
    // Save structured wellness data
    onSubmit({
      sleepHours: sleep,
      weedGrams: weed,
      alcoholScale: alcohol,
      soreness: soreness ?? undefined,
    })
    // Save notes as a wellness journal entry if provided
    if (notes.trim()) {
      try {
        await apiFetch('/api/journal', {
          method: 'POST',
          body: JSON.stringify({ date: getTodayISO(), type: 'wellness', content: notes.trim() }),
        })
      } catch (e) {
        console.error('Failed to save wellness note:', e)
      }
    }
    setCollapsed(true)
    setNotes('')
    setShowNotes(false)
  }

  const hasAnyData = sleep > 0 || weed > 0 || alcohol > 0 || soreness != null

  function openDrum(name: string) {
    setActiveDrum(activeDrum === name ? '' : name)
  }

  if (collapsed) {
    return (
      <div className="rounded-md border border-gold/10 border-t-gold/20 bg-near-black/50 p-4">
        <div className="flex items-center justify-between">
          <p className="text-display text-gold">Morning Report</p>
          <button
            onClick={() => { setCollapsed(false); setShowNotes(true) }}
            className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-gold/20 px-3 py-1.5 text-xs text-gold/60 active:bg-gold/10"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Note
          </button>
        </div>
        <p className="mt-1 text-xs text-gold/50 italic">Logged</p>
      </div>
    )
  }

  return (
    <div ref={cardRef} className="rounded-md border border-gold/10 border-t-gold/20 bg-near-black/50 p-4">
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
              <ScrollDrum min={0} max={12} step={0.5} value={sleep} onChange={setSleep} suffix="hrs" />
            </div>
          ) : (
            <button
              onClick={() => openDrum('sleep')}
              className="min-w-[64px] rounded-md border border-gold/10 bg-deep-forest px-3 py-1.5 text-center text-sm text-foreground"
            >
              {sleep} <span className="text-xs text-muted-foreground">hrs</span>
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
          placeholder="How does the body feel... (Cmd+Enter to log)"
          className="mt-4 mb-3 w-full rounded-md border border-gold/10 bg-deep-forest px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 focus:border-gold/40 focus:outline-none animate-fade-in"
          autoFocus
        />
      ) : (
        <button
          onClick={() => setShowNotes(true)}
          className="mt-3 mb-1 flex min-h-[44px] items-center gap-1.5 rounded-full border border-gold/15 px-3 py-1.5 text-[13px] text-gold/40 active:bg-gold/10 transition-colors"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Note
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
