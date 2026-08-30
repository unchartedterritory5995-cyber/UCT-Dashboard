// app/src/pages/dashboard/useSessionState.js
import { useState, useEffect } from 'react'
import useMarketCalendar from '../../hooks/useMarketCalendar'

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

/** That same clock's ET calendar day as 'YYYY-MM-DD' — the key the market
 *  calendar is served in. Built from the LOCAL fields of an `etClock` Date, so
 *  it is the New York date regardless of where the browser is. */
const etDayKey = (et) =>
  `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`

/**
 * Is this ET day one the exchange actually opens on?
 *
 * ⛔ `holidays` IS A PARAMETER, NOT A TABLE IN THIS FILE. The repo's one NYSE
 * closure list lives in `api/services/bars_fetch.py` and is served by
 * `GET /api/market-calendar`; a copy here would be a second authority over one
 * value, and the year somebody refreshed only one copy the two would disagree
 * with nobody the wiser. `null` means "not known" and this returns the
 * weekend-only answer — which is why every CALLER of the unverified answer
 * has to suppress rather than print it.
 */
const isSessionDay = (et, holidays) => {
  const day = et.getDay()
  if (day === 0 || day === 6) return false
  return !(holidays && holidays.has(etDayKey(et)))
}

/** NYSE has never closed for two weeks; the walk below is bounded by this and
 *  reports failure rather than looping. */
const MAX_CLOSURE_WALK_DAYS = 14

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
 * close — as `{ kind: 'open'|'close', ms, dayKey }`, where `dayKey` is the ET
 * calendar day that boundary falls on.
 *
 * ⛔ NOT "the next state change". 00:00 Saturday is a state change
 * (CLOSED → WEEKEND) and counting down to it would be true and useless. The
 * question Zone A's pill answers is "how long have I got", and that is always
 * the next bell.
 *
 * ⭐ `dayKey` EXISTS SO THE COVERAGE CHECK ASKS THIS WALK, NOT A SECOND ONE.
 * The caller has to decide "is the day I landed on inside the table I was
 * served?", and a second walk to answer that would be a second authority over
 * the same question — the two would disagree the first time either changed.
 * It is `null` when the walk ran out of days, which is itself an answer:
 * refuse, don't guess.
 *
 * ⚠️ Arithmetic is done in ET wall-clock minutes, so a DST transition between
 * now and the boundary shifts the answer by an hour, twice a year. Naming it
 * beats a fake fix.
 */
export function resolveBoundary(date = new Date(), holidays = null) {
  const et = etClock(date)
  const mins = et.getHours() * 60 + et.getMinutes() + et.getSeconds() / 60

  if (isSessionDay(et, holidays)) {
    if (mins < MARKET_OPENS) {
      return { kind: 'open', ms: (MARKET_OPENS - mins) * 60_000, dayKey: etDayKey(et) }
    }
    if (mins < MARKET_CLOSES) {
      return { kind: 'close', ms: (MARKET_CLOSES - mins) * 60_000, dayKey: etDayKey(et) }
    }
  }

  // After the close, a weekend, or a day the exchange is shut: walk forward to
  // the next day that actually opens. ⛔ A DAY-BY-DAY WALK, not the old
  // `day === 5 ? 3 : day === 6 ? 2 : 1` arithmetic — that expression encodes
  // "the only reason tomorrow might not open is that it is a weekend", which
  // is exactly the false premise this change removes. With `holidays` null it
  // returns the identical answer for all seven days; with a calendar it also
  // steps over Thanksgiving, Christmas and a holiday-extended weekend.
  const probe = new Date(et)
  for (let i = 1; i <= MAX_CLOSURE_WALK_DAYS; i += 1) {
    probe.setDate(probe.getDate() + 1)
    if (isSessionDay(probe, holidays)) {
      return {
        kind: 'open',
        ms: (i * 1440 + MARKET_OPENS - mins) * 60_000,
        dayKey: etDayKey(probe),
      }
    }
  }
  return { kind: 'open', ms: null, dayKey: null }
}

/**
 * Back-compat shape: `{ kind, ms }` only.
 *
 * ⭐ A WRAPPER, NOT A COPY — it delegates to `resolveBoundary`, so there is one
 * walk. It exists because three test files and `Dashboard.session.test.jsx`
 * assert this exact object with `toEqual`, and widening the shape they pin
 * would be a breaking change to a contract, not an improvement to one.
 */
export function nextBoundary(date = new Date(), holidays = null) {
  const { kind, ms } = resolveBoundary(date, holidays)
  return { kind, ms }
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
 * Ticking companion to `useSessionState` — `{ kind, ms, label, verified }`,
 * re-derived every minute so the countdown actually counts down.
 *
 * ⛔ A SEPARATE HOOK, NOT A WIDER RETURN FROM `useSessionState`. That hook
 * returns a STRING and three call sites destructure it as one; widening it
 * would be a breaking change to a shape `Dashboard.session.test.jsx` mocks.
 * It also would not have worked: `useSessionState`'s interval calls `setS`
 * with the same string 1,439 times a day, React bails out of the re-render,
 * and a countdown derived from it would sit frozen on the value it was first
 * rendered with.
 *
 * 🔴 EVERY FIELD IS NULL UNTIL THE ANSWER IS VERIFIABLE, AND THAT IS THE FIX.
 * The countdown used to be computed from weekends and clock hours alone, so on
 * Thanksgiving the paid home said "Opens in 16h 16m" — to the minute, and
 * false. The calendar now comes from the server (`useMarketCalendar` →
 * `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD`, the repo's one closure list), and
 * until it lands, or if it fails, or if the boundary lands past the horizon
 * the table is authoritative about, this returns nulls and Zone A draws no
 * countdown at all.
 *
 * ⛔ `kind` IS NULLED TOO, not just `ms`. At 11:00 on Thanksgiving an
 * unverified read says `kind: 'close'` — "the session ends in 5h" — which is a
 * wrong sentence even with no number attached. Handing back a half-answer is
 * how a caller ends up printing the half that is wrong.
 *
 * ⭐ THE HORIZON CHECK IS WHY THIS DOES NOT ROT. `_NYSE_HOLIDAYS_YYYYMMDD`
 * carries a hand-maintained "refresh annually" contract; the year nobody
 * refreshes it, `covers_through` stops moving, boundaries walk past it, and the
 * countdown DISAPPEARS instead of quietly going holiday-blind again. A stale
 * calendar that still answers is worse than none — this one stops answering.
 *
 * ⚠️ THE COST: for the ~100ms before the calendar lands, and for as long as
 * that endpoint is down, there is no countdown on Zone A. That is deliberate.
 * The session pill beside it still names the state, which is the load-bearing
 * half; a missing countdown is not wrong, and a shown one might be.
 */
export function useNextBoundary() {
  const { holidays, coversThrough, known } = useMarketCalendar()
  // ⭐ THE CLOCK IS THE STATE, NOT THE ANSWER. Storing the derived boundary
  // (the old shape) meant it could only be recomputed by the interval — so the
  // calendar arriving mid-minute would not have re-derived anything. Ticking
  // `now` re-derives on BOTH the interval and the fetch landing.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const b = resolveBoundary(now, holidays)
  // `dayKey === null` means the walk ran out of days; `> coversThrough` means
  // we walked past what the table can speak for. Both are "cannot verify".
  const verified = known && b.dayKey != null && b.dayKey <= coversThrough && b.ms != null
  if (!verified) return { kind: null, ms: null, label: null, verified: false }
  return {
    kind: b.kind,
    ms: b.ms,
    label: `${b.kind === 'open' ? 'Opens' : 'Closes'} in ${formatCountdown(b.ms)}`,
    verified: true,
  }
}
