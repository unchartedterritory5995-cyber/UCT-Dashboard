/**
 * The Rotation lens's three pairs, kept framework-free so both the lens and
 * `theRead.js` read one table.
 *
 * ⛔ `risingIsBull` IS DECLARED PER PANEL, NEVER INFERRED FROM THE RAW SIGN.
 *
 * A uniform `delta >= 0 ? bull : bear` is only right where rising IS the good
 * direction, and the third panel inverts: for `vol_spread`, rising means
 * "Narrowing — tech vol bid over the broad market". So a rising VXN−VIX drew a
 * GREEN number and a GREEN sparkline directly above a sentence reading
 * *Narrowing*. Each panel already states what rising means in its own `up`
 * copy; the colour is driven from that same declaration, so it cannot
 * contradict the sentence beneath it.
 */
export const ROTATION_PANELS = [
  { key: 'rsp_spy_ratio', label: 'Equal vs Cap', sub: 'RSP / SPY', risingIsBull: true,
    up: 'Broadening — the average stock is gaining on the index',
    down: 'Narrowing — the index is carried by its largest names',
    read: r => r.rsp_spy_ratio },
  { key: 'iwm_qqq_ratio', label: 'Small vs Large', sub: 'IWM / QQQ', risingIsBull: true,
    up: 'Broadening — small caps leading',
    down: 'Narrowing — large caps leading',
    read: r => r.iwm_qqq_ratio },
  { key: 'vol_spread', label: 'Vol Spread', sub: 'VXN − VIX', risingIsBull: false,
    up: 'Narrowing — tech vol bid over the broad market',
    down: 'Broadening — tech vol easing toward the market',
    read: r => (r.vxn == null || r.vix == null ? null : Number(r.vxn) - Number(r.vix)) },
]

/**
 * ⛔ THE SPAN MEASURED IS THE SPAN PRINTED. `series[Math.min(lookback, len-1)]`
 * silently compared against the OLDEST available row and still printed "/60d",
 * implying history the lens never read. `measured` is the number of sessions
 * the change actually covers, and it is what the label, the footer and The
 * Read all state.
 */
export const rotationMeasured = (lookback, winLength) =>
  Math.min(Number(lookback), Math.max(0, winLength - 1))

/**
 * One panel's reading over a newest-first window: today's value, the value
 * `measured` sessions back, and the change between them. `null` when either end
 * is missing — the lens prints an em dash, The Read omits its clause.
 */
export function rotationReading(win = [], panel, lookback) {
  if (!panel || !win.length) return null
  const measured = rotationMeasured(lookback, win.length)
  const now = panel.read(win[0])
  const prior = measured > 0 ? panel.read(win[measured]) : null
  if (now == null || prior == null || isNaN(Number(now)) || isNaN(Number(prior))) return null
  const delta = Number(now) - Number(prior)
  return {
    key: panel.key, label: panel.label, sub: panel.sub, measured,
    now: Number(now), prior: Number(prior), delta,
    // The panel's OWN sentence for this direction — the lens prints it verbatim
    // beneath the sparkline, so The Read quotes it rather than paraphrasing.
    verdict: delta >= 0 ? panel.up : panel.down,
    risingIsBull: panel.risingIsBull,
  }
}

/**
 * The one word the panel's own sentence leads with — "Broadening" / "Narrowing".
 * Taken from the declared copy rather than stored beside it, so a rewrite of
 * that copy moves this with it instead of leaving a second, stale, opinion.
 */
export const rotationWord = (verdict) => String(verdict ?? '').split(/[\s—-]/)[0].toLowerCase()

// Below this many readings a fence is fitted to too little data to mean
// anything, so the domain is simply the observed range.
export const TRACE_FENCE_MIN_N = 8

// Linear-interpolated quantile of an ASCENDING array. Exported only so the
// domain below has one authority for "the 25th"; nothing else should need it.
const quantile = (sorted, p) => {
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * ⭐ THE DRAWN DOMAIN, AND WHY IT IS NOT min…max.
 *
 * These three series are ratios oscillating in a narrow band. Scaling them to
 * their own min…max hands the whole height of the plot to whichever session ran
 * furthest — one VXN print, one thin RSP close — and presses the other eighty-
 * nine flat against the floor. The trace then reads as a spike over a dead
 * line, which is a claim about the data that the data does not make.
 *
 * So the domain is a Tukey fence (q1 − 1.5·IQR … q3 + 1.5·IQR) INTERSECTED with
 * the observed range. That intersection is the load-bearing half: when no
 * reading lies outside the fence — the ordinary case — the fence is wider than
 * the data and the domain comes back as exactly min…max. Nothing is trimmed,
 * nothing is hidden, and a well-behaved series is drawn precisely as it was
 * before. Only a genuine outlier moves the axis.
 *
 * ⛔ AND THE DOMAIN ALWAYS CONTAINS THE NUMBERS THE PANEL PRINTS. The reading
 * and the reference it is measured from are both stated in words beside the
 * trace; a domain that excluded either would put the panel's own headline off
 * its own axis. They are passed in as `pins` and the fence is widened to hold
 * them.
 *
 * ⛔ AND A TRIMMED AXIS SAYS SO. `clipped` counts the sessions outside the
 * drawn domain, and the panel prints that count with the full span beside it.
 * A silently trimmed axis is a lie the shape tells: a run pressed flat against
 * the ceiling would read as a plateau. Every session keeps its own tooltip with
 * its true value either way.
 */
export function traceDomain(values = [], pins = []) {
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  const vals = values.map(num).filter(v => v != null)
  if (!vals.length) return { lo: 0, hi: 1, clipped: 0, min: null, max: null }

  const sorted = [...vals].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  let lo = min
  let hi = max
  if (sorted.length >= TRACE_FENCE_MIN_N) {
    const q1 = quantile(sorted, 0.25)
    const q3 = quantile(sorted, 0.75)
    const iqr = q3 - q1
    // A zero IQR means the middle half is one value — a fence off it would
    // collapse the axis onto that value and clip everything else.
    if (iqr > 0) {
      lo = Math.max(min, q1 - 1.5 * iqr)
      hi = Math.min(max, q3 + 1.5 * iqr)
    }
  }
  for (const p of pins.map(num)) {
    if (p == null) continue
    lo = Math.min(lo, p)
    hi = Math.max(hi, p)
  }

  const clipped = vals.filter(v => v < lo || v > hi).length
  // A flat series still needs a box to draw in, and `(v - lo) / 0` is the NaN
  // the registry's no-NaN rail exists to catch.
  if (!(hi > lo)) {
    const pad = Math.abs(hi) * 0.005 || 0.5
    return { lo: lo - pad, hi: hi + pad, clipped, min, max }
  }
  return { lo, hi, clipped, min, max }
}
