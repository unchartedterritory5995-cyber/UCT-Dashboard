// UCT Terminal — V8: each panel's as-of, decided by TERM-006's per-class authority.
//
// ⛔ THIS MODULE DECIDES NOTHING ABOUT AGE. "Must this panel state its age?" is
// `components/provenance/freshnessAge.js::explainMustShowAge` (CARD 33 §2's ceiling, the
// 2x-cadence rule and the 60 s floor live there and nowhere else). What this module owns is
// the two inputs the authority asks a panel for:
//
//   * its DATA CLASS — named per panel below (`PANEL_DATA_CLASS`), never a cadence number
//     (freshnessAge.test.js §9 walks every importer for a numeric cadence);
//   * its AS-OF — the instant the panel's own data last ARRIVED in this browser. The shell
//     cannot read a timestamp out of an embedded, unforked component, so it watches the one
//     door every panel's data comes through: SWR. `freshnessMiddleware` wraps each fetcher
//     the panel's hooks call and stamps the moment a fetch RESOLVES (a rejected fetch stamps
//     nothing — a failure is not fresh data). A panel that fetched nothing the shell could
//     see has no as-of, and says so ("as-of not reported"); it is never rendered as fresh.
//
// ⚠️ WHAT THE AS-OF IS NOT: the vendor's own timestamp. An end-of-day payload fetched a
// minute ago is "fetched a minute ago"; the class (end_of_day) is what keeps that honest —
// the panel is judged against its own cadence, not against the wall clock alone.
//
// The store is per shell (one Map of panel id -> last fetch, plus subscribers), so a panel
// header re-renders when ITS panel fetched, and the L0 strip reads it on its own tick: a
// polling panel never re-renders the whole shell (H14: no render loop is reachable from here).
import { explainMustShowAge, freshnessClass } from '../../components/provenance/freshnessAge'
import { SURFACE_IMPORTERS, SURFACE_IMPORTERS_BY_ID } from './surfacePanels'

/** The data class of every panel `panels.jsx` can render, by panel name. `null` = the panel
 *  is the shell's own and shows no market data (Help). `panelFreshness.test.js` derives the
 *  panel list from PANEL_IMPORTERS and fails on a panel with no entry here. */
export const PANEL_DATA_CLASS = Object.freeze({
  // live during the session: prices, flow, chains, tape-derived views
  Chart: 'intraday_live',
  Flow: 'intraday_live',
  OptionsChain: 'intraday_live',
  Positioning: 'intraday_live',
  MarketTide: 'intraday_live',
  StrategyScreens: 'intraday_live',
  Move: 'intraday_live',
  // published once a session (or slower, but read as a daily surface)
  Calendar: 'end_of_day',
  Overview: 'end_of_day',
  News: 'end_of_day',
  Catalysts: 'end_of_day',
  Technical: 'end_of_day',
  AnalystRatings: 'end_of_day',
  Ratings: 'end_of_day',
  Calls: 'end_of_day',
  ModelBook: 'end_of_day',
  DecisionRecord: 'end_of_day',
  History: 'end_of_day',
  Seasonality: 'end_of_day',
  Filings: 'end_of_day',
  FilingsFeed: 'end_of_day',
  FilingChanges: 'end_of_day',
  MyResearch: 'end_of_day',
  AskAi: 'end_of_day',
  Depth: 'end_of_day',
  Events: 'end_of_day',
  FilingSearch: 'end_of_day',
  EarningsReaction: 'end_of_day',
  Ftd: 'end_of_day',
  MentionSeries: 'end_of_day',
  NewsDesk: 'end_of_day',
  CallReplay: 'end_of_day',
  IvHistory: 'end_of_day',
  Backtest: 'end_of_day',
  VolStats: 'end_of_day',
  OptionsHistory: 'end_of_day',
  OptionsScreener: 'end_of_day',
  // fundamentals: quarterly publication
  Financials: 'quarterly',
  Estimates: 'quarterly',
  EstimateHistory: 'quarterly',
  BrokerEstimates: 'quarterly',
  Ownership: 'quarterly',
  People: 'quarterly',
  // the shell's own panel
  Help: null,
})

/** Whole pages embedded through the panel set, by their page module (SURFACE_IMPORTERS key). */
export const SURFACE_DATA_CLASS = Object.freeze({
  MorningWire: 'end_of_day',
  UCT20: 'end_of_day',
  Breadth: 'end_of_day',
  Screener: 'end_of_day',
  FlowScoreboard: 'end_of_day',
  CatalystsHistory: 'end_of_day',
  PortfolioHeat: 'intraday_live',
})

const ELEMENT_BY_SURFACE_ID = Object.freeze(Object.fromEntries(
  Object.entries(SURFACE_IMPORTERS_BY_ID).map(([id, importer]) => [
    id, Object.keys(SURFACE_IMPORTERS).find((el) => SURFACE_IMPORTERS[el] === importer) || null,
  ]),
))

/** The class id a resolved panel name answers to: a panel name, else a panel-set surface id.
 *  `undefined` = unknown (a rail failure, never a silent default); `null` = no market data. */
export function panelDataClass(name) {
  if (Object.prototype.hasOwnProperty.call(PANEL_DATA_CLASS, name)) return PANEL_DATA_CLASS[name]
  const el = ELEMENT_BY_SURFACE_ID[name]
  if (el && Object.prototype.hasOwnProperty.call(SURFACE_DATA_CLASS, el)) return SURFACE_DATA_CLASS[el]
  return undefined
}

/** The authority's verdict for one panel, plus its class words. `null` when the panel shows
 *  no market data (nothing to state). An unknown panel name is judged as the TIGHTEST class
 *  (intraday_live) — the asymmetry freshnessAge.js names: a badge costs pixels. */
export function panelAge(name, asOf, { now = new Date() } = {}) {
  const cls = panelDataClass(name)
  if (cls === null) return null
  const id = cls === undefined ? 'intraday_live' : cls
  const verdict = explainMustShowAge({ asOf: asOf ?? null, dataClass: id, now })
  return { ...verdict, dataClass: id, cadence: freshnessClass(id).cadence }
}

/** One shell's fetch-arrival store: panel id -> epoch ms of its last resolved fetch. */
export function createFreshnessStore() {
  const at = new Map()
  const subs = new Map()
  return {
    stamp(id, ms = Date.now()) {
      at.set(id, ms)
      for (const fn of subs.get(id) || []) fn()
    },
    get(id) { return at.has(id) ? at.get(id) : null },
    subscribe(id, fn) {
      if (!subs.has(id)) subs.set(id, new Set())
      subs.get(id).add(fn)
      return () => { subs.get(id)?.delete(fn) }
    },
    forget(id) { at.delete(id) },
  }
}

/** The SWR middleware a panel's subtree runs under: every fetcher its hooks call is wrapped
 *  so a RESOLVED fetch stamps `id` in `store`. A rejection propagates untouched and stamps
 *  nothing. A hook with no fetcher (a cache read) is passed through as-is. */
export function freshnessMiddleware(store, id) {
  return (useSWRNext) => (key, fetcher, config) => {
    const wrapped = typeof fetcher === 'function'
      ? (...args) => Promise.resolve(fetcher(...args)).then((v) => { store.stamp(id); return v })
      : fetcher
    return useSWRNext(key, wrapped, config)
  }
}

/** The worst verdict across the visible panels, for the L0 strip: how many must state their
 *  age, how many have reported nothing, and how many were judged. */
export function boardFreshness(panels, store, { now = new Date() } = {}) {
  let stale = 0
  let unreported = 0
  let judged = 0
  for (const { id, name } of panels) {
    const v = panelAge(name, store.get(id), { now })
    if (!v) continue
    judged += 1
    if (v.reason === 'no_timestamp') unreported += 1
    else if (v.mustShow) stale += 1
  }
  return { stale, unreported, judged }
}
