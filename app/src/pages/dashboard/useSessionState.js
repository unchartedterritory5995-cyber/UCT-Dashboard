// app/src/pages/dashboard/useSessionState.js
import { useState, useEffect } from 'react'

/**
 * The dashboard's four composition states. Only Zone B varies by state.
 *
 * ⛔ Deliberately NOT an extension of useMarketOpen(): that hook's
 * {isOpen, isPremarket, isExtended} shape has other consumers, and it
 * cannot express WEEKEND, which is the state this redesign exists to serve.
 * useMarketOpen.js uses the identical toLocaleString→re-parse ET conversion
 * trick and the identical 4:00/9:30/16:00 boundaries — this is a deliberate
 * sibling, not a divergent reimplementation.
 */
export function resolveSession(date = new Date()) {
  const et = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  if (day === 0 || day === 6) return 'WEEKEND'
  const mins = et.getHours() * 60 + et.getMinutes()
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'PREMARKET'
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'LIVE'
  return 'CLOSED'
}

export default function useSessionState() {
  const [s, setS] = useState(() => resolveSession())
  useEffect(() => {
    const id = setInterval(() => setS(resolveSession()), 60_000)
    return () => clearInterval(id)
  }, [])
  return s
}
