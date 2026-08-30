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
/** ⭐ THE BOUNDARIES, WRITTEN ONCE. `resolveSession` and `nextBoundary` below
 *  both read these; two hand-typed copies of 09:30 is how one of them drifts. */
const PREMARKET_OPENS = 4 * 60        // 04:00 ET
const MARKET_OPENS = 9 * 60 + 30      // 09:30 ET
const MARKET_CLOSES = 16 * 60         // 16:00 ET

/** The ET wall-clock as a Date whose LOCAL fields are the New York fields. */
const etClock = (date) =>
  new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }))

export function resolveSession(date = new Date()) {
  const et = etClock(date)
  const day = et.getDay()
  if (day === 0 || day === 6) return 'WEEKEND'
  const mins = et.getHours() * 60 + et.getMinutes()
  if (mins >= PREMARKET_OPENS && mins < MARKET_OPENS) return 'PREMARKET'
  if (mins >= MARKET_OPENS && mins < MARKET_CLOSES) return 'LIVE'
  return 'CLOSED'
}

/**
 * The next SESSION boundary a member cares about — the next open, or the next
 * close — as `{ kind: 'open'|'close', ms }`.
 *
 * ⛔ NOT "the next state change". 00:00 Saturday is a state change
 * (CLOSED → WEEKEND) and counting down to it would be true and useless. The
 * question Zone A's pill answers is "how long have I got", and that is always
 * the next bell.
 *
 * ⚠️ HOLIDAYS ARE NOT KNOWN HERE, exactly as `resolveSession` does not know
 * them — so a holiday Monday counts down to an open that will not happen. That
 * is a pre-existing gap in this module (the spec's state table says "Sat/Sun
 * and market holidays"), carried deliberately rather than papered over with a
 * second, half-right calendar.
 *
 * ⚠️ Arithmetic is done in ET wall-clock minutes, so a DST transition between
 * now and the boundary shifts the answer by an hour, twice a year. Naming it
 * beats a fake fix.
 */
export function nextBoundary(date = new Date()) {
  const et = etClock(date)
  const day = et.getDay()
  const mins = et.getHours() * 60 + et.getMinutes() + et.getSeconds() / 60
  const isWeekday = day >= 1 && day <= 5

  if (isWeekday && mins < MARKET_OPENS) {
    return { kind: 'open', ms: (MARKET_OPENS - mins) * 60_000 }
  }
  if (isWeekday && mins < MARKET_CLOSES) {
    return { kind: 'close', ms: (MARKET_CLOSES - mins) * 60_000 }
  }
  // After the close, or a weekend: the next weekday's open.
  // Fri(5) → +3, Sat(6) → +2, Sun(0) → +1, Mon-Thu → +1.
  const daysAhead = day === 5 ? 3 : day === 6 ? 2 : 1
  return { kind: 'open', ms: (daysAhead * 1440 + MARKET_OPENS - mins) * 60_000 }
}

/** `2d 17h` · `2h 14m` · `14m` · `now`. Compact enough for a 120px zone. */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const totalMin = Math.floor(ms / 60_000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function useSessionState() {
  const [s, setS] = useState(() => resolveSession())
  useEffect(() => {
    const id = setInterval(() => setS(resolveSession()), 60_000)
    return () => clearInterval(id)
  }, [])
  return s
}

/**
 * Ticking companion to `useSessionState` — `{ kind, ms, label }`, re-derived
 * every minute so the countdown actually counts down.
 *
 * ⛔ A SEPARATE HOOK, NOT A WIDER RETURN FROM `useSessionState`. That hook
 * returns a STRING and three call sites destructure it as one; widening it
 * would be a breaking change to a shape `Dashboard.session.test.jsx` mocks.
 * It also would not have worked: `useSessionState`'s interval calls `setS`
 * with the same string 1,439 times a day, React bails out of the re-render,
 * and a countdown derived from it would sit frozen on the value it was first
 * rendered with.
 */
export function useNextBoundary() {
  const [b, setB] = useState(() => nextBoundary())
  useEffect(() => {
    const id = setInterval(() => setB(nextBoundary()), 60_000)
    return () => clearInterval(id)
  }, [])
  return { ...b, label: `${b.kind === 'open' ? 'Opens' : 'Closes'} in ${formatCountdown(b.ms)}` }
}
