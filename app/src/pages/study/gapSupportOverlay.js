/**
 * gapSupportOverlay — the two lines every Gap Support study chart carries,
 * both rays from the gap day: the GAP-UP DAY LOW (gold, with the price label:
 * the level the setup is about, which should hold or be only slightly
 * breached, owner ruling 2026-10-26) and, fainter, the GAP-FILL SPOT (the
 * prior day's high, the level the firm's detector tests against; a fill that
 * reclaims is a lesser example, a fill that does not is a failed gap). The
 * zone the stock must defend is drawn, not imagined. The HVE chart carries its
 * level the same way (hveOverlay.js): the setup IS the level.
 *
 * The gap day comes from the item's facts (`gap_asof`, written by
 * scripts/study/find_gap_support_examples.py); the gap-up low is `gap_low`
 * when stored, else the gap bar's low; the gap-fill spot is `gap_top` when
 * stored, else the high of the bar before the gap bar. An item without a gap
 * date (the detector fixtures) carries no layer. Pure: no React, no fetch.
 */

export const GAP_SUPPORT_SKILL_ID = 'setup.family3.gap_support'
export const GAP_SUPPORT_SETUP_NAME = 'Gap Support'

const GOLD = '#dcbb5e'
const GOLD_SOFT = 'rgba(220, 187, 94, 0.55)'

/** Is this study item a Gap Support example? Reads the skill first, the setup name second. */
export function isGapSupportItem(item) {
  if (!item) return false
  if (item.skill_id === GAP_SUPPORT_SKILL_ID) return true
  const name = item.reveal_json?.facts?.setup || item.reveal_json?.setup || item.prompt_json?.setup
  return typeof name === 'string' && name.trim().toLowerCase() === GAP_SUPPORT_SETUP_NAME.toLowerCase()
}

function dayKey(v) {
  if (v == null) return null
  const s = String(v)
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return s.slice(0, 10)
}

/** The gap bar (dated facts.gap_asof) and the bar before it, or null. */
export function gapBars(item, bars) {
  const list = Array.isArray(bars) ? bars : []
  const key = dayKey(item?.reveal_json?.facts?.gap_asof)
  if (!key || !list.length) return null
  const i = list.findIndex((b) => dayKey(b.t) === key)
  if (i < 1) return null
  return { gap: list[i], prior: list[i - 1] }
}

/**
 * The two rays for StockChart's `annotations` layer, or null without a gap day.
 * Order is fixed (gap-fill spot first, gap-up low second); the emphasis is on
 * the gap-up low: gold, wider, and the only one with a price label.
 */
export function gapAnnotations(item, bars) {
  const g = gapBars(item, bars)
  if (!g) return null
  const facts = item?.reveal_json?.facts || {}
  const storedTop = Number(facts.gap_top)
  const storedLow = Number(facts.gap_low)
  const top = Number.isFinite(storedTop) && storedTop > 0 ? storedTop : Number(g.prior.h)
  const low = Number.isFinite(storedLow) && storedLow > 0 ? storedLow : Number(g.gap.l)
  if (!Number.isFinite(top) || !Number.isFinite(low)) return null
  return [
    {
      id: 'study-gap-top', type: 'hray', points: [{ time: g.gap.t, price: top }],
      color: GOLD_SOFT, lineWidth: 1, lineStyle: 'dashed',
    },
    {
      id: 'study-gap-low', type: 'hray', points: [{ time: g.gap.t, price: low }],
      color: GOLD, lineWidth: 2, lineStyle: 'dashed', showPriceLabel: true,
    },
  ]
}
