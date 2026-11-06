// THE POINTER (round 18; owner, batch 18: "This arrow and text should be dramatically improved and ensure that it doesnt
// interfere with candles on the chart"). A callout that lives in the clear: a vertical arrow dropping onto the candle
// from above — or rising from below when the candle sits at the top of its window — with the chip parked past the
// highest high (lowest low) of every bar under its footprint, so neither the chip nor the shaft ever crosses a candle.
// Pure: records for the chart's own drawings layer (never drawn by hand on top), computed from the bars in hand and
// measured in the WINDOW's range, which is what the pane's own margins are measured in, so the chip stays inside the
// pane (round 10 ruling: "the chip can never clip").
export const CHIP_CHAR_PX = 6.6   // about one 11px capital, with the chip's own padding folded in via the spaces around the text

/**
 * callout(bars, i, opts) → drawings. `view` is how many of `bars` the chart shows (the window ends at the newest bar);
 * `barPx` is the chart's pixels per bar (the phone packs ~4, a desktop column ~6-7), which sets how many bars the chip
 * spans; `overhang` lets the chip run that many bars past the candle into the chart's right padding.
 */
export function callout(bars, i, { label = 'this candle', color = '#dcbb5e', id = 'spot', view = 90, barPx = 6.6, overhang = 2, locked = true } = {}) {
  if (!bars || i < 0 || i >= bars.length) return []
  const b = bars[i]
  const shown = bars.slice(Math.max(0, bars.length - Math.max(1, view)))
  let top = -Infinity, bot = Infinity
  for (const x of shown) { if (x.h > top) top = x.h; if (x.l < bot) bot = x.l }
  const range = Math.max(top - bot, Math.abs(b.c) * 0.01, 1e-9)
  const text = ` ${String(label).toUpperCase()} `
  const chipBars = Math.max(3, Math.ceil((text.length * CHIP_CHAR_PX) / Math.max(1, barPx)))
  const start = Math.max(0, Math.min(i, i - chipBars + 1 + overhang))
  const span = bars.slice(start, i + 1)
  let highest = -Infinity, lowest = Infinity
  for (const x of span) { if (x.h > highest) highest = x.h; if (x.l < lowest) lowest = x.l }
  // above by default; below when the chip's footprint reaches the top of the window or the candle sits high in it
  const below = (top - highest) < range * 0.045 || (b.h - bot) > range * 0.72
  const room = below ? lowest - bot : top - highest
  const gap = range * 0.012
  const shaft = Math.min(0.055, Math.max(0.03, room / range)) * range
  const lift = range * 0.065                       // the chip's box hangs down from its anchor and tucks over the shaft's tail
  const head = below ? b.l - gap : b.h + gap
  const tail = below ? Math.min(head - shaft, lowest - gap - shaft) : Math.max(head + shaft, highest + gap + shaft)
  const chipAt = below ? tail : tail + lift
  return [
    { id: `${id}-arrow`, type: 'arrow', points: [{ time: b.t, price: tail }, { time: b.t, price: head }], color, lineWidth: 2, arrowSize: 12, locked },
    { id: `${id}-chip`, type: 'text', points: [{ time: bars[start].t, price: chipAt }], text, color, fontSize: 11, bgEnabled: true, bgColor: 'rgba(11,11,11,.9)', borderEnabled: true, borderColor: color, locked },
  ]
}

/** Which side the callout took, for a rail or a caption: 'above' | 'below' | null. */
export function calloutSide(drawings, bars, i) {
  const arrow = (drawings || []).find((d) => d && d.type === 'arrow')
  if (!arrow || !bars || !bars[i]) return null
  return arrow.points[1].price >= bars[i].h ? 'above' : 'below'
}
