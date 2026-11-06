// THE POINTER (round 18, batch 18: "ensure that it doesnt interfere with candles"; round 19, batch 19: the arrow-and-chip
// callout Cut). A SPOTLIGHT, not an arrow: the candle's own column lit from the top of the pane to the bottom — a
// translucent band on the candle's time with a thin bright centre line — and a small chip parked in the pane's top
// margin, above every candle, whose right end meets the band. Nothing is drawn across another candle, and nothing
// points: the lit column IS the answer to "which candle". Pure: records for the chart's own drawings layer (never drawn
// by hand on top), computed from the bars in hand and measured in the WINDOW's range, which is what the pane's margins
// are measured in, so the chip stays inside the pane (round 10 ruling: "the chip can never clip").
export const CHIP_CHAR_PX = 6.6   // about one 11px capital, with the chip's own padding folded in via the spaces around the text

/**
 * spotlight(bars, i, opts) → drawings. `view` is how many of `bars` the chart shows (the window ends at the newest bar);
 * `barPx` is the chart's pixels per bar (a phone packs ~4, a desktop column ~6-7), which sets the band's width and how
 * many bars the chip spans; `overhang` lets the chip run that many bars past the candle into the chart's right padding.
 */
export function spotlight(bars, i, { label = 'this candle', color = '#dcbb5e', id = 'spot', view = 90, barPx = 6.6, overhang = 1, locked = true } = {}) {
  if (!bars || i < 0 || i >= bars.length) return []
  const b = bars[i]
  const shown = bars.slice(Math.max(0, bars.length - Math.max(1, view)))
  let top = -Infinity, bot = Infinity
  for (const x of shown) { if (x.h > top) top = x.h; if (x.l < bot) bot = x.l }
  const range = Math.max(top - bot, Math.abs(b.c) * 0.01, 1e-9)
  const text = ` ${String(label).toUpperCase()} `
  const chipBars = Math.max(3, Math.ceil((text.length * CHIP_CHAR_PX) / Math.max(1, barPx)))
  const start = Math.max(0, Math.min(i, i - chipBars + 1 + overhang))
  const band = Math.max(8, Math.round(barPx * 2.2))
  return [
    { id: `${id}-band`, type: 'vertical', points: [{ time: b.t, price: b.c }], color: withAlpha(color, 0.16), lineWidth: band, locked },
    { id: `${id}-line`, type: 'vertical', points: [{ time: b.t, price: b.c }], color: withAlpha(color, 0.55), lineWidth: 1, locked },
    { id: `${id}-chip`, type: 'text', points: [{ time: bars[start].t, price: top + range * 0.075 }], text, color, fontSize: 11, bgEnabled: true, bgColor: 'rgba(11,11,11,.9)', borderEnabled: true, borderColor: color, locked },
  ]
}

/** `#rrggbb` → `rgba(r,g,b,a)`; any other colour string is returned as is. */
export function withAlpha(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** The chip's anchor price for a rail: it sits above every candle in the window. */
export function spotlightChip(drawings) {
  return (drawings || []).find((d) => d && d.type === 'text') || null
}
