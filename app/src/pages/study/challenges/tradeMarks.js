// THE TRADE ON THE CHART, every mode (the owner, batch 24 on the lesson: "the visual graphic of the chart ... can also
// list the levels and action items in the chart as well ... so they can see it all by looking at the chart"). The levels
// are dashed lines with their price on the scale (ENTRY gold, STOP red, the targets green); the action items sit on the
// bars where they happened (BOUGHT, the targets reached, STOPPED OUT). What each level is and why it sits there is the
// chart key directly under the chart (ui/ChartKey.jsx): the floating level chips it replaces overlapped each other and
// ran under the price scale.
export function tradeAnnotations(trade, signal, all, n) {
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
  // the action items, on the bars where they happened
  const at = (s2) => (s2 == null ? null : all[n - 1 + s2] || null)
  const mark = (id, bar, text, color, below) => {
    if (!bar) return
    out.push({ id, type: 'text', points: [{ time: bar.t, price: below ? bar.l * 0.982 : bar.h * 1.018 }], text, color: '#0b0b0f', fontSize: 11, bgEnabled: true, bgColor: color, borderEnabled: false })
  }
  if (plan) {
    const long = trade.long
    mark('hard-act-in', at(0), long ? `▲ BOUGHT ${trade.entry.toFixed(2)}` : `▼ SHORTED ${trade.entry.toFixed(2)}`, GOLD, long)
    if (trade.t1At != null && trade.t1At !== 0) mark('hard-act-t1', at(trade.t1At), '✓ 2R', GREEN, !long)
    if (trade.t2At != null && trade.t2At !== 0) mark('hard-act-t2', at(trade.t2At), '✓ 3R', GREEN, !long)
    if (trade.stoppedSession) mark('hard-act-stop', at(trade.stoppedSession), '✕ STOPPED OUT', RED, long)
  } else if (trade.broke) {
    mark('hard-act-broke', at(trade.broke), trade.short ? '✕ CLOSED OVER THE LINE' : '✕ CLOSED UNDER THE LINE', RED, !trade.short)
  }
  return out.length ? out : null
}

