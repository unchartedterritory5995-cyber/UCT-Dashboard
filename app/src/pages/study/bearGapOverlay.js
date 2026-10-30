/**
 * bearGapOverlay — the two lines every Bear Gap off the Highs study chart
 * carries, both rays from the gap day (the LAST visible bar: the example is
 * the gap day itself, owner 2026-10-27 "will do bear gaps off the highs"):
 * the GAP-FILL LEVEL (the prior day's low: gold, with the price label, the
 * level a bounce would have to close back above to fill the gap) and,
 * fainter, the GAP DAY'S HIGH. The levels are drawn, not imagined; which of
 * them the lesson is about is the owner's ruling on the charts.
 *
 * The gap bar is the item's `asof` bar; the gap-fill level is
 * `facts.gap_fill_level` when stored (scripts/study/find_bear_gap_examples.py),
 * else the low of the bar before the gap bar; the gap-day high is
 * `facts.gap_day_high` when stored, else the gap bar's high. Pure.
 */

export const BEAR_GAP_SKILL_ID = 'setup.family3.bear_gap'
export const BEAR_GAP_SETUP_NAME = 'Bear Gap off the Highs'

const GOLD = '#dcbb5e'
const GOLD_SOFT = 'rgba(220, 187, 94, 0.55)'

/** Is this study item a Bear Gap example? Reads the skill first, the setup name second. */
export function isBearGapItem(item) {
  if (!item) return false
  if (item.skill_id === BEAR_GAP_SKILL_ID) return true
  const name = item.reveal_json?.facts?.setup || item.reveal_json?.setup || item.prompt_json?.setup
  return typeof name === 'string' && name.trim().toLowerCase() === BEAR_GAP_SETUP_NAME.toLowerCase()
}

function dayKey(v) {
  if (v == null) return null
  const s = String(v)
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return s.slice(0, 10)
}

/** The gap bar (dated item.asof) and the bar before it, or null. */
export function bearGapBars(item, bars) {
  const list = Array.isArray(bars) ? bars : []
  const key = dayKey(item?.asof)
  if (!key || !list.length) return null
  const i = list.findIndex((b) => dayKey(b.t) === key)
  if (i < 1) return null
  return { gap: list[i], prior: list[i - 1] }
}

/**
 * The two rays for StockChart's `annotations` layer, or null without a gap
 * day. Order is fixed (gap-day high first, gap-fill level second); the
 * emphasis is on the gap-fill level: gold, wider, the only one labelled.
 */
export function bearGapAnnotations(item, bars) {
  const g = bearGapBars(item, bars)
  if (!g) return null
  const facts = item?.reveal_json?.facts || {}
  const storedFill = Number(facts.gap_fill_level)
  const storedHigh = Number(facts.gap_day_high)
  const fill = Number.isFinite(storedFill) && storedFill > 0 ? storedFill : Number(g.prior.l)
  const high = Number.isFinite(storedHigh) && storedHigh > 0 ? storedHigh : Number(g.gap.h)
  if (!Number.isFinite(fill) || !Number.isFinite(high)) return null
  return [
    {
      id: 'study-bear-gap-high', type: 'hray', points: [{ time: g.gap.t, price: high }],
      color: GOLD_SOFT, lineWidth: 1, lineStyle: 'dashed',
    },
    {
      id: 'study-bear-gap-fill', type: 'hray', points: [{ time: g.gap.t, price: fill }],
      color: GOLD, lineWidth: 2, lineStyle: 'dashed', showPriceLabel: true,
    },
  ]
}
