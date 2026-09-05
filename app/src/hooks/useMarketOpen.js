import { useState, useEffect } from 'react'
import { sessionState } from '../lib/marketClock/marketClock'

/**
 * Returns market session state, backed by S11 (Session & Market Clock)'s
 * real NYSE calendar — holidays and early closes, not a fixed weekday+hours
 * guess. Updates every 60 seconds.
 *
 * @returns {{ isOpen: boolean, isPremarket: boolean, isExtended: boolean, isHalfDay: boolean }}
 *   isOpen:      true during the regular session (9:30 AM - 4:00 PM ET, or
 *                9:30 AM - 1:00 PM ET on an early-close day), trading days only
 *   isPremarket: true during 4:00 AM - 9:30 AM ET, trading days only
 *   isExtended:  true during close - 8:00 PM ET, trading days only
 *   isHalfDay:   true on an NYSE early-close trading day
 *
 * ⛔ This hook's returned SHAPE is a locked consumer contract —
 * `sessionModel.js`, `MarketClock.jsx`, and `ChartMarketClock.jsx` all read
 * it, and S8's `<FreshnessBadge>` session-context rendering goes through
 * the same chain. `isOpen`/`isPremarket`/`isExtended` must never be renamed;
 * new fields (like `isHalfDay`) are additive-only.
 */
function getMarketState() {
  const s = sessionState(new Date())
  return {
    isOpen: s.isOpen,
    isPremarket: s.isPremarket,
    isExtended: s.isExtended,
    isHalfDay: s.isHalfDay,
  }
}

export default function useMarketOpen() {
  const [state, setState] = useState(getMarketState)

  useEffect(() => {
    const id = setInterval(() => {
      setState(getMarketState())
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  return state
}
