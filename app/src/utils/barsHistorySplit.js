// Deep daily / weekly / monthly history from the edge (instant-charts Phase 5): the ONE switch and
// the sealed-date rule, shared by the legacy chart (components/chart/useLegacyChartBars.js, through
// StockChart's re-exports) and the BarStore (data/barStore/network.js, which also owns THE URL,
// `barsHistoryUrl`: bar URLs are built by the BarStore, rails/oneKey.census.test.js).
//
// A D/W/M chart asks the origin's /api/bars for its recent tail only (first-paint depth) and the
// deep SEALED history from /api/bars-history, which Cloudflare caches at the edge: immutable for a
// year when `d` names the server's current last sealed day (each new sealed day is a new URL, so it
// refreshes without a purge). The URL must be byte-identical across clients and the pre-warm sweep,
// or the pre-warmed edge object is missed: the full sealed depth (`fullBarsFor`, fixed per tf) and
// `d`, the newest held bar strictly before the current period.
//
// History of the switch (moved here from StockChart.jsx on 2026-11-16, unchanged): canaried
// 2026-08-31, ramped to 100% the same day (deep history from the worker's deep db, cached at the
// edge worldwide; GOOGL back to 2004, AMT to its 1999 IPO), paused 2026-09-02 for a render bug,
// re-ramped 25 -> 100 on 2026-09-03. Instant per-browser revert: localStorage
// 'uct.barsHistory.enabled'='0' or window.__uctBarsHistory(false). Spec:
// docs/superpowers/specs/2026-08-31-edge-deep-history.
import { isTradingDay, covers } from '../lib/marketClock/sessionCalendar'

export const BARS_HISTORY_SPLIT_ROLLOUT_PCT = 100

function _bucket() {
  try {
    let b = localStorage.getItem('uct.barsHistory.bucket')
    if (b == null) { b = String(Math.floor(Math.random() * 100)); localStorage.setItem('uct.barsHistory.bucket', b) }
    const n = parseInt(b, 10)
    return Number.isFinite(n) ? n : 100
  } catch { return 100 }  // no storage -> out of rollout (safe default-off)
}

export function barsHistorySplitEnabled() {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem('uct.barsHistory.enabled') : null
    if (ls === '1') return true     // explicit opt-in (canary)
    if (ls === '0') return false    // explicit opt-out
    return _bucket() < BARS_HISTORY_SPLIT_ROLLOUT_PCT
  } catch { return false }
}

export function setBarsHistorySplitEnabled(on) {
  try {
    if (on) localStorage.setItem('uct.barsHistory.enabled', '1')
    else localStorage.removeItem('uct.barsHistory.enabled')
    window.dispatchEvent(new Event('uct-barshistory-change'))
  } catch { /* ignore */ }
}
if (typeof window !== 'undefined') window.__uctBarsHistory = setBarsHistorySplitEnabled

/** 'YYYY-MM-DD' (ET) of the start of the CURRENT period of `tf`: today (D), this week's Monday (W),
 *  the 1st of this month (M). A bar dated before it is sealed. `nowMs` for tests. */
export function etPeriodStartISO(tf, nowMs = Date.now()) {
  try {
    const et = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }))
    if (tf === 'W') { const back = (et.getDay() + 6) % 7; et.setDate(et.getDate() - back) }
    else if (tf === 'M') { et.setDate(1) }
    const y = et.getFullYear(), m = String(et.getMonth() + 1).padStart(2, '0'), d = String(et.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  } catch { return '' }
}

/** The newest ISO date in `dates` (ascending or not) strictly before the current period, or ''. */
export function lastSealedDate(dates, tf, nowMs = Date.now()) {
  const cut = etPeriodStartISO(tf, nowMs)
  if (!cut || !Array.isArray(dates)) return ''
  let best = ''
  for (const d of dates) if (typeof d === 'string' && d.length === 10 && d < cut && d > best) best = d
  return best
}

/**
 * ⭐ THE DAILY `d` IS THE NYSE CALENDAR'S (2026-11-19). The last trading day strictly before today
 * (ET), from the same calendar file the server reads: api/routers/bars.py `calendar_last_sealed_day`
 * answers the same question the same way, and the worker's pre-warm sweep stamps every daily URL
 * with it. Read from held bars instead, `d` could not be known before the chart's own answer landed
 * (so the deep history was asked only after it, a second visible step), and it named a different URL
 * for a ticker that did not trade yesterday (a URL nothing pre-warmed). '' for W/M (their sealed
 * period stays the held-bars rule) and outside the calendar's coverage (the caller falls back).
 */
export function calendarSealedDate(tf, nowMs = Date.now()) {
  if (tf !== 'D') return ''
  const today = etPeriodStartISO('D', nowMs)
  if (!today) return ''
  let t = Date.parse(`${today}T12:00:00Z`)
  for (let i = 0; i < 14; i++) {
    t -= 86_400_000
    const day = new Date(t).toISOString().slice(0, 10)
    if (!covers(day)) return ''
    if (isTradingDay(day)) return day
  }
  return ''
}

/** The sealed date of a D/W/M history URL: the calendar's for D, else the newest held bar's rule. */
export function historySealedDate(tf, dates, nowMs = Date.now()) {
  return calendarSealedDate(tf, nowMs) || lastSealedDate(dates, tf, nowMs)
}
