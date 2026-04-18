import { PageHeader } from '@/components/PageHeader'

interface SkeletonProps {
  className?: string
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** Pulse phase offset in ms so stacked bars breathe out of sync */
  delay?: number
}

const ROUNDED = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
} as const

export function Skeleton({ className = '', rounded = 'md', delay = 0 }: SkeletonProps) {
  return (
    <div
      className={`animate-skeleton-pulse bg-muted ${ROUNDED[rounded]} ${className}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      aria-hidden="true"
    />
  )
}

function SkeletonCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gold/10 bg-card/60 p-4 ${className}`}>
      {children}
    </div>
  )
}

// ─── Page-tailored skeletons ──────────────────────────────────

export function TodaySkeleton() {
  return (
    <div
      className="relative flex flex-col gap-5 pb-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]"
      aria-label="Loading today"
      aria-busy="true"
    >
      {/* Date header */}
      <div className="flex flex-col items-center gap-2 py-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-6 w-40" delay={120} />
      </div>

      {/* Wellness prompt card */}
      <SkeletonCard>
        <Skeleton className="mb-3 h-3 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1" delay={80} />
          <Skeleton className="h-10 flex-1" delay={160} />
          <Skeleton className="h-10 flex-1" delay={240} />
        </div>
      </SkeletonCard>

      {/* Journal card */}
      <SkeletonCard>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8" rounded="full" />
          <Skeleton className="h-4 flex-1" delay={100} />
        </div>
      </SkeletonCard>

      {/* Timeline session rows */}
      <div className="space-y-3">
        {[0, 120, 240].map((d, i) => (
          <SkeletonCard key={i}>
            <div className="flex items-start gap-3">
              <Skeleton className="mt-1 h-10 w-10" rounded="full" delay={d} />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" delay={d + 60} />
                <Skeleton className="h-3 w-2/5" delay={d + 120} />
              </div>
              <Skeleton className="h-6 w-16" delay={d + 180} />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  )
}

export function HistorySkeleton() {
  return (
    <div className="pb-4" aria-label="Loading ledger" aria-busy="true">
      <PageHeader title="Ledger" />

      {/* Completion rings row */}
      <div className="mb-5 flex justify-around px-4">
        {[0, 100, 200, 300].map((d, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <Skeleton className="h-14 w-14" rounded="full" delay={d} />
            <Skeleton className="h-2.5 w-10" delay={d + 60} />
          </div>
        ))}
      </div>

      {/* Insight callout */}
      <div className="mb-4 px-4">
        <SkeletonCard>
          <Skeleton className="mb-2 h-3 w-20" />
          <Skeleton className="h-3 w-full" delay={80} />
          <Skeleton className="mt-1.5 h-3 w-4/5" delay={160} />
        </SkeletonCard>
      </div>

      {/* Momentum grid 2x2 */}
      <div className="mb-4 grid grid-cols-2 gap-3 px-4">
        {[0, 80, 160, 240].map((d, i) => (
          <SkeletonCard key={i}>
            <Skeleton className="mb-2 h-2.5 w-12" delay={d} />
            <Skeleton className="h-6 w-20" delay={d + 60} />
            <Skeleton className="mt-1.5 h-2 w-16" delay={d + 120} />
          </SkeletonCard>
        ))}
      </div>

      {/* Detail chart cards */}
      <div className="space-y-3 px-4">
        {[0, 160].map((d, i) => (
          <SkeletonCard key={i}>
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-4 w-24" delay={d} />
              <Skeleton className="h-3 w-16" delay={d + 80} />
            </div>
            <Skeleton className="h-24 w-full" delay={d + 140} />
          </SkeletonCard>
        ))}
      </div>
    </div>
  )
}

export function LibrarySkeleton() {
  return (
    <div aria-label="Loading library" aria-busy="true">
      <PageHeader title="Library" />

      {/* Search input */}
      <div className="mb-5 px-1">
        <Skeleton className="h-10 w-full" />
      </div>

      {/* Category sections */}
      <div className="space-y-4">
        {[0, 120, 240, 360].map((d, i) => (
          <div key={i}>
            <div className="mb-2 flex items-center justify-between px-1">
              <Skeleton className="h-3 w-28" delay={d} />
              <Skeleton className="h-3 w-6" delay={d + 60} />
            </div>
            <div className="space-y-2">
              {[0, 80, 160].map((d2, j) => (
                <div
                  key={j}
                  className="flex items-center gap-3 rounded-md border border-gold/5 bg-card/40 px-3 py-2.5"
                >
                  <Skeleton className="h-4 flex-1" delay={d + d2} />
                  <Skeleton className="h-3 w-10" delay={d + d2 + 40} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProgramSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading program" aria-busy="true">
      {/* Block/week header */}
      <div className="flex items-baseline justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-40" delay={80} />
        </div>
        <Skeleton className="h-8 w-20" delay={160} />
      </div>

      {/* Week nav */}
      <div className="flex gap-2">
        {[0, 60, 120].map((d, i) => (
          <Skeleton key={i} className="h-8 flex-1" delay={d} />
        ))}
      </div>

      {/* Day cards (7 days) */}
      <div className="space-y-2">
        {[0, 80, 160, 240, 320, 400, 480].map((d, i) => (
          <SkeletonCard key={i}>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-10" delay={d} />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/5" delay={d + 60} />
                <Skeleton className="h-3 w-2/5" delay={d + 120} />
              </div>
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  )
}

export function SettingsSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading settings" aria-busy="true">
      <PageHeader title="Settings" />

      {/* Days until redeploy pill */}
      <Skeleton className="h-7 w-40" />

      {/* MT Class Days */}
      <section>
        <Skeleton className="mb-2 h-3.5 w-28" />
        <div className="flex gap-2">
          {[0, 40, 80, 120, 160, 200, 240].map((d, i) => (
            <Skeleton key={i} className="h-9 flex-1" delay={d} />
          ))}
        </div>
      </section>

      {/* Reminder rows */}
      <section>
        <Skeleton className="mb-2 h-3.5 w-24" />
        <div className="space-y-3">
          {[0, 120].map((d, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" delay={d} />
              <Skeleton className="h-10 w-full" delay={d + 60} />
            </div>
          ))}
        </div>
      </section>

      {/* Technique toggles grid */}
      <section>
        <Skeleton className="mb-2 h-3.5 w-32" />
        <div className="grid grid-cols-2 gap-2">
          {[0, 60, 120, 180, 240, 300].map((d, i) => (
            <Skeleton key={i} className="h-10 w-full" delay={d} />
          ))}
        </div>
      </section>
    </div>
  )
}
