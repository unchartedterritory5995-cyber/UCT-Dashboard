import useSWR from 'swr'
import { useEffect, useState } from 'react'
import useMarketOpen from './useMarketOpen'

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
  const { isOpen, isPremarket, isExtended } = useMarketOpen()

  let interval = options.refreshInterval

  // When marketHoursOnly is set and market is fully closed (not open, not premarket, not extended),
  // multiply interval by 10x to save battery and API calls on evenings/weekends
  if (options.marketHoursOnly && interval && !isOpen && !isPremarket && !isExtended) {
    interval = typeof interval === 'function'
      ? (...args) => interval(...args) * 10
      : interval * 10
  }

  const mobileInterval = interval && isMobile
    ? (typeof interval === 'function'
        ? (...args) => interval(...args) * 2
        : interval * 2)
    : interval

  return useSWR(key, fetcher, {
    ...options,
    refreshInterval: visible ? mobileInterval : 0,  // Stop polling when tab is hidden
    revalidateOnFocus: options.revalidateOnFocus ?? true,
  })
}
