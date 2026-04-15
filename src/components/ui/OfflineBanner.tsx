import { useNetworkStatus } from '@/lib/network'

export function OfflineBanner() {
  const online = useNetworkStatus()

  if (online) return null

  return (
    <div className="fixed top-[env(safe-area-inset-top)] left-0 right-0 z-[100] flex items-center justify-center bg-[#C45A3C]/90 px-4 py-2">
      <p className="text-xs font-medium tracking-wide text-white">
        You're offline -- data will sync when connected
      </p>
    </div>
  )
}
