import { useEffect, useState, type MouseEvent } from 'react'

interface FormVideoLinkProps {
  url: string
  /** Icon-only affordance — used inside active session views. */
  compact?: boolean
}

const IS_DEMO =
  (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env
    .VITE_DEMO_MODE === 'true'

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

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1) || null
    if (u.hostname.includes('youtube.com')) {
      return u.searchParams.get('v') ?? u.pathname.split('/').pop() ?? null
    }
    return null
  } catch {
    return null
  }
}

function VideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const id = youtubeId(url)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Form video"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 px-4 py-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-10 right-0 text-sm text-foreground/80 hover:text-foreground"
          aria-label="Close video"
        >
          Close · Esc
        </button>
        <div
          className="relative w-full overflow-hidden rounded-md border border-border bg-black"
          style={{ aspectRatio: '16 / 9' }}
        >
          {id ? (
            <iframe
              src={`https://www.youtube.com/embed/${id}?autoplay=1&rel=0`}
              title="Form video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ width: '100%', height: '100%', border: 0 }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-foreground/70">
              Video unavailable. Open the original link from a non-demo build.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function FormVideoLink({ url, compact = false }: FormVideoLinkProps) {
  const [open, setOpen] = useState(false)

  function handleClick(e: MouseEvent) {
    e.stopPropagation()
    if (IS_DEMO) {
      e.preventDefault()
      setOpen(true)
    }
  }

  const sharedProps = {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    onClick: handleClick,
    'aria-label': 'Watch form video on YouTube',
  } as const

  return (
    <>
      {compact ? (
        <a
          {...sharedProps}
          className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center text-teal/80 active:text-teal"
        >
          <PlayTriangle className="h-4 w-4" />
        </a>
      ) : (
        <a
          {...sharedProps}
          className="inline-flex items-center gap-1.5 font-cinzel text-xs font-medium tracking-wider text-teal active:text-teal/70"
        >
          <PlayTriangle className="h-3.5 w-3.5" />
          Watch form ›
        </a>
      )}
      {open && <VideoModal url={url} onClose={() => setOpen(false)} />}
    </>
  )
}
