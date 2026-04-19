import type { MouseEvent } from 'react'

interface FormVideoLinkProps {
  url: string
  variant: 'icon' | 'pill'
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

export function FormVideoLink({ url, variant }: FormVideoLinkProps) {
  function stopBubble(e: MouseEvent) {
    e.stopPropagation()
  }

  if (variant === 'icon') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopBubble}
        aria-label="Watch form video on YouTube"
        className="ml-3 inline-block p-1.5 align-middle text-teal/70 active:text-teal"
      >
        <PlayTriangle className="h-3.5 w-3.5" />
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
      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-teal/30 bg-teal/10 px-4 font-cinzel text-[11px] font-medium uppercase tracking-[0.2em] text-teal/90 active:bg-teal/20"
    >
      <PlayTriangle className="h-3 w-3" />
      Watch
    </a>
  )
}
