// Pure render-planning helpers for StockChart — the Phase-A "feel pass" core.
//
// Why this exists: updateChart() historically did a full setData() on EVERY
// series (candle + volume + every MA overlay + every indicator + markers) each
// time filteredBars got a new identity — which during market hours is every ~30s
// poll that carries a changed developing bar. That wholesale repaint of ~8 series
// twice a minute is the dominant "jumpy/child-built" tell.
//
// These functions are pure and unit-tested so the correctness-critical decision
// ("can I safely do an incremental last-bar update, or must I fully repaint?")
// lives outside the 6000-line component and can't silently regress. The bar `t`
// is treated as an OPAQUE key: intraday t is unix seconds, daily/weekly/monthly t
// is an ISO date string — equality is all we need, never arithmetic.

/**
 * Decide how to apply `nextBars` given what was last painted (`prevBars`).
 *
 * Returns { mode, lastBar? }:
 *   - 'noop':        structurally identical → paint nothing.
 *   - 'incremental': same length, same timestamps, and ONLY the last bar's
 *                    OHLCV differs → series.update(lastBar) + recompute the
 *                    overlay/indicator TAILS. `lastBar` is the new last bar.
 *   - 'full':        anything else (first paint, empty, length change, a rolled
 *                    last timestamp, or ANY interior/historical bar changed) →
 *                    full setData. Interior changes MUST be full: an incremental
 *                    last-bar update would leave a stale interior candle on screen
 *                    (a reconciliation correction to bar N-5 would be invisible).
 *
 * Correctness bias: when in any doubt, return 'full'. A needless full repaint is
 * a wasted frame; a wrong incremental update is a visible data bug.
 */
export function barsRenderPlan(prevBars, nextBars) {
  const n = nextBars ? nextBars.length : 0
  const p = prevBars ? prevBars.length : 0

  // First paint, a clear, or a length change → full.
  if (n === 0) return { mode: 'full' }
  if (p === 0) return { mode: 'full' }
  if (p !== n) return { mode: 'full' }

  // Equal length: compare bar-by-bar. All bars except possibly the last MUST be
  // identical for an incremental update to be safe. Track whether the last bar
  // changed. Any interior difference forces 'full'.
  let lastChanged = false
  for (let i = 0; i < n; i++) {
    const a = prevBars[i]
    const b = nextBars[i]
    const same = a && b
      && a.t === b.t
      && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c && a.v === b.v
    if (same) continue
    if (i === n - 1) {
      // The differing bar is the last one. It only qualifies as an incremental
      // developing-bar update if the TIMESTAMP is unchanged (same bucket ticked);
      // a changed last timestamp means the bar rolled over → full (a plain
      // update() at the new time would spawn a phantom next to the old one).
      if (a && b && a.t === b.t) { lastChanged = true; continue }
      return { mode: 'full' }
    }
    // An interior bar differs → must fully repaint.
    return { mode: 'full' }
  }

  if (!lastChanged) return { mode: 'noop' }
  return { mode: 'incremental', lastBar: nextBars[n - 1] }
}

/**
 * Cheap change-signature for a LightweightCharts line/area series ({time,value}[]).
 * Mirrors the proven index-pane guard already in StockChart.jsx: length + sampled
 * {time,value} at start/mid/end + an `extra` token for the settings that affect the
 * series (period, color mode, etc.). If a series' signature is unchanged since its
 * last draw, skip its setData — this stops overlays/indicators from being fully
 * re-uploaded on a repaint that didn't actually change their values.
 *
 * Not a hash of every point (that would defeat the purpose) — a sampled fingerprint.
 * Collisions are astronomically unlikely for real MA/indicator series and the cost
 * of a miss is one needless redraw, never a wrong chart.
 */
export function seriesSig(data, extra = '') {
  const len = data ? data.length : 0
  if (!len) return `0|${extra}`
  const first = data[0]
  const mid = data[len >> 1]
  const last = data[len - 1]
  return [
    len,
    first?.time, first?.value,
    mid?.time, mid?.value,
    last?.time, last?.value,
    extra,
  ].join('|')
}
