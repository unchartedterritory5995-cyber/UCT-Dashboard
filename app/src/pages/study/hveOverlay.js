/**
 * hveOverlay — the two drawings every High Volume Edge study chart carries
 * (owner ruling 2026-10-25: "slap a horizontal ray on the close of the HVC
 * candle and also put an AVWAP on it from the HVC candle day").
 *
 *   • a horizontal ray from the HVE candle's close (the HVC, the level the
 *     biggest participants committed at) running to the right edge;
 *   • an anchored VWAP starting on the HVE candle.
 *
 * Both are ordinary chart drawings for StockChart's `annotations` prop (the
 * same read-only layer the Model Book uses), so nothing new is rendered: the
 * overlay already knows `hray` and `avwap`. The HVE candle is the item's
 * cutoff bar (`item.asof`, the last bar the member sees); when the bars carry
 * no bar for that date the last visible bar is used, and the forward strip
 * (appended on reveal) is what the AVWAP then runs through.
 *
 * Pure: no React, no fetch. The drill shows the layer on reveal only (the
 * question is whether the HVE fires on that bar; the ray and the AVWAP are
 * the lesson, not a hint); the review screen shows it whenever the item is
 * an HVE item.
 */

export const HVE_SKILL_ID = 'setup.family3.hve'
export const HVE_SETUP_NAME = 'High Volume Edge'

const GOLD = '#dcbb5e'
const AVWAP_INK = '#7fb8ff'

/** Is this study item a High Volume Edge example? Reads the skill first, the setup name second. */
export function isHveItem(item) {
  if (!item) return false
  if (item.skill_id === HVE_SKILL_ID) return true
  const name = item.reveal_json?.facts?.setup || item.reveal_json?.setup || item.prompt_json?.setup
  return typeof name === 'string' && name.trim().toLowerCase() === HVE_SETUP_NAME.toLowerCase()
}

function asofKey(item) {
  const a = item?.asof
  if (a == null) return null
  const s = String(a)
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return s.slice(0, 10)
}

function visibleCount(item) {
  const b = item?.bars
  if (Array.isArray(b?.bars)) return b.bars.length
  if (Array.isArray(b)) return b.length
  return 0
}

/**
 * The HVE candle: the bar dated `item.asof`, else the last bar of the visible
 * window (the bars the member saw before the forward strip), else the last bar.
 */
export function hveAnchorBar(item, bars) {
  const list = Array.isArray(bars) ? bars : []
  if (!list.length) return null
  const key = asofKey(item)
  if (key) {
    const hit = list.find((b) => String(b.t).slice(0, 10) === key)
    if (hit) return hit
  }
  const n = visibleCount(item)
  if (n > 0 && n <= list.length) return list[n - 1]
  return list[list.length - 1]
}

/** The two drawings for StockChart's `annotations` layer, or null when there is no anchor bar. */
export function hveAnnotations(item, bars) {
  const bar = hveAnchorBar(item, bars)
  // `Number(null)` is 0, a finite number: a missing close must stay a missing close, never a ray at zero.
  if (!bar || bar.c == null || bar.c === '' || !Number.isFinite(Number(bar.c))) return null
  const close = Number(bar.c)
  return [
    {
      id: 'study-hvc-ray', type: 'hray', points: [{ time: bar.t, price: close }],
      color: GOLD, lineWidth: 2, lineStyle: 'dashed', showPriceLabel: true,
    },
    {
      id: 'study-hve-avwap', type: 'avwap', points: [{ time: bar.t }],
      color: AVWAP_INK, lineWidth: 2, lineStyle: 'solid',
    },
  ]
}
