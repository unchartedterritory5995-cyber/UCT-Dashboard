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
// ⚡ (2026-11-26, the board switch) ONE CALENDAR READ PER WALL-CLOCK MINUTE. Every chart pane, header clock and session
// badge mounts its own copy of this hook, and each read the NYSE calendar on mount (2.1 ms of a board switch on
// production's build). The session changes only on a minute boundary (04:00, 09:30, 16:00 or the 13:00 early close,
// 20:00 ET; ET is a whole number of hours from UTC), so the state read in one minute IS that minute's state: read once,
// frozen, shared by every hook that asks in that minute (useMarketOpen.minuteCache.test.js).
let _minuteState = { minute: NaN, state: null }
function getMarketState() {
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  if (_minuteState.minute === minute && _minuteState.state) return _minuteState.state
  const s = sessionState(new Date(now))
  const state = Object.freeze({
    isOpen: s.isOpen,
    isPremarket: s.isPremarket,
    isExtended: s.isExtended,
    isHalfDay: s.isHalfDay,
  })
  _minuteState = { minute, state }
  return state
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
