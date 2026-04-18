import { getMarkAsset } from '@/lib/markAssets'
import { getEstimatedMin } from '@/lib/weeklyTemplate'
import { getSessionIntent, getSessionTargetHr } from '@/lib/sessionIntent'
import { Button } from '@/components/ui/button'
import { tapHaptic, mediumHaptic } from '@/lib/haptics'

export interface RunSessionSummary {
  id: string
  stravaActivityId: number | null
  attachmentStatus: string | null
  source: string
  distanceKm: number | null
  durationSec: number | null
  paceSecKm: number | null
  avgHr: number | null
  maxHr: number | null
  elevationGainM: number | null
}

interface Session {
  id: string
  type: string
  timeSlot: string | null
  status: string
  startedAt: number | null
  completedAt: number | null
  durationSec: number | null
  rpe: number | null
  notes: string | null
  runSession?: RunSessionSummary | null
}

interface TimelineRowProps {
  session: Session
  maxHr?: number | null
  onStart: (id: string) => void
  onSkip: (id: string) => void
  onReplace: (id: string) => void
  onConfirmMatch?: (activityId: number) => void
  onReassignMatch?: (activityId: number) => void
  onDismissMatch?: (activityId: number) => void
  expanded: boolean
  onToggle: () => void
  label: string
}

function formatDuration(sec: number): string {
  const min = Math.round(sec / 60)
  return `${min}min`
}

function formatPace(secKm: number): string {
  const m = Math.floor(secKm / 60)
  const s = Math.round(secKm % 60).toString().padStart(2, '0')
  return `${m}:${s}/km`
}

function formatKm(km: number): string {
  return km >= 10 ? `${km.toFixed(1)}km` : `${km.toFixed(2)}km`
}

function statusBg(status: string, pending: boolean): string {
  if (pending) return 'bg-teal/[0.04]'
  switch (status) {
    case 'completed': return 'bg-gold/5'
    case 'in_progress': return 'bg-teal/5'
    default: return 'bg-transparent'
  }
}

function markStyle(status: string): string {
  switch (status) {
    case 'completed': return 'opacity-90'
    case 'in_progress': return 'opacity-100 drop-shadow-[0_0_4px_rgba(74,202,170,0.5)]'
    case 'skipped': return 'opacity-30 saturate-0'
    default: return 'opacity-50'
  }
}

export function TimelineRow({
  session,
  maxHr,
  onStart,
  onSkip,
  onReplace,
  onConfirmMatch,
  onReassignMatch,
  onDismissMatch,
  expanded,
  onToggle,
  label,
}: TimelineRowProps) {
  const mark = getMarkAsset(session.type)
  const estMin = getEstimatedMin(session.type)
  const run = session.runSession ?? null
  const isAutoPending = run?.attachmentStatus === 'auto_pending' && run.stravaActivityId != null
  const isOrphan = run?.attachmentStatus === 'orphan' && run.stravaActivityId != null
  const isActionable = (session.status === 'planned' || session.status === 'in_progress') && !isAutoPending
  const isCompleted = session.status === 'completed' && !isOrphan
  const isSkipped = session.status === 'skipped'

  const displayLabel = isOrphan ? 'Unplanned Run' : label
  const targetHr = getSessionTargetHr(session.type, session.notes, maxHr ?? null)

  return (
    <div className={`rounded-lg ${statusBg(session.status, isAutoPending)} transition-colors`}>
      {/* Collapsed row — always visible */}
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-surface/20"
        onClick={() => {
          tapHaptic()
          onToggle()
        }}
      >
        <img
          src={mark.png}
          alt=""
          className={`h-4 w-4 object-contain ${markStyle(session.status)}`}
        />
        <div className="flex-1 min-w-0">
          <span className={`text-sm font-semibold ${isSkipped ? 'text-muted-foreground/50 line-through' : isCompleted ? 'text-foreground/80' : 'text-foreground'}`}>
            {displayLabel}
          </span>
          {isAutoPending && (
            <span className="ml-2 font-cinzel text-[10px] uppercase tracking-[0.18em] text-teal/70">
              From Strava
            </span>
          )}
          {isCompleted && session.rpe != null && (
            <span className="ml-2 text-xs text-muted-foreground">
              RPE {session.rpe}
            </span>
          )}
        </div>
        <span className={`text-xs tabular-nums ${isCompleted ? 'text-gold/70' : 'text-muted-foreground'}`}>
          {(isCompleted || isOrphan) && (run?.durationSec ?? session.durationSec)
            ? formatDuration(run?.durationSec ?? session.durationSec!)
            : isSkipped
            ? <svg className="h-3.5 w-3.5 text-muted-foreground/40" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 10h10" strokeLinecap="round" /></svg>
            : `~${estMin}min`}
        </span>
        <svg
          className={`h-3.5 w-3.5 text-muted-foreground/50 transition-transform ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="animate-fade-in px-3 pb-3 pl-10">
          {isAutoPending && run && (
            <ActivityConfirmBody
              run={run}
              plannedIntent={getSessionIntent(session.type)}
              onConfirm={() => {
                mediumHaptic()
                onConfirmMatch?.(run.stravaActivityId!)
              }}
              onReassign={() => {
                tapHaptic()
                onReassignMatch?.(run.stravaActivityId!)
              }}
              onDismiss={() => {
                tapHaptic()
                onDismissMatch?.(run.stravaActivityId!)
              }}
            />
          )}
          {isOrphan && run && (
            <OrphanRunBody
              run={run}
              onReassign={() => {
                tapHaptic()
                onReassignMatch?.(run.stravaActivityId!)
              }}
              onDismiss={() => {
                tapHaptic()
                onDismissMatch?.(run.stravaActivityId!)
              }}
            />
          )}
          {isActionable && (
            <>
              <p className="pb-2 text-[13px] text-muted-foreground italic leading-relaxed">
                {getSessionIntent(session.type)}
              </p>
              {targetHr && (
                <p className="pb-2 text-[13px] text-muted-foreground italic leading-relaxed">
                  {targetHr}
                </p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={() => onStart(session.id)}
                >
                  {session.status === 'in_progress' ? 'Resume' : 'Enter'}
                </Button>
                {session.status === 'planned' && (
                  <>
                    <button
                      type="button"
                      className="min-h-[36px] rounded-full border border-border/50 px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground/80 active:bg-surface/30 active:text-foreground"
                      onClick={() => onReplace(session.id)}
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      className="min-h-[36px] rounded-full border border-border/30 px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground/60 active:bg-surface/30 active:text-foreground"
                      onClick={() => onSkip(session.id)}
                    >
                      Skip
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {isCompleted && (
            <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
              {session.durationSec != null && (
                <span>Duration: {formatDuration(session.durationSec)}</span>
              )}
              {session.rpe != null && (
                <span>RPE: {session.rpe}/10</span>
              )}
            </div>
          )}
          {isSkipped && (
            <p className="pt-1 text-xs text-muted-foreground/50">Skipped</p>
          )}
        </div>
      )}
    </div>
  )
}

function RunStatLine({ run }: { run: RunSessionSummary }) {
  const parts: string[] = []
  if (run.distanceKm != null) parts.push(formatKm(run.distanceKm))
  if (run.paceSecKm != null) parts.push(formatPace(run.paceSecKm))
  if (run.avgHr != null) parts.push(`${run.avgHr} avg`)
  if (run.maxHr != null) parts.push(`${run.maxHr} max`)
  return (
    <p className="text-[13px] text-foreground/90 tabular-nums">
      {parts.join(' · ')}
    </p>
  )
}

function ActivityConfirmBody({
  run,
  plannedIntent,
  onConfirm,
  onReassign,
  onDismiss,
}: {
  run: RunSessionSummary
  plannedIntent: string
  onConfirm: () => void
  onReassign: () => void
  onDismiss: () => void
}) {
  return (
    <>
      <p className="pb-2 text-[13px] text-muted-foreground italic leading-relaxed">
        {plannedIntent}
      </p>
      <div className="mb-3 rounded-md border border-teal/20 bg-teal/[0.04] px-3 py-2">
        <RunStatLine run={run} />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onConfirm}>Confirm</Button>
        <button
          type="button"
          className="min-h-[36px] rounded-full border border-border/50 px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground/80 active:bg-surface/30 active:text-foreground"
          onClick={onReassign}
        >
          Change
        </button>
        <button
          type="button"
          className="ml-auto text-[11px] uppercase tracking-wider text-muted-foreground/50 active:text-foreground"
          onClick={onDismiss}
        >
          Not training
        </button>
      </div>
    </>
  )
}

function OrphanRunBody({
  run,
  onReassign,
  onDismiss,
}: {
  run: RunSessionSummary
  onReassign: () => void
  onDismiss: () => void
}) {
  return (
    <>
      <p className="pb-2 text-[13px] text-muted-foreground italic leading-relaxed">
        Logged from Strava. No planned run to link to.
      </p>
      <div className="mb-3 rounded-md border border-gold/10 bg-near-black/30 px-3 py-2">
        <RunStatLine run={run} />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-h-[36px] rounded-full border border-gold/20 px-3 py-1.5 text-xs uppercase tracking-wider text-gold/80 active:bg-gold/10 active:text-gold"
          onClick={onReassign}
        >
          Assign
        </button>
        <button
          type="button"
          className="ml-auto text-[11px] uppercase tracking-wider text-muted-foreground/50 active:text-foreground"
          onClick={onDismiss}
        >
          Not training
        </button>
      </div>
    </>
  )
}
