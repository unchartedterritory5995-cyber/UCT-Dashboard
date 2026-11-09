/**
 * lineChoices — "Which line is ...?" questions (owner 2026-11-07 asked for drawings): the item names two or three
 * horizontal levels in `prompt_json.chart.lines` ([{ label: 'A', price, from }]), and the chart draws each one as a
 * dashed ray from its `from` day with a small label chip ("A", "B", "C") near the right edge. The member answers
 * "Line A" / "Line B" / "Line C" (a plain choice question: RecallDrill scores it like any other).
 *
 * Before the answer every line wears its own neutral colour (never the setup gold, which on Study charts means "the
 * level the setup is about"); after the answer the keyed line turns gold and the others fade, so the reveal says which
 * one it was without a word. The reviewer's card (studyOverlays) draws the revealed state. Pure: no React, no fetch.
 */

const NEUTRAL = ['#93c5fd', '#c4b5fd', '#f9a8d4']
const GOLD = '#dcbb5e'
const FADED = 'rgba(148, 163, 184, 0.45)'
const LABEL_INSET = 6                 // the chip sits this many bars in from the right edge

export function linesOf(item) {
  const lines = item?.prompt_json?.chart?.lines
  return Array.isArray(lines) ? lines.filter((l) => l && l.label && Number.isFinite(Number(l.price))) : []
}

export function hasLines(item) {
  return linesOf(item).length > 0
}

/** "Line B" -> "B"; anything else -> null. */
export function keyedLabel(revealOrKey) {
  const a = typeof revealOrKey === 'string' ? revealOrKey : revealOrKey?.answer
  const m = /^Line\s+([A-Z])$/i.exec(String(a || '').trim())
  return m ? m[1].toUpperCase() : null
}

function dayKey(v) {
  if (v == null) return null
  const s = String(v)
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s.slice(0, 10)
}

/**
 * The drawings for an item's lines on its bars. `revealed` (the scored answer's reveal, or true on the reviewer's card)
 * turns the keyed line gold. Returns null when the item has no lines or there are no bars.
 */
export function lineAnnotations(item, bars, revealed = null) {
  const lines = linesOf(item)
  const list = Array.isArray(bars) ? bars : []
  if (!lines.length || !list.length) return null
  const key = revealed ? keyedLabel(revealed === true ? item?.answer_json : revealed?.answer ?? revealed) : null
  const firstT = list[0].t
  const labelT = list[Math.max(0, list.length - 1 - LABEL_INSET)].t
  const out = []
  lines.forEach((ln, i) => {
    const price = Number(ln.price)
    const from = dayKey(ln.from)
    const startT = (from && list.find((b) => dayKey(b.t) >= from)?.t) || firstT
    const label = String(ln.label).toUpperCase()
    const color = key ? (label === key ? GOLD : FADED) : NEUTRAL[i % NEUTRAL.length]
    out.push({
      id: `study-line-${label}`, type: 'hray', points: [{ time: startT, price }],
      color, lineWidth: key && label === key ? 2 : 1, lineStyle: 'dashed', showPriceLabel: !!key,
    })
    out.push({
      id: `study-line-${label}-chip`, type: 'text', points: [{ time: labelT, price }], text: label,
      color: '#0b0b0f', fontSize: 12, bgEnabled: true, bgColor: color, borderEnabled: false,
    })
  })
  return out
}
