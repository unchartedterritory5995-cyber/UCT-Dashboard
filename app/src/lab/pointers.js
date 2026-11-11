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

/** THE POINTER (round 7, "a production and cooler look"; round 10: the chip can never clip). A thick gold arrow
 *  with a big head pointing at the candle's body from the left, the label as a gold chip in capitals sitting just
 *  above the arrow's tail, and a soft halo around the candle when a bar follows it. The chip used to be lifted a
 *  full candle height above the arrow, which pushed it out of the price range for the topmost candle (batch 9,
 *  Spot-the-trap: the Kicker's chip clipped); it now sits a third of a candle above the shaft, inside the range
 *  the candle itself already occupies. `locked` marks every piece so an editable chart cannot move them. */
export function spot(bars, i, { label = 'this candle', color = '#dcbb5e', id = 'spot', gap = 11, halo = true, locked = true, chip = true } = {}) {
  if (!bars || i < 0 || i >= bars.length) return []
  const b = bars[i]
  const price = (b.o + b.c) / 2
  const from = bars[Math.max(0, i - gap)]
  const out = [{ id: `${id}-arrow`, type: 'arrow', points: [{ time: from.t, price }, { time: bars[Math.max(0, i - 2)].t, price }], color, lineWidth: 2, arrowSize: 14, locked }]
  if (chip && label) {
    const at = bars[Math.max(0, i - gap - Math.max(3, Math.ceil(label.length / 3)))]
    const lift = Math.max(b.h - b.l, Math.abs(b.c) * 0.012) * 0.5
    out.push({ id: `${id}-chip`, type: 'text', points: [{ time: at.t, price: price + lift }], text: ` ${label.toUpperCase()} `, color, fontSize: 11, bgEnabled: true, bgColor: 'rgba(11,11,11,.88)', borderEnabled: true, borderColor: color, locked })
  }
  if (halo && i > 0 && i + 1 < bars.length) out.push(...haloAt(bars, i, { id: `${id}-halo`, color, locked }))
  return out
}

/** A ring around candle `i` (needs a bar on each side). `swell` 0..1 widens it; `solid` thickens it. */
export function haloAt(bars, i, { id = 'halo', color = '#dcbb5e', swell = 0, solid = false, locked = true } = {}) {
  if (!bars || i <= 0 || i + 1 >= bars.length) return []
  const b = bars[i]
  const pad = (b.h - b.l) * (0.3 + swell * 0.35)
  return [{ id, type: 'circle', points: [{ time: bars[i - 1].t, price: b.h + pad }, { time: bars[i + 1].t, price: b.l - pad }], color, lineWidth: solid ? 3 : 1.5 + swell, locked }]
}

/** A box around candle `i`: the selected candle's highlight. */
export function boxAt(bars, i, { id = 'box', color = '#dcbb5e', locked = true } = {}) {
  if (!bars || i < 0 || i >= bars.length) return []
  const b = bars[i]
  const l = bars[Math.max(0, i - 1)], r = bars[Math.min(bars.length - 1, i + 1)]
  const pad = (b.h - b.l) * 0.18
  return [{ id, type: 'rect', points: [{ time: l.t, price: b.h + pad }, { time: r.t, price: b.l - pad }], color, lineWidth: 2, locked }]
}

/** A quiet tag for a level line (round 13, owner: "the labels get in the way ... further away ... a different design"):
 *  small caps on a near-black plate with a hairline in the line's colour, sitting at the LEFT edge of the window so
 *  the candles stay clear. `t` is the time to anchor at (the first visible bar). */
export function tag(t, price, text, color, id, { size = 11 } = {}) {
  return { id, type: 'text', points: [{ time: t, price }], text: ` ${text.toUpperCase()} `, color, fontSize: size, bgEnabled: true, bgColor: 'rgba(11,11,11,.88)', borderEnabled: true, borderColor: color, locked: true }
}
