import type { MouseEvent } from 'react'

interface FormVideoLinkProps {
  url: string
  /** Icon-only affordance — used inside active session views. */
  compact?: boolean
}

function PlayTriangle({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 1.5 L8 5 L2.5 8.5 Z" />
    </svg>
  )
}

export function FormVideoLink({ url, compact = false }: FormVideoLinkProps) {
  function stopBubble(e: MouseEvent) {
    e.stopPropagation()
  }

  if (compact) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopBubble}
        aria-label="Watch form video on YouTube"
        className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center text-teal/80 active:text-teal"
      >
        <PlayTriangle className="h-4 w-4" />
      </a>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stopBubble}
      aria-label="Watch form video on YouTube"
      className="inline-flex items-center gap-1.5 font-cinzel text-xs font-medium tracking-wider text-teal active:text-teal/70"
    >
      <PlayTriangle className="h-3.5 w-3.5" />
      Watch form ›
    </a>
  )
}
