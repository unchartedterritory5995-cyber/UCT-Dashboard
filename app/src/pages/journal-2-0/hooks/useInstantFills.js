/**
 * useInstantFills — "the journal knows about my trade before I switch tabs".
 *
 * On mount and on window focus (throttled), asks the backend to poll the
 * member's Recent Orders NOW (POST /api/j2/broker/fills/check — shared
 * 5-min per-account budget with the background sweep, market hours only).
 * When new fills landed, every open positions/trades/analytics view is
 * revalidated immediately instead of waiting for its own poll interval.
 */
import { useEffect, useRef } from 'react'
import { useSWRConfig } from 'swr'

const THROTTLE_MS = 60_000

export default function useInstantFills({ enabled = true } = {}) {
  const { mutate } = useSWRConfig()
  const lastRun = useRef(0)

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true

    const check = async () => {
      const now = Date.now()
      if (now - lastRun.current < THROTTLE_MS) return
      lastRun.current = now
      try {
        const r = await fetch('/api/j2/broker/fills/check', {
          method: 'POST', credentials: 'include',
        })
        if (!r.ok || !alive) return
        const out = await r.json()
        if (out?.newFills > 0) {
          // Revalidate every journal data view that renders fills.
          mutate(
            (key) => typeof key === 'string' && (
              key.startsWith('/api/j2/positions')
              || key.startsWith('/api/j2/trades')
              || key.startsWith('/api/j2/analytics')
              || key.startsWith('/api/j2/broker/status')
            ),
            undefined, { revalidate: true },
          )
        }
      } catch {
        /* best-effort — background sweep still covers it */
      }
    }

    check()
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled, mutate])
}
