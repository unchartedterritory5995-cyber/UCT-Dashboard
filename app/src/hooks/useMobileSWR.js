import useSWR from 'swr'
import { useEffect, useState } from 'react'

const isMobile = typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 640)

function usePageVisible() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const handler = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])
  return visible
}

export default function useMobileSWR(key, fetcher, options = {}) {
  const visible = usePageVisible()

  const mobileInterval = options.refreshInterval && isMobile
    ? (typeof options.refreshInterval === 'function'
        ? (...args) => options.refreshInterval(...args) * 2
        : options.refreshInterval * 2)
    : options.refreshInterval

  return useSWR(key, fetcher, {
    ...options,
    refreshInterval: visible ? mobileInterval : 0,  // Stop polling when tab is hidden
    revalidateOnFocus: options.revalidateOnFocus ?? true,
  })
}
