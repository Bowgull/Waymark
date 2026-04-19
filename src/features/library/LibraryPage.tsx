import { useEffect, useMemo, useState } from 'react'

import { apiFetch } from '@/lib/api'
import { getCategoryMark, waybookPng } from '@/lib/markAssets'
import bagworkPng from '@/assets/brand/Bagwork.png'
import { FormVideoLink } from '@/components/FormVideoLink'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { ForgeIcon, LockIcon } from '@/components/icons/SessionIcons'
import { GoldDivider } from '@/components/ui/GoldDivider'
import { LibrarySkeleton } from '@/components/ui/Skeleton'
import { JournalEntry } from '@/features/today/JournalCard'

interface Exercise {
  id: string
  name: string
  category: string
  muscleGroups: string | null
  equipment: string | null
  formCues: string | null
  formVideoUrl: string | null
}

interface ComboData {
  id: string
  text: string
  tier: string
  level: string
  unlocked: number
  masteryScore: number
  techniques: string
  formTips: string
  isFavourite: number
  timesSharp: number
}

interface JournalEntry {
  id: string
  date: number
  type: string
  content: string
  createdAt: number
}

const TIER_ORDER_LIST = ['foundation', 'weapons', 'flow', 'deception', 'mastery']
const TIER_LABELS: Record<string, string> = {
  foundation: 'Fundamentals',
  weapons: 'Weapons',
  flow: 'Flow',
  deception: 'Deception',
  mastery: 'Mastery',
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: 'Strength',
  core: 'Core',
  posture: 'Foundation',
  mobility: 'Mobility',
}

const CATEGORY_ORDER = ['strength', 'core', 'posture', 'mobility']

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function LibraryPage() {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [comboList, setComboList] = useState<ComboData[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [combosOpen, setCombosOpen] = useState(false)
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(new Set())
  const [expandedComboId, setExpandedComboId] = useState<string | null>(null)

  // Journal history
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [journalOpen, setJournalOpen] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [data, journalData, comboData] = await Promise.all([
          apiFetch<Exercise[]>('/api/exercises'),
          apiFetch<JournalEntry[]>('/api/journal/history?days=90'),
          apiFetch<ComboData[]>('/api/combos'),
        ])
        setExercises(data)
        setJournalEntries(journalData)
        setComboList(comboData)
      } catch (e) {
        console.error('Failed to load library:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function loadJournal() {
    if (journalEntries.length > 0) {
      setJournalOpen(!journalOpen)
      return
    }
    try {
      const rows = await apiFetch<JournalEntry[]>('/api/journal/history?days=30')
      setJournalEntries(rows)
      setJournalOpen(true)
      // Auto-expand reflections if there are any, otherwise body log
      const hasReflections = rows.some(r => r.type !== 'wellness')
      const hasBodyLog = rows.some(r => r.type === 'wellness')
      if (hasReflections) {
        setReflectionsOpen(true)
        const firstReflection = rows.find(r => r.type !== 'wellness')
        if (firstReflection) setExpandedMonths(new Set(['r-' + getMonthKey(firstReflection.date)]))
      }
      if (!hasReflections && hasBodyLog) {
        setBodyLogOpen(true)
        const firstBody = rows.find(r => r.type === 'wellness')
        if (firstBody) setExpandedMonths(new Set(['b-' + getMonthKey(firstBody.date)]))
      }
    } catch (e) {
      console.error('Failed to load journal:', e)
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return exercises
    const q = search.toLowerCase()
    return exercises.filter(
      (ex) =>
        ex.name.toLowerCase().includes(q) ||
        ex.muscleGroups?.toLowerCase().includes(q) ||
        ex.equipment?.toLowerCase().includes(q)
    )
  }, [exercises, search])

  const grouped = useMemo(() => {
    const map = new Map<string, Exercise[]>()
    for (const ex of filtered) {
      if (!map.has(ex.category)) map.set(ex.category, [])
      map.get(ex.category)!.push(ex)
    }
    return map
  }, [filtered])

  // Filter journal entries by search
  const filteredJournal = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    return journalEntries.filter((e) => e.content.toLowerCase().includes(q))
  }, [journalEntries, search])

  // Combo filtering
  const filteredCombos = useMemo(() => {
    if (!search.trim()) return comboList
    const q = search.toLowerCase()
    return comboList.filter(c => c.text.toLowerCase().includes(q) || c.tier.toLowerCase().includes(q))
  }, [comboList, search])

  const combosByTier = useMemo(() => {
    const map = new Map<string, ComboData[]>()
    for (const c of filteredCombos) {
      if (!map.has(c.tier)) map.set(c.tier, [])
      map.get(c.tier)!.push(c)
    }
    return map
  }, [filteredCombos])

  function toggleTier(tier: string) {
    setExpandedTiers(prev => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier)
      else next.add(tier)
      return next
    })
  }

  async function toggleFavourite(comboId: string) {
    try {
      const updated = await apiFetch<ComboData>(`/api/combos/${comboId}/favourite`, { method: 'PATCH' })
      setComboList(prev => prev.map(c => c.id === comboId ? updated : c))
    } catch (e) {
      console.error('Failed to toggle favourite:', e)
    }
  }

  const isSearching = search.trim().length > 0

  function toggleCategory(cat: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function formatEpochDay(epochDay: number) {
    const d = new Date(epochDay * 86400 * 1000)
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  function getMonthKey(epochDay: number) {
    const d = new Date(epochDay * 86400 * 1000)
    const month = d.toLocaleDateString('en-US', { month: 'long' })
    const year = String(d.getFullYear()).slice(2)
    return `${month} '${year}`
  }

  // Split entries into reflections vs body log
  const reflections = useMemo(() => journalEntries.filter(e => e.type !== 'wellness'), [journalEntries])
  const bodyLog = useMemo(() => journalEntries.filter(e => e.type === 'wellness'), [journalEntries])

  function groupByMonth(entries: typeof journalEntries) {
    const groups: { key: string; entries: typeof journalEntries }[] = []
    const map = new Map<string, typeof journalEntries>()
    for (const entry of entries) {
      const key = getMonthKey(entry.date)
      if (!map.has(key)) {
        map.set(key, [])
        groups.push({ key, entries: map.get(key)! })
      }
      map.get(key)!.push(entry)
    }
    return groups
  }

  const reflectionsByMonth = useMemo(() => groupByMonth(reflections), [reflections])
  const bodyLogByMonth = useMemo(() => groupByMonth(bodyLog), [bodyLog])

  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [reflectionsOpen, setReflectionsOpen] = useState(false)
  const [bodyLogOpen, setBodyLogOpen] = useState(false)

  function toggleMonth(key: string) {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (loading) {
    return <LibrarySkeleton />
  }

  return (
    <div>
      <PageHeader title="Library" />

      {/* Search input */}
      <div className="mb-5 px-1">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search exercises, combos, journal..."
          className="w-full rounded-md border border-gold/10 bg-deep-forest px-3 py-2.5 text-base text-foreground placeholder-muted-foreground focus:border-gold/40 focus:outline-none focus:ring-1 focus:ring-gold/20"
        />
      </div>

      {filtered.length === 0 && !isSearching && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No exercises loaded.
        </p>
      )}

      {filtered.length === 0 && filteredCombos.length === 0 && filteredJournal.length === 0 && isSearching && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No results for "{search}"
        </p>
      )}

      {/* Exercise categories */}
      {CATEGORY_ORDER.map((cat) => {
        const items = grouped.get(cat)
        if (!items?.length) return null

        const isOpen = isSearching || expandedCats.has(cat)

        return (
          <div key={cat} className="mb-4">
            <button
              onClick={() => !isSearching && toggleCategory(cat)}
              className="flex w-full items-center gap-3 px-1 py-2"
            >
              {!isSearching && <ChevronIcon open={isOpen} />}
              <img
                src={getCategoryMark(cat).png}
                alt=""
                className="h-8 w-8 object-contain opacity-50"
                style={{ mixBlendMode: 'screen' }}
              />
              <span className="text-label text-muted-foreground">
                {CATEGORY_LABELS[cat] ?? cat}
              </span>
              <Badge variant="muted" className="ml-1 text-[13px]">
                {items.length}
              </Badge>
            </button>

            {isOpen && (
              <div className="space-y-2 pl-1">
                {items.map((ex) => {
                  const isExpanded = expandedId === ex.id
                  const muscles = ex.muscleGroups
                    ? ex.muscleGroups.split(',').map((m) => m.trim())
                    : []

                  return (
                    <button
                      key={ex.id}
                      onClick={() => setExpandedId(isExpanded ? null : ex.id)}
                      className="w-full rounded-md border border-border bg-card p-3 text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {ex.name}
                        </span>
                        {ex.equipment && (
                          <span className="shrink-0 text-[13px] text-muted-foreground">
                            {ex.equipment}
                          </span>
                        )}
                      </div>

                      {muscles.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {muscles.map((m) => (
                            <Badge key={m} variant="gold" className="text-[13px] py-0">
                              {m}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {isExpanded && (ex.formCues || ex.formVideoUrl) && (
                        <div className="mt-3 border-l-2 border-gold/30 pl-3">
                          {ex.formCues && (
                            <p className="text-sm italic leading-relaxed text-muted-foreground">
                              {ex.formCues}
                            </p>
                          )}
                          {ex.formVideoUrl && (
                            <div className={ex.formCues ? 'mt-3' : ''}>
                              <FormVideoLink url={ex.formVideoUrl} variant="pill" />
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Combos section */}
      {!isSearching && <div className="mb-4">
        <button
          onClick={() => setCombosOpen(!combosOpen)}
          className="flex w-full items-center gap-3 px-1 py-2"
        >
          <ChevronIcon open={combosOpen} />
          <img
            src={bagworkPng}
            alt=""
            className="h-8 w-8 object-contain opacity-50"
            style={{ mixBlendMode: 'screen' }}
          />
          <span className="text-label text-muted-foreground">Bagwork</span>
          <Badge variant="muted" className="ml-1 text-[13px]">
            {comboList.filter(c => c.unlocked).length}/{comboList.length}
          </Badge>
        </button>

        {combosOpen && (
          <div className="pl-1 pt-1 space-y-2">
            {TIER_ORDER_LIST.map(tier => {
              const items = combosByTier.get(tier)
              if (!items?.length) return null
              const isTierOpen = expandedTiers.has(tier)
              const unlockedCount = items.filter(c => c.unlocked).length
              const masteredCount = items.filter(c => c.masteryScore >= 9).length

              return (
                <div key={tier}>
                  <button
                    onClick={() => toggleTier(tier)}
                    className="flex w-full items-center gap-2 py-2"
                  >
                    <ChevronIcon open={isTierOpen} />
                    <span className="font-cinzel text-sm tracking-wider text-gold/70">
                      {TIER_LABELS[tier]}
                    </span>
                    <Badge variant="muted" className="ml-1 text-[13px]">
                      {unlockedCount > 0 ? `${masteredCount}/${unlockedCount}` : <LockIcon size={12} />}
                    </Badge>
                  </button>

                  {isTierOpen && (
                    <div className="space-y-1.5 pl-2">
                      {items.map(c => {
                        const isExpanded = expandedComboId === c.id
                        const dots = Math.min(Math.floor(c.masteryScore / 3), 5)
                        const techniques = c.techniques.split(',').filter(Boolean)

                        return (
                          <div
                            key={c.id}
                            onClick={() => setExpandedComboId(isExpanded ? null : c.id)}
                            className={`w-full rounded-md border p-3 text-left cursor-pointer ${
                              c.unlocked ? 'border-border bg-card' : 'border-border/50 bg-card/50 opacity-60'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <span className={`text-sm font-medium ${c.unlocked ? 'text-foreground' : 'text-muted-foreground'}`}>
                                  {!c.unlocked && <span className="mr-1.5 inline-flex align-text-bottom text-muted-foreground"><LockIcon size={12} /></span>}{c.text}
                                </span>
                              </div>
                              {c.isFavourite === 1 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleFavourite(c.id) }}
                                  className="text-gold shrink-0"
                                >
                                  <ForgeIcon size={16} mastered={c.masteryScore >= 9} />
                                </button>
                              )}
                              {c.unlocked === 1 && c.isFavourite === 0 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleFavourite(c.id) }}
                                  className={c.masteryScore >= 9 ? 'text-gold shrink-0' : 'text-border shrink-0'}
                                >
                                  <ForgeIcon size={16} mastered={c.masteryScore >= 9} />
                                </button>
                              )}
                            </div>

                            {c.unlocked === 1 && (
                              <div className="mt-1.5 flex items-center gap-3">
                                <div className="flex gap-1">
                                  {Array.from({ length: 5 }, (_, di) => (
                                    <span
                                      key={di}
                                      className={`h-1.5 w-1.5 rounded-full ${di < dots ? 'bg-gold' : 'bg-border'}`}
                                    />
                                  ))}
                                </div>
                                {techniques.length > 0 && (
                                  <div className="flex gap-1">
                                    {techniques.map(t => (
                                      <Badge key={t} variant="muted" className="text-[13px] py-0">{t}</Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {isExpanded && c.unlocked === 1 && (
                              <div className="mt-3 border-l-2 border-gold/30 pl-3 text-xs text-muted-foreground space-y-1">
                                {c.formTips && (
                                  <p className="font-cinzel text-[13px] leading-snug text-teal/80 mb-2">{c.formTips}</p>
                                )}
                                <p>Mastery: {c.masteryScore}/15</p>
                                <p>Sharp ratings: {c.timesSharp}</p>
                                {c.masteryScore >= 9 && <p className="text-teal">Mastered</p>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>}

      {/* Combo search results */}
      {isSearching && filteredCombos.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-3 px-1 py-2">
            <img src={bagworkPng} alt="" className="h-8 w-8 object-contain opacity-50" style={{ mixBlendMode: 'screen' }} />
            <span className="text-label text-muted-foreground">Bagwork</span>
            <Badge variant="muted" className="ml-1 text-[13px]">{filteredCombos.length}</Badge>
          </div>
          <div className="space-y-1.5 pl-1">
            {filteredCombos.map(c => (
              <div key={c.id} className="rounded-md border border-border bg-card p-3">
                <span className="text-sm text-foreground">{c.text}</span>
                <div className="mt-1 flex gap-1">
                  <Badge variant="gold" className="text-[13px] py-0">{TIER_LABELS[c.tier]}</Badge>
                  {(c.isFavourite === 1 || c.masteryScore >= 9) && <span className="text-gold"><ForgeIcon size={12} mastered={c.masteryScore >= 9} /></span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waybook search results */}
      {isSearching && filteredJournal.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-3 px-1 py-2">
            <img src={waybookPng} alt="" className="h-8 w-8 object-contain opacity-50" style={{ mixBlendMode: 'screen' }} />
            <span className="text-label text-gold/70">Waybook</span>
            <Badge variant="muted" className="ml-1 text-[13px]">
              {filteredJournal.length}
            </Badge>
          </div>
          <div className="pl-1 pt-1">
            {filteredJournal.map((entry, i) => (
              <div key={entry.id}>
                <div className="mb-2 flex items-center gap-2">
                  <p className="font-[family-name:var(--font-display)] text-xs tracking-wider text-gold/60">
                    {formatEpochDay(entry.date)}
                  </p>
                  <Badge
                    variant={entry.type === 'wellness' ? 'muted' : 'gold'}
                    className="text-[13px] py-0"
                  >
                    {entry.type === 'wellness' ? 'body' : entry.type}
                  </Badge>
                </div>
                <JournalEntry content={entry.content} />
                {i < filteredJournal.length - 1 && (
                  <GoldDivider className="my-5" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Journal section */}
      {!isSearching && <div className="mb-4 mt-2">
        <button
          onClick={loadJournal}
          className="flex w-full items-center gap-3 px-1 py-2"
        >
          <ChevronIcon open={journalOpen} />
          <img src={waybookPng} alt="" className="h-8 w-8 object-contain opacity-50" style={{ mixBlendMode: 'screen' }} />
          <span className="text-label text-gold/70">Waybook</span>
        </button>

        {journalOpen && (
          <div className="pl-1 pt-2">
            {journalEntries.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No entries yet.
              </p>
            )}

            {/* Reflections sub-section */}
            {reflections.length > 0 && (
              <div className="mb-3">
                <button
                  onClick={() => setReflectionsOpen(!reflectionsOpen)}
                  className="flex w-full items-center gap-2 py-2"
                >
                  <ChevronIcon open={reflectionsOpen} />
                  <span className="text-label text-muted-foreground">Reflections</span>
                  <Badge variant="muted" className="ml-1 text-[13px]">
                    {reflections.length}
                  </Badge>
                </button>

                {reflectionsOpen && reflectionsByMonth.map((group) => {
                  const isOpen = expandedMonths.has('r-' + group.key)
                  return (
                    <div key={group.key} className="mb-3 pl-2">
                      <button
                        onClick={() => toggleMonth('r-' + group.key)}
                        className="flex w-full items-center gap-2 py-2"
                      >
                        <ChevronIcon open={isOpen} />
                        <span className="text-display-sm text-gold">{group.key}</span>
                        <Badge variant="muted" className="ml-1 text-[13px]">
                          {group.entries.length}
                        </Badge>
                      </button>

                      {isOpen && (
                        <div className="pt-1">
                          {group.entries.map((entry, i) => (
                            <div key={entry.id}>
                              <div className="mb-2 flex items-center gap-2">
                                <p className="font-[family-name:var(--font-display)] text-xs tracking-wider text-gold/60">
                                  {formatEpochDay(entry.date)}
                                </p>
                                {entry.type === 'weekly' && (
                                  <Badge variant="gold" className="text-[13px] py-0">weekly</Badge>
                                )}
                              </div>
                              <JournalEntry content={entry.content} />
                              {i < group.entries.length - 1 && (
                                <GoldDivider className="my-5" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Body Log sub-section */}
            {bodyLog.length > 0 && (
              <div className="mb-3">
                <button
                  onClick={() => setBodyLogOpen(!bodyLogOpen)}
                  className="flex w-full items-center gap-2 py-2"
                >
                  <ChevronIcon open={bodyLogOpen} />
                  <span className="text-label text-muted-foreground">Body Log</span>
                  <Badge variant="muted" className="ml-1 text-[13px]">
                    {bodyLog.length}
                  </Badge>
                </button>

                {bodyLogOpen && bodyLogByMonth.map((group) => {
                  const isOpen = expandedMonths.has('b-' + group.key)
                  return (
                    <div key={group.key} className="mb-3 pl-2">
                      <button
                        onClick={() => toggleMonth('b-' + group.key)}
                        className="flex w-full items-center gap-2 py-2"
                      >
                        <ChevronIcon open={isOpen} />
                        <span className="text-display-sm text-gold">{group.key}</span>
                        <Badge variant="muted" className="ml-1 text-[13px]">
                          {group.entries.length}
                        </Badge>
                      </button>

                      {isOpen && (
                        <div className="pt-1">
                          {group.entries.map((entry, i) => (
                            <div key={entry.id}>
                              <div className="mb-2 flex items-center gap-2">
                                <p className="font-[family-name:var(--font-display)] text-xs tracking-wider text-gold/60">
                                  {formatEpochDay(entry.date)}
                                </p>
                              </div>
                              <JournalEntry content={entry.content} />
                              {i < group.entries.length - 1 && (
                                <GoldDivider className="my-5" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>}
    </div>
  )
}
