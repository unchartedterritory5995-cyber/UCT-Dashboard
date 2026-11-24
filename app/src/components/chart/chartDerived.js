// app/src/components/chart/chartDerived.js
//
// ─── THE PER-BAR ARRAYS STOCKCHART DERIVES FROM ITS BARS, AS PURE FUNCTIONS ─────────────────────────────
//
// Each of these was the body of a `useMemo` in StockChart.jsx, moved here unchanged so that ONE function
// answers both askers: the chart's own memo, and the neighbor-frames preparer (`useNeighborFrames.js`),
// which asks the same question of the next row's bars in idle time and files the answer under that bars
// array (`neighborFrames.deriveFrom`). Every input a body read from the component is now an argument;
// `p` is plain values only, so it can be named by content (`stableSig`).
//
// `times` (optional) is `neighborFrames.chartTimesFor(bars, adjustTime)`: `adjustTime(bars[i].t)` for
// every i, built once. Absent, each body converts each bar itself, exactly as it always did.

import { keepRthBars } from './barTime'
import { foldOffGridBars } from './offGridBars'

const timeAt = (bars, i, adjustTime, times) => (times ? times[i] : adjustTime(bars[i].t))

/**
 * StockChart `sessionBars`: an off-grid bar folded into its bucket (intraday), and the regular session
 * only when extended hours are off. The SAME array when the series is already clean.
 * @param {{intradayLike: boolean, isIntraday: boolean, showExtended: boolean, tf: string}} p
 */
export function sessionBarsOf(bars, p) {
  if (!bars || !p.intradayLike) return bars
  // An off-grid bar (trade-time stamped, e.g. 16:35:50 beside 16:35:00) is never its
  // own candle — folded into its bucket. Same array when the series is clean.
  const gridBars = p.isIntraday ? foldOffGridBars(bars, p.tf, { showExtended: p.showExtended }) : bars
  if (p.showExtended) return gridBars
  // Regular session = 09:30 to the day's close (13:00 on an NYSE half-day): barTime.isRthBar.
  // The same array when every bar already is (the server's rth answer): no 45,000-row copy.
  return keepRthBars(gridBars)
}

/**
 * StockChart `ohlcData`, its per-bar part: one candle point per bar, and on the sunrise canvas an INSIDE
 * BAR (its whole high–low within the previous bar's, wicks included) painted solid black. The tail
 * (session preview, load-anchor seeds) is applied by the chart over a COPY, never over this array.
 */
export function ohlcBaseOf(displayBars, sunrise, adjustTime, times = null) {
  const arr = displayBars.map((b, i) => ({ time: timeAt(displayBars, i, adjustTime, times), open: b.o, high: b.h, low: b.l, close: b.c }))
  // Sunrise: an INSIDE BAR (its whole high–low sits within the PREVIOUS bar's
  // high–low, wicks included) is painted solid black regardless of direction.
  // Data-level (uses displayBars directly) so it's deterministic for every bar,
  // including today's developing bar. The net-change paint wrapper preserves an
  // explicit color, so this black survives.
  if (sunrise) {
    for (let i = 1; i < arr.length; i++) {
      const cur = arr[i], prev = arr[i - 1]
      if (cur.high != null && cur.low != null && prev.high != null && prev.low != null
          && cur.high <= prev.high && cur.low >= prev.low) {
        arr[i] = { ...cur, color: '#000000', borderColor: '#000000', wickColor: '#000000' }
      }
    }
  }
  return arr
}

/**
 * StockChart `closeData`. Per-segment green/red for line & area in net-change / open-close modes; one
 * colour (and every non-line/area type, and a breadth line) stays a plain value series.
 * @param {{plain: boolean, mode: string, up: string, down: string}} p
 */
export function closeDataOf(displayBars, p, adjustTime, times = null) {
  if (p.plain) {
    return displayBars.map((b, i) => ({ time: timeAt(displayBars, i, adjustTime, times), value: b.c }))
  }
  let prevClose = null
  return displayBars.map((b, i) => {
    let up
    if (p.mode === 'netchange') up = prevClose == null ? true : b.c >= prevClose
    else up = (b.o != null) ? b.c >= b.o : true
    prevClose = b.c
    const col = up ? p.up : p.down
    // `color` is read by LineSeries, `lineColor` by AreaSeries — set both.
    return { time: timeAt(displayBars, i, adjustTime, times), value: b.c, color: col, lineColor: col }
  })
}

/** O(n) HVC detection via monotonic deque — replaces O(n × lookback) slice+spread (StockChart `hvcSet`). */
export function computeHVC(bars) {
  const hvcSet = new Set()
  const lb = Math.min(252, bars.length - 1)
  const startIdx = Math.max(20, lb)
  if (startIdx >= bars.length) return hvcSet
  // Monotonic decreasing deque: front holds index of max volume in window
  const deque = [] // [{idx, vol}]
  // Pre-fill deque with bars before the check window
  for (let i = 0; i < startIdx; i++) {
    const vol = bars[i].v || 0
    while (deque.length && deque[deque.length - 1].vol <= vol) deque.pop()
    deque.push({ idx: i, vol })
  }
  for (let i = startIdx; i < bars.length; i++) {
    const windowStart = Math.max(0, i - lb)
    // Expire elements outside the lookback window
    while (deque.length && deque[0].idx < windowStart) deque.shift()
    const vol = bars[i].v || 0
    // Front of deque = max of [windowStart .. i-1] (prior bars only)
    if (deque.length && vol > deque[0].vol) hvcSet.add(bars[i].t)
    // Maintain decreasing invariant
    while (deque.length && deque[deque.length - 1].vol <= vol) deque.pop()
    deque.push({ idx: i, vol })
  }
  return hvcSet
}

/**
 * StockChart `volData`: one volume point per bar, coloured like the candles (net change or open-close),
 * gold for the highest-volume-ever bar, the legacy HVC gold for a 52-week volume high.
 * @param {{blank: boolean, upC: string, downC: string, netChange: boolean, dwm: boolean, liveVol: number, bold: boolean}} p
 */
export function volDataOf(bars, p, hvcSet, volExtremes, adjustTime, times = null) {
  // blankVolume (breadth): feed the series WHITESPACE (time-only points). Nothing
  // draws, and a scale with no values renders no axis labels — so no flat 0-line and
  // no "0" tag, while the pane itself is still reserved. See the blankVolume prop.
  if (p.blank) return bars.map((b, i) => ({ time: timeAt(bars, i, adjustTime, times) }))
  const upC = p.upC
  const downC = p.downC
  const gold = '#e6b800'
  const lastIdx = bars.length - 1
  return bars.map((b, i) => {
    // Up/down follows the SAME rule as the candles: net change (close vs the
    // PREVIOUS close) when colorByNetChange is on, else close-vs-open. This is
    // why a gap-up-then-fade day (AEHR +22% on the day but red open→close) shows
    // a GREEN volume bar — it's up on net change. First bar has no prior close.
    const prevC = i > 0 ? bars[i - 1].c : b.o
    const isUp = p.netChange ? (b.c >= prevC) : (b.c >= b.o)
    // Developing (last) bar: prefer the live feed volume when it's ahead of the
    // fetched value (intraday volume only grows), so the pane tracks the
    // watchlist in real time. Historical bars keep their own volume.
    // Overlay the live DAY volume ONLY on D/W/M (where the developing bar spans
    // the whole day). On intraday the day total is NOT the bucket's volume.
    const useLiveDayVol = p.dwm && Number.isFinite(p.liveVol) && p.liveVol > (b.v || 0)
    const value = (i === lastIdx && useLiveDayVol) ? p.liveVol : b.v
    return {
      time: timeAt(bars, i, adjustTime, times),
      value,
      color: volExtremes?.goldTimes.has(b.t)        // HVE / HV1 bars → gold
        ? gold
        : (!p.bold && hvcSet.has(b.t))              // legacy HVC highlight
          ? 'rgba(201,168,76,0.9)'
          : isUp ? upC : downC,
    }
  })
}

/**
 * StockChart `volExtremes`: the highest-volume-ever bar across `bars`, as `{goldTimes: Set([its t])}`, or null when
 * there is none or it falls outside [entryDate, exitDate] (either bound absent = open).
 */
export function volExtremesOf(bars, entryDate, exitDate) {
  if (!bars?.length) return null
  const inYear = b => (!entryDate || b.t >= entryDate) && (!exitDate || b.t <= exitDate)
  let hve = null
  for (const b of bars) if (b.v != null && (!hve || b.v > hve.v)) hve = b
  if (!hve || !inYear(hve)) return null
  return { goldTimes: new Set([hve.t]) }
}

/** StockChart `volMaData`: the smooth N-SMA line for the volume pane. */
export function volMaDataOf(bars, period, adjustTime, times = null) {
  const out = []
  const q = []
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    const v = bars[i].v || 0
    q.push(v); sum += v
    if (q.length > period) sum -= q.shift()
    if (q.length === period) out.push({ time: timeAt(bars, i, adjustTime, times), value: sum / period })
  }
  return out
}
