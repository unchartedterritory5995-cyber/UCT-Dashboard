// THE TRADE ON THE CHART, every mode (the owner, batch 24 on the lesson: "the visual graphic of the chart ... can also
// list the levels and action items in the chart as well ... so they can see it all by looking at the chart"). The levels
// are dashed lines with their price on the scale (ENTRY gold, STOP red, the targets green); the action items sit on the
// bars where they happened (BOUGHT, the targets reached, STOPPED OUT). What each level is and why it sits there is the
// chart key directly under the chart (ui/ChartKey.jsx): the floating level chips it replaces overlapped each other and
// ran under the price scale.
// THE ACTION ITEMS (2026-11-08, found on the phone screens: text boxes drawn on the chart ran under the price scale,
// landed on each other and, kept clear of the candles, floated away from their own bar on a trend). They are the chart's
// own bar markers now: an arrow or a dot AT the bar with a short word, which the chart stacks when two share a bar and
// keeps inside the price area, so they never cover a candle, never leave their bar and hold still as the replay runs.
// What each one means, and its price, is the key under the chart.
export function tradeAnnotations(trade, signal, all) {
  if (!trade || !signal || !all?.length) return null
  const t0 = signal.t
  const plan = trade.kind === 'plan'
  const GOLD = '#dcbb5e', RED = '#df4646', GREEN = '#2faf68'
  const lines = plan
    ? [['ENTRY', trade.entry, GOLD], ['STOP', trade.stop, RED], ['2R', trade.t1, GREEN], ['3R', trade.t2, GREEN]]
    : [[trade.short ? 'MUST STAY UNDER' : 'MUST HOLD', trade.line, RED]]
  const out = []
  for (const [label, price, color] of lines) {
    if (!Number.isFinite(price)) continue
    out.push({ id: `hard-${label}`, type: 'hray', points: [{ time: t0, price }], color, lineWidth: label === 'ENTRY' || label === 'STOP' ? 2 : 1.5, lineStyle: 'dashed', showPriceLabel: true })
  }
  return out.length ? out : null
}

/** The trade's action items as the chart's bar markers, on the bars the chart shows so far: BOUGHT (or SHORTED) at the
 *  signal, 2R and 3R where they traded, STOPPED where the stop was hit; a signal-only trade marks where it broke its line.
 *  `n` = the bars before the run-on (the signal is bar n - 1). */
export function tradeMarkers(trade, all, n) {
  if (!trade || !all?.length || !(n >= 1)) return null
  const GOLD = '#dcbb5e', RED = '#ef5350', GREEN = '#2faf68'
  const out = []
  const at = (s) => (Number.isFinite(s) ? all[n - 1 + s] : null)
  const put = (s, m) => { const b = at(s); if (b) out.push({ time: b.t, size: 1.4, ...m }) }
  if (trade.kind === 'plan') {
    const long = trade.long
    put(0, { position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: GOLD, text: long ? 'BOUGHT' : 'SHORTED' })
    if (trade.t1At) put(trade.t1At, { position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: GREEN, text: '2R' })
    if (trade.t2At) put(trade.t2At, { position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: GREEN, text: '3R' })
    if (trade.stoppedSession) put(trade.stoppedSession, { position: long ? 'belowBar' : 'aboveBar', shape: 'square', color: RED, text: 'STOPPED' })
  } else if (trade.broke) {
    put(trade.broke, { position: trade.short ? 'aboveBar' : 'belowBar', shape: 'square', color: RED, text: trade.short ? 'CLOSED OVER' : 'CLOSED UNDER' })
  }
  // the chart wants them in time order; 2R and 3R on the signal day itself (t1At 0) are said by the key
  return out.length ? out.sort((a, b) => String(a.time).localeCompare(String(b.time))) : null
}
