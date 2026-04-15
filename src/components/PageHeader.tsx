import { Link } from 'react-router-dom'
import logoPng from '@/assets/brand/Logo.png'
import { GoldDivider } from '@/components/ui/GoldDivider'

interface PageHeaderProps {
  title: string
  children?: React.ReactNode
}

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/today" className="shrink-0">
            <img
              src={logoPng}
              alt="Waymark"
              width={24}
              height={24}
              className="h-6 w-6 object-contain opacity-50 transition-opacity active:opacity-80"
              style={{ mixBlendMode: 'screen' }}
            />
          </Link>
          <h2 className="text-display-lg text-foreground">{title}</h2>
        </div>
        {children}
      </div>
      <GoldDivider className="mt-3" />
    </div>
  )
}
