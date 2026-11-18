import useSWR from 'swr'
import { useEffect, useMemo, useState } from 'react'
import useMarketOpen from './useMarketOpen'

const isMobile = typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 640)

const MOBILE_POLL_FACTOR = 2

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

  // ⛔ MEMOISED BECAUSE SWR RESTARTS ITS TIMER WHEN THE INTERVAL'S IDENTITY CHANGES. A wrapper rebuilt
  // each render was restarted by the 60 s useMarketOpen re-render, so any touch timer over 60 s never
  // fired. No state, no subscription: this cannot add a commit. The function is told the multiplier so
  // a caller aiming at a moment in time can divide by it.
  const mobileInterval = useMemo(() => {
    if (!interval || !isMobile) return interval
    return typeof interval === 'function'
      ? (d) => interval(d, MOBILE_POLL_FACTOR) * MOBILE_POLL_FACTOR
      : interval * MOBILE_POLL_FACTOR
  }, [interval])

  return useSWR(key, fetcher, {
    ...options,
    refreshInterval: visible ? mobileInterval : 0,  // Stop polling when tab is hidden
    revalidateOnFocus: options.revalidateOnFocus ?? false,
  })
}
