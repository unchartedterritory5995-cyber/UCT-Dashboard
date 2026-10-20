// Notebook widgets Task 16: the Fundamentals capture, ONE builder for both doors.
//
// The /charts FundamentalsWidget's "Send to Journal" and the Notebook's `/fundamentals NVDA` insert both
// build the frozen capture here: the reported rows as shown, which are immutable (owner-approved freeze).
import { mergeFundamentalsSettings, fundamentalsDefaultsForTheme, FUNDAMENTALS_SETTINGS_KEY } from '../fundamentalsSettings'
import { resolveGlobalPrefSettings } from '../../../../components/chart/chartThemes'
import { parsePref } from '../../../../hooks/usePreferences'
import { getJson, isOffline, captureFailure, readPreferences } from './captureFetch'

/** The look a fundamentals widget resolves: the member's saved GLOBAL pref when it was saved for this
 *  theme, else the defaults for the theme. `saved` is the parsed pref. */
export const fundamentalsCaptureSettings = (saved, theme) =>
  mergeFundamentalsSettings(resolveGlobalPrefSettings(saved, theme, fundamentalsDefaultsForTheme))

/** The view the widget actually shows: analyst/ownership as chosen, else the chosen table, falling to
 *  the other one when the chosen one has no rows. */
export function effectiveFundamentalsView(view, data) {
  if (view === 'analyst' || view === 'ownership') return view
  if (view === 'annual') return data?.annual?.length ? 'annual' : 'quarterly'
  return data?.quarterly?.length ? 'quarterly' : 'annual'
}

/** The company name from the research snapshot, unless it only repeats the symbol. */
export const companyFromSnapshot = (sym, snap) => (snap?.name && snap.name !== sym ? snap.name : null)

/** The frozen capture for one table. Pure: exactly what the widget had fetched and shows. */
export function buildFundamentalsCapture({ symbol, data, company }, { view, settings }) {
  return {
    symbol, view, company, settings,
    data: { annual: data?.annual || [], quarterly: data?.quarterly || [] },
  }
}

/** What the widget fetches for a symbol: the earnings table (same endpoint, same query), the research
 *  snapshot's company name, and the member's preferences. A paid-gated or empty table is a failure: the
 *  widget offers no Send then either. A missing company name is not. Never throws. */
export async function fetchFundamentalsCaptureData({ symbol } = {}) {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const sym = String(symbol || '').toUpperCase()
  if (!sym) return { ok: false, reason: 'failed' }
  const [table, snap, prefs] = await Promise.all([
    getJson(`/api/fundamentals/earnings-table?sym=${encodeURIComponent(sym)}`),
    getJson(`/api/research/snapshot/${sym}`),
    readPreferences(),
  ])
  const data = table.ok && table.data && !table.data.paywalled ? table.data : null
  if (!data?.annual?.length && !data?.quarterly?.length) return captureFailure()
  return { ok: true, data: { symbol: sym, data, company: companyFromSnapshot(sym, snap.ok ? snap.data : null) }, prefs }
}

/** The slash insert: fetch, then build the capture a fresh widget's Send to Journal would build. */
export async function slashCapture(params) {
  const res = await fetchFundamentalsCaptureData(params)
  if (!res.ok) return res
  const settings = fundamentalsCaptureSettings(parsePref(res.prefs[FUNDAMENTALS_SETTINGS_KEY], null), res.prefs.theme)
  return {
    ok: true,
    payload: buildFundamentalsCapture(res.data, { view: effectiveFundamentalsView('quarterly', res.data.data), settings }),
  }
}
