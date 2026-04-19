import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import logoPng from '@/assets/brand/Logo.png'
import { GoldDivider } from '@/components/ui/GoldDivider'

interface PageHeaderProps {
  title: string
  children?: React.ReactNode
  /** If provided, a long-press on the logo fires this instead of routing to /today. */
  onLogoLongPress?: () => void
}

const LONG_PRESS_MS = 600

export function PageHeader({ title, children, onLogoLongPress }: PageHeaderProps) {
  const firstChar = title.charAt(0)
  const rest = title.slice(1)
  const navigate = useNavigate()
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  function startPress() {
    if (!onLogoLongPress) return
    longPressed.current = false
    pressTimer.current = setTimeout(() => {
      longPressed.current = true
      onLogoLongPress()
    }, LONG_PRESS_MS)
  }
  function endPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }
  function handleClick(e: React.MouseEvent) {
    if (longPressed.current) {
      e.preventDefault()
      longPressed.current = false
      return
    }
    if (onLogoLongPress) {
      e.preventDefault()
      navigate('/today')
    }
  }

  return (
    <div
      className="sticky top-0 z-30 -mx-4 mb-4 bg-background/85 px-4 pb-3 backdrop-blur-md"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link
          to="/today"
          className="shrink-0 select-none"
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onPointerLeave={endPress}
          onClick={handleClick}
        >
          <img
            src={logoPng}
            alt="Waymark"
            width={40}
            height={40}
            className="h-10 w-10 object-contain opacity-60 transition-opacity active:opacity-90"
            style={{ mixBlendMode: 'screen' }}
            draggable={false}
          />
        </Link>
        <h2 className="min-w-0 flex-1 truncate text-display-sm text-foreground">
          <span className="text-gold">{firstChar}</span>
          {rest}
        </h2>
      </div>
      {children && <div className="mt-2 flex justify-end">{children}</div>}
      <GoldDivider className="mt-3" />
    </div>
  )
}
