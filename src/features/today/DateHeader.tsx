import { formatDateDisplay } from '@/lib/dates'
import logoPng from '@/assets/brand/Logo.png'
import { GoldDivider } from '@/components/ui/GoldDivider'

/** Stylized W with winged serif tips — gold brand mark */
function BrandW() {
  return (
    <svg
      width="32"
      height="27"
      viewBox="0 0 40 34"
      fill="#E8C860"
      xmlns="http://www.w3.org/2000/svg"
      className="relative"
      style={{ top: '3px' }}
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

export function DateHeader({ date }: { date: Date }) {
  return (
    <div className="mb-4">
      {/* Brand row: logo + name left, date right */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src={logoPng}
            alt="Waymark"
            className="h-14 w-14 object-contain animate-mark-breathe"
            style={{ mixBlendMode: 'screen' }}
          />
          <h1 className="flex items-baseline gap-0">
            <BrandW />
            <span
              className="text-foreground uppercase tracking-wide"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.15rem',
                fontWeight: 500,
                letterSpacing: '0.04em',
              }}
            >
              aymark
            </span>
          </h1>
        </div>

        <p className="text-sm text-muted-foreground">
          {formatDateDisplay(date)}
        </p>
      </div>

      <GoldDivider className="mt-3" />
    </div>
  )
}
