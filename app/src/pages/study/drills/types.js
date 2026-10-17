/**
 * Drill module interface (Study, spec §4.3 Phase 1 types; §13.7 D6/D8/D10/D18).
 *
 * One module per drill type. A module is a plain object:
 *
 *   {
 *     Body,                       // React component rendered UNDER the chart box:
 *                                 //   ({ item, state, setState, locked, reveal })
 *     answerFromState(state, item) // the `answer` POSTed to /api/study/attempts
 *     isAnswerable(state, item)    // true when Check may be tapped
 *     choicesOf?(item)             // the list the 1-4 keys select from (choice drills)
 *     framingOf?(item)             // one plain sentence describing the chart (D18 text framing)
 *     ChartOverlay?,               // optional, rendered INSIDE the chart box, absolutely
 *                                  //   positioned (TapDrill's HUD chip): same props as Body
 *                                  //   plus { bars }
 *     annotationsFor?(state, item, reveal, bars) // optional: drawings for the ONE chart
 *     onChartTap?(state, point, item, bars)      // optional reducer for a tap on the chart:
 *                                                //   point = {time, price, barIndex}; returns next state
 *   }
 *
 * The DrillPlayer owns the ONE mounted StockChart (T4) and the sticky bar; a drill
 * never renders a chart or a Check button of its own. State is whatever the drill
 * wants (null at the start of every item); the player stores it per item.
 *
 * Answer shapes follow api/services/study_scoring.py:
 *   recall / spot / regime / scenario / call_* : {choice}
 *   size                                       : {shares, dollars, risk_dollars}
 *   tap                                        : {bar_index, price, time}
 */

/** Item types that carry a chart in Phase 1. */
export const CHART_TYPES = new Set(['spot', 'tap', 'regime', 'call_scan', 'call_archive'])

/** True when THIS item has a chart to show: it carries bars, or is a chart type. */
export function itemHasChart(item) {
  if (!item) return false
  if (item.bars) return true
  if (item.has_chart) return true
  return CHART_TYPES.has(item.type) && !item.prompt_json?.image_url && !(item.prompt_json?.facts?.length)
}

/** The prompt text for an item, whatever the authoring field was called. */
export function questionOf(item) {
  const p = item?.prompt_json || {}
  return p.q || p.question || p.prompt || p.text || ''
}

/** Choice list from a prompt, as plain strings. */
export function choicesFromPrompt(item, fallback = []) {
  const p = item?.prompt_json || {}
  const raw = Array.isArray(p.choices) ? p.choices : fallback
  return raw.map((c) => (typeof c === 'string' ? c : c?.label ?? String(c)))
}

/** A choice answer: {choice}. */
export function choiceAnswer(state) {
  return { choice: state?.choice ?? null }
}

export function choiceAnswerable(state) {
  return state?.choice != null && state.choice !== ''
}

/** Whole-number formatting for the chart framing sentences. */
export function barsWord(n) {
  return `${n} ${n === 1 ? 'bar' : 'bars'}`
}
