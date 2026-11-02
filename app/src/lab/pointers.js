// Ways the chart points at a candle, as records for StockChart's own drawings layer (never drawn by hand on top).
export const GOLD = '#d9b84a'

/** A horizontal arrow sitting to the LEFT of bar `i`, pointing right at its body, plus a label further left
 *  (owner 2026-11-02: "an arrow that is logically spaced to the left and pointing at the candle"). */
export function arrowAt(bars, i, { label = '', color = GOLD, gap = 9, id = 'ptr' } = {}) {
  if (!bars || i < 0 || i >= bars.length) return []
  const b = bars[i]
  const price = (b.o + b.c) / 2
  const from = bars[Math.max(0, i - gap)]
  const to = bars[Math.max(0, i - 1)]
  const out = [{ id: `${id}-arrow`, type: 'arrow', points: [{ time: from.t, price }, { time: to.t, price }], color, lineWidth: 2.5, arrowSize: 15 }]
  if (label) {
    // the label sits ABOVE the arrow's tail, never on the shaft: up by about one candle height, anchored a few bars further left
    const at = bars[Math.max(0, i - gap - Math.max(4, Math.ceil(label.length / 3)))]
    const lift = Math.max(b.h - b.l, Math.abs(b.c) * 0.012) * 1.3
    out.push({ id: `${id}-label`, type: 'text', points: [{ time: at.t, price: price + lift }], text: label, color, fontSize: 13, bgEnabled: true, bgColor: '#141414cc' })
  }
  return out
}

/** A ray at a bar's low or high (the line a trade lives or dies by). */
export function rayAt(bar, which = 'l', { color = GOLD, id = 'ray', label = '' } = {}) {
  if (!bar) return []
  return [{ id, type: 'hray', points: [{ time: bar.t, price: bar[which] }], color, lineWidth: 1, lineStyle: 'dashed', label }]
}

export const pct = (a, b) => ((b - a) / a) * 100
