/**
 * slingshotOverlay — the one line every Slingshot study chart carries: the
 * 4-period EMA of the daily HIGHS (the firm's E4H), the average the trigger is
 * judged against. Owner ruling 2026-10-25, on the first Slingshot chart: "I want
 * the 4EMA on the chart so we can see exactly where and when the slingshot
 * triggered and why."
 *
 * The firm's rule (api/services/pattern_engine/detectors/uct/uct_slingshot.py):
 * S1 the close is back over E4H, S2 the three prior closes each sat below it.
 * So the line IS the lesson — the pullback is the closes under it, the trigger
 * is the first close back over it — and it is drawn whenever the item is a
 * Slingshot item, before and after the reveal alike: it is an indicator the
 * member reads, like the house averages, not the answer.
 *
 * Drawn as an ordinary `movingAverage` engine instance (source = high, period 4,
 * EMA) on StockChart's settings beside the house averages, so nothing new is
 * rendered and the legend names it the way the chart names every average
 * ("EMA 4"). Pure: no React, no fetch.
 */

export const SLINGSHOT_SKILL_ID = 'setup.family4.slingshot'
export const SLINGSHOT_SETUP_NAME = 'Slingshot'
export const E4H_INSTANCE_ID = 'study:slingshot-e4h'
export const E4H_PERIOD = 4

const GOLD = '#dcbb5e'

/** Is this study item a Slingshot example? Reads the skill first, the setup name second. */
export function isSlingshotItem(item) {
  if (!item) return false
  if (item.skill_id === SLINGSHOT_SKILL_ID) return true
  const name = item.reveal_json?.facts?.setup || item.reveal_json?.setup || item.prompt_json?.setup
  return typeof name === 'string' && name.trim().toLowerCase() === SLINGSHOT_SETUP_NAME.toLowerCase()
}

/**
 * The engine instances a Slingshot chart carries on top of the house look, or
 * null for any other item. One: the E4H, gold, two pixels wide.
 */
export function slingshotInstances(item) {
  if (!isSlingshotItem(item)) return null
  return [{
    instanceId: E4H_INSTANCE_ID,
    defId: 'movingAverage',
    inputs: { source: 'high', period: E4H_PERIOD, maType: 'ema', color: GOLD },
    presentation: { lineWidth: 2 },
  }]
}
