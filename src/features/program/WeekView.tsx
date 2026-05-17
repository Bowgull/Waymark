import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { SessionPicker, type SessionOption } from '@/components/ui/SessionPicker'
import { SkipReasonSheet, type SkipReasonCommit } from '@/features/session/SkipReasonSheet'
import type { SuggestionsResponse } from '@/lib/sessionSuggestions'
import type { WeekAnalysis } from '@/lib/weekAnalysis'
import { getSessionLabel } from '@/lib/weeklyTemplate'
import { getMarkAsset } from '@/lib/markAssets'
import { getStrengthTemplate, getWeekLabel, getDeadliftExerciseId } from '@/lib/strengthTemplates'
import { getRunPlanForWeek } from '@/lib/runningPlanTemplate'
import { getRoadBootcampWeekLabel } from '@/lib/roadBootcampTemplate'
import { getSessionTargetHr } from '@/lib/sessionIntent'

interface SessionSummary {
  id: string
  type: string
  timeSlot: string | null
  status: string
  scheduledDate: number | null
  adjustmentId?: string | null
  blockWeek?: number | null
  blockType?: string | null
  notes?: string | null
}

interface WeekAdjustment {
  id: string
  adjustmentType: string
  sessionType: string
  action: string
  reason: string
  targetDay: number | null
  targetTimeSlot: string | null
  status: string
  createdAt: number
}

interface WeekViewProps {
  sessions: SessionSummary[]
  weekStatus: string
  weekPlanId?: string
  analysisJson?: string | null
  weekNumber?: number
  onApprove: () => void
  onSessionUpdate?: (id: string, status: string) => void
  onSessionAdded?: (session: SessionSummary) => void
  maxHr?: number | null
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function actionVerb(action: string): string {
  switch (action) {
    case 'swap': return 'Swapped'
    case 'add': return 'Added'
    case 'remove': return 'Removed'
    case 'move_timeslot': return 'Moved'
    default: return 'Changed'
  }
}

// ─── Routine Overview ──────────────────────────────────────────

interface RoutineOverview {
  headline: string
  detail?: string
  intensityBadge?: string
  progressIcon?: 'up' | 'new-variant'
}

function compactTargetHr(targetHr: string | null): string | null {
  if (!targetHr) return null
  return targetHr.replace(/^Zone 2\. /, 'HR ').replace(/\.$/, '')
}

function getRoutineOverview(
  type: string,
  dayOfWeek: number,
  blockWeek: number,
  weekNumber: number,
  blockType: 'fighter' | 'block_zero' | 'road_bootcamp' = 'fighter',
  runCategory: string | null = null,
  maxHr: number | null = null,
): RoutineOverview | null {
  switch (type) {
    case 'strength': {
      if (blockType === 'road_bootcamp') {
        return {
          headline: dayOfWeek === 2 ? 'Squat · push · row' : 'Hinge · press · pull',
          detail: 'Pick time and equipment when you start.',
          intensityBadge: getRoadBootcampWeekLabel(weekNumber),
        }
      }
      const template = getStrengthTemplate(dayOfWeek, blockWeek, blockType)
      const mainLifts = template.exercises
        .filter(e => e.section === 'main')
        .map(e => e.label.replace(' Press', '').replace(' Progression', ''))
      const coreLabel = template.id === 'strength_a' ? 'Core A' : 'Core B'
      const intensity = getWeekLabel(blockWeek, blockType)

      // Check if intensity increased from previous week
      const prevBlockWeek = blockWeek > 1 ? blockWeek - 1 : 6
      const prevPct = Math.round(((prevBlockWeek <= 2 ? 0.75 : prevBlockWeek <= 4 ? 0.80 : 0.90)) * 100)
      const currPct = parseInt(intensity)
      const isUp = currPct > prevPct

      // Deadlift variant change indicator
      const dlId = getDeadliftExerciseId(blockWeek)
      const prevDlId = getDeadliftExerciseId(prevBlockWeek)
      const dlChanged = dlId !== prevDlId && template.id === 'strength_b'

      return {
        headline: mainLifts.join(' · ') + ' + ' + coreLabel,
        intensityBadge: intensity,
        progressIcon: isUp ? 'up' : dlChanged ? 'new-variant' : undefined,
      }
    }

    case 'foundation_run': {
      const duration = blockType === 'road_bootcamp'
        ? weekNumber === 4 ? '25 min' : weekNumber >= 5 ? '40 min' : '35 min'
        : '15-20 min'
      const hr = compactTargetHr(getSessionTargetHr('foundation_run', runCategory, maxHr))
      return {
        headline: 'Zone 2 easy, conversational pace',
        detail: `${duration} · ${hr ?? 'talk test'} · nasal breathing`,
      }
    }

    case 'running': {
      const plan = getRunPlanForWeek(weekNumber)
      if (plan) {
        // Extract first sentence or up to 60 chars
        const desc = plan.targetDesc.length > 70
          ? plan.targetDesc.slice(0, 67) + '...'
          : plan.targetDesc
        return {
          headline: desc,
          detail: plan.targetDistKm ? `~${plan.targetDistKm} km` : undefined,
        }
      }
      return { headline: 'Progression run' }
    }

    case 'mt_class': {
      return {
        headline: 'Muay Thai class: pad work, drills, sparring',
      }
    }

    case 'bag_work': {
      return {
        headline: 'Heavy bag rounds: combos + conditioning',
      }
    }

    case 'mobility': {
      return {
        headline: 'Breathing, upper release, lower mobility',
        detail: '7 exercises · ~10 min',
      }
    }

    case 'active_recovery': {
      return {
        headline: 'Light movement, foam rolling, stretching',
        detail: 'Keep it easy, focus on recovery',
      }
    }

    case 'skip_rope': {
      return {
        headline: 'Jump rope conditioning',
      }
    }

    default:
      return null
  }
}

// ─── Skipped Indicator ─────────────────────────────────────────

function SkippedIndicator({ sessionType, label }: { sessionType: string; label: string }) {
  const [expanded, setExpanded] = useState(false)
  const mark = getMarkAsset(sessionType)
  return (
    <div className="flex items-center gap-1.5">
      {expanded && (
        <div className="flex items-center gap-1 animate-fade-in">
          <img src={mark.png} alt="" className="h-3.5 w-3.5 object-contain opacity-40 saturate-0" />
          <span className="text-[13px] text-muted-foreground/60">{label}</span>
        </div>
      )}
      <button
        type="button"
        aria-label="Show skipped session"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        className="rounded-full p-1.5 active:bg-border/30"
      >
        <svg className="h-3.5 w-3.5 text-muted-foreground/50" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 10h10" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}

// ─── Status Icon ───────────────────────────────────────────────

function StatusIcon({ status, sessionType, label }: { status: string; sessionType?: string; label?: string }) {
  switch (status) {
    case 'completed':
      return (
        <svg className="h-4 w-4 text-forest-light" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 10l4 4 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'in_progress':
      return <span className="h-2 w-2 rounded-full bg-teal animate-pulse-glow" />
    case 'skipped':
      return sessionType && label
        ? <SkippedIndicator sessionType={sessionType} label={label} />
        : <svg className="h-3.5 w-3.5 text-muted-foreground/50" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 10h10" strokeLinecap="round" /></svg>
    default:
      return null
  }
}

// ─── Progress Icon ─────────────────────────────────────────────

function ProgressIcon({ type }: { type: 'up' | 'new-variant' }) {
  if (type === 'up') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-forest/15 px-1.5 py-px text-[13px] text-forest-light" title="Intensity increase">
        <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 12V4M5 7l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gold/10 px-1.5 py-px text-[13px] text-gold/70" title="New variant">
      new
    </span>
  )
}

// ─── Session Row (with long-press action tray) ─────────────────

function SessionRow({
  session,
  epochDay,
  weekStatus,
  isActionTrayOpen,
  showOverview,
  weekNumber,
  onLongPress,
  onSkip,
  onReplace,
  maxHr,
}: {
  session: SessionSummary
  epochDay: number
  weekStatus: string
  isActionTrayOpen: boolean
  showOverview: boolean
  weekNumber: number
  onLongPress: () => void
  onSkip: () => void
  onReplace: () => void
  maxHr?: number | null
}) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const date = new Date(epochDay * 86400 * 1000)
  const dayOfWeek = date.getUTCDay()
  const isRoadBootcamp = session.blockType === 'road_bootcamp'
  const label = isRoadBootcamp && session.type === 'strength'
    ? dayOfWeek === 2 ? 'Road Strength A' : 'Road Strength B'
    : isRoadBootcamp && session.type === 'foundation_run'
      ? 'Easy Run'
      : getSessionLabel(session.type, dayOfWeek)
  const mark = getMarkAsset(session.type)
  const isSkippable = session.status === 'planned' || session.status === 'in_progress'
  const isPassed = session.status === 'skipped' || session.status === 'missed'
  const blockWeek = session.blockWeek ?? 1
  const blockType = (session.blockType === 'block_zero' ? 'block_zero' : session.blockType === 'road_bootcamp' ? 'road_bootcamp' : 'fighter') as 'fighter' | 'block_zero' | 'road_bootcamp'
  const overview = showOverview && !isPassed
    ? getRoutineOverview(session.type, dayOfWeek, blockWeek, weekNumber, blockType, session.notes ?? null, maxHr ?? null)
    : null

  function handleTouchStart() {
    if (!isSkippable) return
    longPressTimer.current = setTimeout(() => {
      onLongPress()
    }, 500)
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  function handleTouchMove() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  return (
    <div className="relative overflow-hidden rounded-md">
      <div
        className="flex items-center justify-between py-0.5"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onMouseDown={handleTouchStart}
        onMouseUp={handleTouchEnd}
        onMouseLeave={handleTouchEnd}
        onContextMenu={(e) => {
          if (!isSkippable) return
          e.preventDefault()
          onLongPress()
        }}
      >
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-sm border px-1.5 py-px font-[Cinzel] text-[13px] tracking-[0.2em] ${
            session.timeSlot === 'am'
              ? 'border-gold/25 text-gold/80'
              : 'border-teal/25 text-teal/80'
          }`}>
            {session.timeSlot === 'am' ? 'AM' : 'PM'}
          </span>
          <img
            src={mark.png}
            alt=""
            className={`h-5 w-5 shrink-0 object-contain ${
              isPassed ? 'opacity-20 saturate-0' : 'opacity-70'
            }`}
          />
          <span className={`text-sm ${isPassed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
            {label}
          </span>
          {session.adjustmentId && (
            <span className="text-[13px] text-gold/50">makeup</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {weekStatus === 'draft' && session.status === 'planned' && (
            <button
              onClick={(e) => { e.stopPropagation(); onSkip() }}
              className="px-2 py-0.5 text-[13px] font-medium text-muted-foreground active:text-red-400"
            >
              Skip
            </button>
          )}
          <StatusIcon status={session.status} sessionType={session.type} label={label} />
        </div>
      </div>

      {/* Routine overview detail (when day is expanded) */}
      {overview && (
        <div className="ml-[4.5rem] mb-1.5 animate-fade-in">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[13px] text-muted-foreground/60 leading-tight">{overview.headline}</p>
            {overview.progressIcon && <ProgressIcon type={overview.progressIcon} />}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {overview.intensityBadge && (
              <span className="rounded-sm border border-gold/20 bg-gold/5 px-1.5 py-px font-[Cinzel] text-[13px] tracking-wider text-gold/60">
                {overview.intensityBadge}
              </span>
            )}
            {overview.detail && (
              <span className="text-[13px] text-muted-foreground/40">{overview.detail}</span>
            )}
          </div>
        </div>
      )}

      {/* Action tray — slides in from right on long-press */}
      {isActionTrayOpen && isSkippable && (
        <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-1 animate-slide-in-right">
          <button
            onClick={(e) => { e.stopPropagation(); onReplace() }}
            className="rounded-md bg-gold/15 px-3 py-1 text-[13px] font-medium text-gold active:bg-gold/25"
          >
            Replace
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSkip() }}
            className="rounded-md bg-red-500/10 px-3 py-1 text-[13px] font-medium text-red-400 active:bg-red-500/20"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  )
}

// ─── WeekView ──────────────────────────────────────────────────

export function WeekView({ sessions, weekStatus, weekPlanId, analysisJson, weekNumber = 1, onApprove, onSessionUpdate, onSessionAdded, maxHr }: WeekViewProps) {
  const [pickerDate, setPickerDate] = useState<string | null>(null)
  const [pickerSuggestions, setPickerSuggestions] = useState<SuggestionsResponse | null>(null)
  const [adjustments, setAdjustments] = useState<WeekAdjustment[]>([])
  const [expandedDay, setExpandedDay] = useState<number | null>(null)
  const [actionTraySessionId, setActionTraySessionId] = useState<string | null>(null)
  const [replacingSession, setReplacingSession] = useState<SessionSummary | null>(null)
  const [replaceReason, setReplaceReason] = useState<string | null>(null)
  const [skipReasonFor, setSkipReasonFor] = useState<{ id: string; replace: boolean } | null>(null)
  const [showAllChanges, setShowAllChanges] = useState(false)

  // Parse analysis from JSON
  const analysis: WeekAnalysis | null = analysisJson ? (() => {
    try { return JSON.parse(analysisJson) } catch { return null }
  })() : null

  // Fetch pending adjustments
  useEffect(() => {
    if (!weekPlanId) return
    apiFetch<WeekAdjustment[]>(`/api/adjustments?weekPlanId=${weekPlanId}`)
      .then(setAdjustments)
      .catch(() => setAdjustments([]))
  }, [weekPlanId])

  function toggleDay(epochDay: number) {
    setExpandedDay(prev => prev === epochDay ? null : epochDay)
    setActionTraySessionId(null)
  }

  function openPicker(epochDay: number) {
    const date = new Date(epochDay * 86400 * 1000)
    const isoDate = date.toISOString().split('T')[0]
    setPickerDate(isoDate)
    apiFetch<SuggestionsResponse>(`/api/sessions/suggestions?date=${isoDate}`)
      .then(setPickerSuggestions)
      .catch(() => setPickerSuggestions(null))
  }

  async function handleAddSession(option: SessionOption) {
    if (!pickerDate) return
    const date = pickerDate
    const replaceTarget = replacingSession
    const reason = replaceReason
    setPickerDate(null)
    setPickerSuggestions(null)
    setReplacingSession(null)
    setReplaceReason(null)

    if (replaceTarget && reason) {
      try {
        const result = await apiFetch<{ original: SessionSummary; replacement: SessionSummary }>(
          `/api/sessions/${replaceTarget.id}/replace`,
          {
            method: 'POST',
            body: JSON.stringify({
              reason,
              type: option.type,
              label: option.label,
              timeSlot: option.timeSlot,
              runCategory: option.runCategory,
            }),
          },
        )
        onSessionUpdate?.(result.original.id, result.original.status)
        onSessionAdded?.(result.replacement)
      } catch (e) {
        console.error('Failed to replace session:', e)
      }
      return
    }

    try {
      const created = await apiFetch<SessionSummary>('/api/sessions/insert-ad-hoc', {
        method: 'POST',
        body: JSON.stringify({
          date,
          type: option.type,
          timeSlot: option.timeSlot,
          runCategory: option.runCategory,
        }),
      })
      onSessionAdded?.(created)
    } catch (e) {
      console.error('Failed to add session:', e)
    }
  }

  function handleSkip(sessionId: string) {
    setActionTraySessionId(null)
    setSkipReasonFor({ id: sessionId, replace: false })
  }

  function handleReplace(session: SessionSummary) {
    setActionTraySessionId(null)
    setReplacingSession(session)
    setSkipReasonFor({ id: session.id, replace: true })
  }

  async function commitSkip(commit: SkipReasonCommit) {
    if (!skipReasonFor) return
    const { id, replace } = skipReasonFor
    setSkipReasonFor(null)

    if (replace) {
      setReplaceReason(commit.reason)
      const target = sessions.find(s => s.id === id)
      openPicker(target?.scheduledDate ?? 0)
      return
    }

    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'skipped',
          skipReason: commit.reason,
          skipReasonDetail: commit.detail,
        }),
      })
      onSessionUpdate?.(id, 'skipped')
    } catch (e) {
      console.error('Failed to skip session:', e)
    }
  }

  function cancelSkip() {
    setReplacingSession(null)
    setReplaceReason(null)
    setSkipReasonFor(null)
  }

  async function handleAcceptAdjustment(adjId: string) {
    try {
      const result = await apiFetch<{ adjustment: WeekAdjustment; session?: SessionSummary }>(`/api/adjustments/${adjId}/accept`, { method: 'POST' })
      setAdjustments(prev => prev.map(a => a.id === adjId ? { ...a, status: 'accepted' } : a))
      if (result.session) onSessionAdded?.(result.session)
    } catch (e) {
      console.error('Failed to accept adjustment:', e)
    }
  }

  async function handleRejectAdjustment(adjId: string) {
    try {
      await apiFetch(`/api/adjustments/${adjId}/reject`, { method: 'POST' })
      setAdjustments(prev => prev.map(a => a.id === adjId ? { ...a, status: 'rejected' } : a))
    } catch (e) {
      console.error('Failed to reject adjustment:', e)
    }
  }

  // Group sessions by epoch day
  const dayMap = new Map<number, SessionSummary[]>()
  for (const s of sessions) {
    const date = s.scheduledDate ?? 0
    if (!dayMap.has(date)) dayMap.set(date, [])
    dayMap.get(date)!.push(s)
  }
  const days = Array.from(dayMap.entries()).sort(([a], [b]) => a - b)
  const proposedAdj = adjustments.filter(a => a.status === 'proposed')
  const acceptedAdj = adjustments.filter(a => a.status === 'accepted')

  return (
    <div>
      {/* Draft approval banner */}
      {weekStatus === 'draft' && (
        <div className="mb-4 rounded-md border border-gold/30 bg-gold/5 p-3">
          <p className="mb-1 text-sm text-gold">Prepared week. Review and approve.</p>
          <p className="mb-2 text-xs text-muted-foreground">Remove anything that will not happen.</p>
          <Button size="sm" onClick={onApprove}>
            Approve Week
          </Button>
        </div>
      )}

      {/* Week Intelligence Card */}
      {(analysis || proposedAdj.length > 0) && (
        <div className="mb-4 rounded-md border border-border bg-card p-3 space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-gold/60">Week Intelligence</p>

          {analysis && (
            <p className="text-xs text-muted-foreground">{analysis.summary}</p>
          )}

          {analysis?.volumeByType && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(analysis.volumeByType)
                .filter(([, v]) => v.target > 0)
                .map(([key, v]) => {
                  const isBehind = v.completed < v.target
                  return (
                    <span
                      key={key}
                      className={`rounded-full px-2.5 py-0.5 text-[13px] border ${
                        isBehind
                          ? 'border-amber-500/30 bg-amber-500/5 text-amber-400/80'
                          : 'border-forest/30 bg-forest/5 text-forest-light/80'
                      }`}
                    >
                      {key.split(':')[0]} {v.completed}/{v.target}
                    </span>
                  )
                })}
            </div>
          )}

          {analysis?.wellness && (
            <div className="flex gap-3 text-[13px] text-muted-foreground/70">
              {analysis.wellness.avgSoreness != null && (
                <span>Soreness {analysis.wellness.avgSoreness.toFixed(1)}/5 ({analysis.wellness.sorenessTrajectory})</span>
              )}
              {analysis.wellness.avgSleep != null && (
                <span>Sleep {analysis.wellness.avgSleep.toFixed(1)}h ({analysis.wellness.sleepTrajectory})</span>
              )}
            </div>
          )}

          {proposedAdj.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground/50">Proposed Adjustments</p>
              {proposedAdj.map(adj => (
                <div key={adj.id} className="flex items-start gap-2 rounded-md border border-gold/15 bg-gold/5 px-3 py-2">
                  <span className="flex-1 text-xs text-gold/80">{adj.reason}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleAcceptAdjustment(adj.id)}
                      className="rounded px-2 py-0.5 text-[13px] font-medium bg-gold/20 text-gold active:bg-gold/30"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRejectAdjustment(adj.id)}
                      className="rounded px-2 py-0.5 text-[13px] text-muted-foreground active:text-red-400"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Week Changes — latest accepted adjustment by default; tap the count chip to see earlier ones */}
      {acceptedAdj.length > 0 && (() => {
        const sorted = [...acceptedAdj].sort((a, b) => a.createdAt - b.createdAt)
        const latest = sorted[sorted.length - 1]
        const earlier = sorted.slice(0, -1)
        const hasEarlier = earlier.length > 0
        const latestWhen = [
          latest.targetDay != null ? DAY_NAMES[latest.targetDay] : null,
          latest.targetTimeSlot ? latest.targetTimeSlot.toUpperCase() : null,
        ].filter(Boolean).join(' ')

        return (
          <div className="mb-4 rounded-md border border-border/60 bg-card/50 p-3">
            <div className="mb-2 flex items-baseline gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
              <span>Week Changes</span>
              {hasEarlier ? (
                <button
                  type="button"
                  onClick={() => setShowAllChanges(v => !v)}
                  className="text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors"
                  aria-label={showAllChanges ? 'Hide earlier changes' : 'Show earlier changes'}
                >
                  · {acceptedAdj.length}
                </button>
              ) : (
                <span className="text-muted-foreground/40">· {acceptedAdj.length}</span>
              )}
            </div>
            {/* Latest: voice-clean, no prefix */}
            <p className="text-[13px] leading-relaxed text-foreground/80">{latest.reason}</p>
            {latestWhen && (
              <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground/40">{latestWhen}</p>
            )}
            {/* Earlier: full prefix format for chronological context */}
            {showAllChanges && hasEarlier && (
              <ul className="mt-3 space-y-1.5 border-t border-border/40 pt-3">
                {earlier.slice().reverse().map(adj => {
                  const verb = actionVerb(adj.action)
                  const day = adj.targetDay != null ? DAY_NAMES[adj.targetDay] : null
                  const slot = adj.targetTimeSlot ? adj.targetTimeSlot.toUpperCase() : null
                  const when = [day, slot].filter(Boolean).join(' ')
                  return (
                    <li key={adj.id} className="flex items-start gap-2 text-[12px] text-muted-foreground/70">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/30" />
                      <span className="flex-1">
                        <span className="text-foreground/70">{verb}</span>
                        {when && <span className="text-muted-foreground/50"> · {when}</span>}
                        <span className="text-muted-foreground/50"> · {adj.reason}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })()}

      {/* Day-by-day schedule */}
      <div className="space-y-2">
        {days.map(([epochDay, daySessions]) => {
          const date = new Date(epochDay * 86400 * 1000)
          const dayName = DAY_NAMES[date.getUTCDay()]
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
          const isExpanded = expandedDay === epochDay
          const sortedSessions = daySessions.sort((a, b) =>
            (a.timeSlot === 'am' ? -1 : 1) - (b.timeSlot === 'am' ? -1 : 1)
          )

          return (
            <div key={epochDay} className="rounded-md border border-border bg-card p-3">
              {/* Day header — tap to expand/collapse details */}
              <button
                type="button"
                onClick={() => toggleDay(epochDay)}
                className="mb-2 flex w-full items-center justify-between"
              >
                <span className="text-sm font-semibold text-foreground">{dayName}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{dateStr}</span>
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full border border-gold/25 text-gold/60 transition-transform duration-300 ${
                      isExpanded ? 'rotate-45' : ''
                    }`}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
                    </svg>
                  </span>
                </div>
              </button>

              {/* Sessions — always visible */}
              <div className="space-y-1.5">
                {/* Dismiss overlay for action tray */}
                {actionTraySessionId && isExpanded && (
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setActionTraySessionId(null)}
                  />
                )}

                <div className={isExpanded ? 'relative z-20' : ''}>
                  {sortedSessions.map(s => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      epochDay={epochDay}
                      weekStatus={weekStatus}
                      isActionTrayOpen={actionTraySessionId === s.id}
                      showOverview={isExpanded}
                      weekNumber={weekNumber}
                      onLongPress={() => setActionTraySessionId(s.id)}
                      onSkip={() => handleSkip(s.id)}
                      onReplace={() => handleReplace(s)}
                      maxHr={maxHr}
                    />
                  ))}
                </div>
              </div>

              {/* Expanded: ghost "Add Session" row */}
              {isExpanded && (
                <div className="relative z-20 mt-2 animate-fade-in">
                  <button
                    type="button"
                    onClick={() => openPicker(epochDay)}
                    className="flex w-full items-center gap-2 rounded-md border border-dashed border-border/40 px-2 py-2 text-muted-foreground/40 active:bg-border/20 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M10 4v12M4 10h12" strokeLinecap="round" />
                    </svg>
                    <span className="text-xs">Add Session</span>
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {skipReasonFor && (
        <SkipReasonSheet
          onCommit={commitSkip}
          onClose={cancelSkip}
        />
      )}

      {/* Session Picker modal */}
      {pickerDate && (
        <SessionPicker
          onSelect={handleAddSession}
          onClose={() => {
            setPickerDate(null)
            setPickerSuggestions(null)
            setReplacingSession(null)
            setReplaceReason(null)
          }}
          suggestions={pickerSuggestions}
          filter={replacingSession
            ? (opt) => opt.type !== replacingSession.type
            : undefined
          }
        />
      )}
    </div>
  )
}
