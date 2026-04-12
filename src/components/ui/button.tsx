import { type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const variants = {
  default: 'bg-gold text-near-black font-semibold active:scale-[0.98] active:opacity-90 shadow-[inset_0_0_0_2px_var(--color-near-black),0_0_0_1px_var(--color-gold)]',
  secondary: 'bg-secondary text-secondary-foreground border-l-2 border-l-gold font-semibold active:scale-[0.98] active:opacity-80',
  ghost: 'text-muted-foreground font-medium active:bg-secondary',
  destructive: 'bg-destructive text-foreground font-semibold active:scale-[0.98] active:opacity-80',
  outline: 'border border-gold/60 bg-transparent text-foreground font-medium active:bg-surface shadow-[0_0_0_1px_var(--color-gold-dark)]',
}

const sizes = {
  default: 'min-h-[52px] px-6 py-3 text-sm',
  sm: 'min-h-[36px] px-3 py-1.5 text-xs',
  lg: 'min-h-[60px] px-8 py-4 text-base',
  icon: 'h-10 w-10',
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  disabled,
  style,
  ...props
}: ButtonProps) {
  const isDisplay = variant === 'default'
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center transition-all disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none',
        isDisplay && 'uppercase tracking-wide',
        variants[variant],
        sizes[size],
        className
      )}
      style={{
        fontFamily: isDisplay ? "var(--font-display)" : undefined,
        ...style,
      }}
      disabled={disabled}
      {...props}
    />
  )
}
