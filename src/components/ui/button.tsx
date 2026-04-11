import { type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const variants = {
  default: 'bg-primary text-primary-foreground active:opacity-80',
  secondary: 'bg-secondary text-secondary-foreground active:opacity-80',
  ghost: 'text-muted-foreground active:bg-secondary',
  destructive: 'bg-destructive text-foreground active:opacity-80',
  outline: 'border border-border bg-transparent text-foreground active:bg-secondary',
}

const sizes = {
  default: 'min-h-[48px] px-6 py-3 text-sm font-semibold',
  sm: 'min-h-[36px] px-3 py-1.5 text-xs font-medium',
  lg: 'min-h-[56px] px-8 py-4 text-base font-bold',
  icon: 'h-10 w-10',
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-xl transition-all disabled:opacity-40',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled}
      {...props}
    />
  )
}
