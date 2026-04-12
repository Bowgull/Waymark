import { useNavigate, type NavigateOptions } from 'react-router-dom'
import { useCallback } from 'react'

export function useViewTransitionNavigate() {
  const navigate = useNavigate()

  return useCallback(
    (to: string, options?: NavigateOptions) => {
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          navigate(to, options)
        })
      } else {
        navigate(to, options)
      }
    },
    [navigate]
  )
}
