import { useSyncExternalStore } from 'react'
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
/** Tests: forget the minute's state (a test that mocks the calendar twice within one faked minute gets a fresh read). */
export function _resetMarketStateCacheForTests() { _minuteState = { minute: NaN, state: null } }

// ⚡ (2026-11-27, chart speed; ruling 4c) ONE TIMER, ON THE MINUTE BOUNDARY. Every consumer mounted its own 60 s
// setInterval (about 1.5 ms of each chart mount on the owner's board), each on the phase of its own mount, so after 09:30
// one badge could read "open" while another still read "pre" for up to a minute. One timer now fires at each wall-clock
// minute boundary and every consumer reads that minute's state in the same commit: the same values, at the true
// boundary. Every consumer still renders once a minute (a clock reading the time in its render keeps ticking). The
// timer exists only while a consumer does (useMarketOpen.sharedTimer.test.jsx).
const _listeners = new Set()
let _timer = null
let _armedMinute = null
function _arm() {
  if (_timer != null || !_listeners.size) return
  const now = Date.now()
  _armedMinute = Math.floor(now / 60_000)
  _timer = setTimeout(_onMinute, 60_000 - (now % 60_000))
}
function _onMinute() {
  _timer = null
  if (!_listeners.size) return
  // still the minute it was armed in: it woke before the boundary, so it waits for it (a late wake still notifies)
  if (Math.floor(Date.now() / 60_000) !== _armedMinute) for (const cb of [..._listeners]) cb()
  _arm()
}
function _subscribe(cb) {
  _listeners.add(cb)
  _arm()
  return () => {
    _listeners.delete(cb)
    if (!_listeners.size && _timer != null) { clearTimeout(_timer); _timer = null }
  }
}

export default function useMarketOpen() {
  return useSyncExternalStore(_subscribe, getMarketState, getMarketState)
}
