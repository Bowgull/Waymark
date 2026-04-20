import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { getTodayISO } from '@/lib/dates'
import { logger } from '@/lib/logger'
import { Button } from '@/components/ui/button'

function BrandW({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      width="24"
      height="20"
      viewBox="0 0 40 34"
      fill="#E8C860"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="
        M0 3 L1.5 0 L7 3
        L7 5 L14 30 L20 12 L26 30 L33 5 L33 3
        L38.5 0 L40 3
        L38 5 L30 32 L26 32 L20 16 L14 32 L10 32 L2 5
        Z
      " />
    </svg>
  )
}

interface JournalEntryData {
  id: string
  date: number
  type: string
  content: string
  createdAt: number
}

export function JournalEntry({ content }: { content: string }) {
  // Split on double newline to get separate entries (each "Save" / "Add More")
  const entries = content.split(/\n\n+/).filter((s) => s.trim())
  if (entries.length === 0) return null

  return (
    <div className="space-y-5">
      {entries.map((entry, ei) => {
        const lines = entry.split('\n').filter((l) => l.trim())
        return (
          <div key={ei} className="space-y-2">
            {lines.map((line, li) => {
              const capitalized = line.charAt(0).toUpperCase() + line.slice(1)
              return (
                <p key={li} className="font-[Cinzel] text-base leading-relaxed text-foreground">
                  {li === 0 ? (
                    <>
                      <span className="text-2xl leading-none text-gold">
                        {capitalized.charAt(0)}
                      </span>
                      {capitalized.slice(1)}
                    </>
                  ) : (
                    capitalized
                  )}
                </p>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

export function JournalCard() {
  const [entryId, setEntryId] = useState<string | null>(null)
  const [hasEntry, setHasEntry] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const today = getTodayISO()
  const isSunday = new Date(`${today}T12:00:00`).getDay() === 0
  const entryType = isSunday ? 'weekly' : 'daily'

  useEffect(() => {
    apiFetch<JournalEntryData | null>(`/api/journal?date=${today}&type=${entryType}`)
      .then((data) => {
        if (data) {
          setEntryId(data.id)
          setHasEntry(true)
          setJustSaved(true)
        }
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e)
        logger.warn('system', 'journal load failed', { date: today, entryType, message })
      })
      .finally(() => setLoaded(true))
  }, [today, entryType])

  async function handleSave() {
    if (!draft.trim()) return
    setSaving(true)
    try {
      if (entryId && hasEntry) {
        const existing = await apiFetch<JournalEntryData>(`/api/journal?date=${today}&type=${entryType}`)
        const combined = existing ? `${existing.content}\n\n${draft}` : draft
        await apiFetch(`/api/journal/${entryId}`, {
          method: 'PATCH',
          body: JSON.stringify({ content: combined }),
        })
      } else {
        const created = await apiFetch<JournalEntryData>('/api/journal', {
          method: 'POST',
          body: JSON.stringify({ date: today, type: entryType, content: draft }),
        })
        setEntryId(created.id)
      }
      setHasEntry(true)
      setDraft('')
      setJustSaved(true)
    } catch (e) {
      console.error('Failed to save journal:', e)
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="border border-gold/10 border-t-gold/20 bg-near-black/50 p-4">
      <div className="mb-3 flex items-baseline gap-0">
        <BrandW className="relative" style={{ top: '2px' }} />
        <span className="text-display text-gold">aybook</span>
      </div>

      {justSaved ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gold/50 italic">Saved To Waybook</p>
          <button
            onClick={() => setJustSaved(false)}
            className="flex items-center gap-1.5 rounded-full border border-gold/20 px-3 py-1.5 text-xs text-gold/60 active:bg-gold/10"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 2C15 2 11 6 9 10L7.5 14.5L3 22L10.5 17.5L15 16C19 14 22 9.5 22 4.5C22 3.5 21 2 20 2Z" />
            </svg>
            Add More
          </button>
        </div>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim() && !saving) {
                e.preventDefault()
                handleSave()
              }
            }}
            rows={5}
            placeholder={isSunday ? 'Reflect on your week...' : "What's on your mind..."}
            className="mb-3 w-full rounded-md border border-gold/10 bg-deep-forest px-3 py-2.5 font-[Cinzel] text-base leading-relaxed text-foreground placeholder-muted-foreground focus:border-gold/40 focus:outline-none"
          />
          <Button onClick={handleSave} disabled={saving || !draft.trim()} className="w-full">
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </>
      )}
    </div>
  )
}
