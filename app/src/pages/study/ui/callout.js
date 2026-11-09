// THE POINTER, ROUND 21 (owner, batch 21, on the round-20 spotlight and chip: "I want the arrow and the text box changed
// i give those both 11/100"; his standing words: "an arrow that is logically spaced to the left and pointing at the
// candle" (batch 1), "the labels and the arrows further away and a different design" (batch 12), "ensure that it doesnt
// interfere with candles" (batch 18)). The chart's own callout layer (ChartCalloutOverlay `look`) finds open space
// around the candle, never over another candle, and draws a pill with the label, a leader with an arrowhead that stops
// short of the candle, and a ring drawn round the candle itself. Once the run-on reaches the move's furthest point, a
// second, gold callout marks it with the measured move ("+23.4% in 14 sessions").

export const POINTER = Object.freeze({
  ask: { color: '#dcbb5e', textColor: '#f6e2a0' },
  ok: { color: '#2faf68', textColor: '#b5f2cf' },
  bad: { color: '#df4646', textColor: '#ffc2c2' },
  peak: { color: '#dcbb5e', textColor: '#f6e2a0' },
})

// kit v2 (2026-11-08; batch 24: "the graphics highlighting the candle can be just a bit better and cooler"): a bolder
// ring and leader, a stronger glow, a firmer pill edge
const BASE = {
  pill: true, uppercase: true, ring: true, arrow: true, fill: 'rgba(9, 9, 11, .96)', borderWidth: 1.75,
  ringWidth: 2.4, lineWidth: 2.2,
}

/** The look on a desktop and on a phone (a phone packs ~4 px per bar, so everything is a size smaller). */
export function calloutLook(phone = false) {
  return phone
    ? { ...BASE, font: '800 10px "Instrument Sans", system-ui, sans-serif', letterSpacing: '1.2px', textH: 12, padX: 10, padY: 6, ringPad: 4, arrowSize: 8, gap: 4, glow: 14, bottomFrac: 0.74, distances: [22, 30, 40, 52, 66, 84, 104, 130, 160, 195, 235] }
    : { ...BASE, font: '800 12px "Instrument Sans", system-ui, sans-serif', letterSpacing: '1.6px', textH: 14, padX: 14, padY: 7, ringPad: 5, arrowSize: 11, gap: 6, glow: 22, distances: [34, 44, 56, 70, 88, 110, 136, 168, 206, 250, 300] }
}

/** The callouts for one Hard chart: the signal candle (`index` into the bars the chart shows) with `label` in the
 *  verdict's colour (`tone` ask | ok | bad), and, when `peak` is given ({ index, text }), the culmination in gold. */
export function hardCallouts({ index, label, tone = 'ask', peak = null }) {
  if (!(index >= 0) || !label) return []
  const out = [{ index, text: label, ...(POINTER[tone] || POINTER.ask) }]
  if (peak && peak.index >= 0 && peak.index !== index && peak.text) {
    out.push({ index: peak.index, text: peak.text, ...POINTER.peak, ring: false })
  }
  return out
}
