// ─── ONE PLACE THAT KNOWS HOW TO POINT THE CHARTS PAGE AT SOMETHING ─────────
//
// The reverse direction of the capture flow. Captures have always travelled
// charts → journal; nothing went back, so an embed was a dead end: you could
// read March's AMD 15m in a note but not open it on the real charts page to
// keep working.
//
// The link a surface BUILDS and the params ChartsWorkspace READS are the same
// fact, spelled once here — the screenShareLink.js / noteShareLink.js idiom.
// A hand-typed `?sym=` on one side and a hand-typed `p.get('symbol')` on the
// other agree the day they are written and silently stop agreeing later.
//
// ⛔ Deliberately NOT a new state channel: the workspace applies these through
// the authorities it already has (setGroupSym for the ticker, applyTfToCharts
// for the timeframe) and then STRIPS the params, so the URL is a one-shot
// instruction rather than a second source of truth competing with the saved
// workspace.

export const CHARTS_PATH = '/charts'

/** Param names — read by ChartsWorkspace, written by every "open on charts"
 *  surface. Values: sym = ticker, tf = bars-API timeframe code. */
export const CHART_LINK_PARAMS = { sym: 'sym', tf: 'tf' }

/** In-app path that opens the charts workspace on a symbol/timeframe. */
export function chartsLinkPath({ symbol, tf } = {}) {
  const p = new URLSearchParams()
  const s = String(symbol || '').trim().toUpperCase()
  if (s) p.set(CHART_LINK_PARAMS.sym, s)
  const t = String(tf ?? '').trim()
  if (t) p.set(CHART_LINK_PARAMS.tf, t)
  const q = p.toString()
  return q ? `${CHARTS_PATH}?${q}` : CHARTS_PATH
}

/** The absolute URL (for copy-to-clipboard). */
export function chartsLinkUrl(args) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${origin}${chartsLinkPath(args)}`
}

/** Read the instruction out of a query string. Returns null when there is
 *  nothing to apply, so the caller can skip the whole path. */
export function readChartsLink(search) {
  const p = new URLSearchParams(String(search || ''))
  const symbol = (p.get(CHART_LINK_PARAMS.sym) || '').trim().toUpperCase()
  const tf = (p.get(CHART_LINK_PARAMS.tf) || '').trim()
  if (!symbol && !tf) return null
  return { symbol: symbol || null, tf: tf || null }
}

/** The same query string with the instruction REMOVED — so applying it once
 *  doesn't survive a refresh and fight the user's own later changes. */
export function stripChartsLink(search) {
  const p = new URLSearchParams(String(search || ''))
  for (const k of Object.values(CHART_LINK_PARAMS)) p.delete(k)
  const q = p.toString()
  return q ? `?${q}` : ''
}
