// ── INDICATORS ⇄ UCT AGENT: the chart's Create Indicator / Modify doors, routed to the Agent ──
//
// Owned by Indicators. The conversational builder already lives in the Agent (`indicator.draft`,
// `builder/agentAuthoring.js`, contract `uct.indicators.authoring/1`); what was missing is the
// way IN from the chart. This module is that seam and nothing else — no planner, no engine:
//
//   1. ROUTE — the Charts workspace, when the Agent is available to this member (admin-only, the
//      Agent's own gate), registers `setIndicatorAgentRoute(fn)`. The chart's own door
//      (`ChartToolbar.openCreateIndicator`, reached from Chart Settings → "+ Create Indicator", the
//      legend's "Modify with UCT Intelligence" and the Settings row) asks `routeIndicatorAuthoring`
//      first; when a route takes it, the Agent opens instead of the chart-side dock. No route
//      (another page, a member without the Agent, Multi Chart) ⇒ the existing dock, unchanged.
//   2. INTENT — the Agent asks "What indicator would you like to build?" (or what to change in the
//      one being modified) and holds ONE intent: the member's NEXT message is that request, sent
//      to the existing `indicator.draft` capability for THAT chart (and that definition) — the same
//      engine, preview, approval, save and Undo the Agent already has. One message, one use.
//   3. DOORS — Formula / Import / Library / Screenshot stay one click away: they open the existing
//      builder on the same chart (`host.charts.openIndicatorDoor`), never a second editor.

const INTENT_TTL_MS = 15 * 60 * 1000

let route = null
let intent = null
let seq = 0

/** The workspace registers (fn) / unregisters (null) the Agent route. Returns the unregister. */
export function setIndicatorAgentRoute(fn) {
  route = typeof fn === 'function' ? fn : null
  return () => { if (route === fn) route = null }
}

/** The chart door asks: will the Agent take this? `{chartId, defId?, name?}` → true when it did. */
export function routeIndicatorAuthoring(request) {
  if (!route || !request || !request.chartId) return false
  try { return route(request) === true } catch { return false }
}

/** The Agent's side: hold the intent the member's next message answers. */
export function beginAuthoringIntent({ chartRef, defId = null, name = null } = {}) {
  if (!chartRef) return null
  intent = { id: ++seq, chartRef: String(chartRef), defId: defId || null, name: name || null, at: Date.now() }
  return intent
}

export function peekAuthoringIntent() {
  if (intent && Date.now() - intent.at > INTENT_TTL_MS) intent = null
  return intent
}

/** Take (and clear) the live intent — one message answers it. */
export function takeAuthoringIntent() {
  const i = peekAuthoringIntent()
  intent = null
  return i
}

export function clearAuthoringIntent() { intent = null }

/** The Agent's question for an intent. */
export function authoringPrompt(i) {
  if (!i) return ''
  if (i.defId) return `What would you like to change in ${i.name ? `“${i.name}”` : 'this indicator'}?`
  return 'What indicator would you like to build?'
}

/** The member's answer → the ONE op the existing capability runs (it validates it like any op). */
export function authoringOp(i, text) {
  return { action: 'indicator.draft', target: 'draft:new', args: { message: String(text || '').trim(), chart: i.chartRef, edit: i.defId || null } }
}

/** Words that set the question aside rather than answer it. */
const CANCEL = /^(?:no|nope|cancel|never ?mind|not now|forget it|stop|skip it)[.!]?$/i
export const isCancelWords = (text) => CANCEL.test(String(text || '').trim())

/** The existing builder's doors, offered beside the question (create only). */
export const INDICATOR_DOORS = Object.freeze([
  { door: 'formula', label: 'Formula' },
  { door: 'pine', label: 'Import' },
  { door: 'library', label: 'Library' },
  { door: 'image', label: 'Screenshot' },
])

/** Open one door on the intent's chart through the chart's own API. → {ok, text} */
export function openIndicatorDoor(host, chartRef, door) {
  let ok = false
  try { ok = !!host?.charts?.openIndicatorDoor?.(chartRef, door) } catch { ok = false }
  const label = (INDICATOR_DOORS.find(d => d.door === door) || {}).label || 'builder'
  return { ok, text: ok ? `Opened ${label} on the chart.` : `${label} isn’t available on that chart.` }
}

/** Tests only. */
export function _resetIndicatorEntry() { route = null; intent = null; seq = 0 }
