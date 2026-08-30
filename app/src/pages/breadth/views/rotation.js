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
