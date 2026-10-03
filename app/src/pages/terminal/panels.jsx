// UCT Terminal — what a `panel` (or `surface`) name in functions.js renders.
//
// ⛔ EXISTING COMPONENTS, EMBEDDED, NEVER FORKED. Each importer below is the SAME module
// `/research/:sym`, `/calendar`, the Options Flow page or the screener mounts; the shell passes
// `sym` (and the registry's own `props` / honoured `args`) and nothing else. The entries under
// `./panels/` are thin adapters that exist only because the page computes a prop the tab needs
// (OverviewTab's `stats`, DepthTab's `flags`, My Research's note door), or because the
// component is the chart (embedded as-is, engine untouched), or because the shell owns it (Help).
//
// Whole PAGES (`surface` variants) are not listed here: they resolve through the TERM-037
// panel set (`surfacePanels.js`), so there is one panel vocabulary, not a second page list.
//
// The importers are exported so `functions.rail.test.js` can IMPORT every one and assert
// a default-exported component — the "resolves to a real component" rail is import-based,
// not a list typed beside this one.
import { lazy } from 'react'
import { SURFACE_IMPORTERS_BY_ID, URL_WRITING_SURFACE_IDS, surfacePanel } from './surfacePanels'

/** A named export served as a lazy() default (VolPanels exports several panels). */
const named = (load, name) => () => load().then((m) => ({ default: m[name] }))

export const PANEL_IMPORTERS = {
  Calendar: () => import('../Calendar'),
  Overview: () => import('./panels/OverviewPanel'),
  Chart: () => import('./panels/ChartPanel'),
  News: () => import('../research/tabs/NewsTab'),
  Catalysts: () => import('../research/tabs/CatalystsTab'),
  Technical: () => import('../research/tabs/TechnicalTab'),
  Financials: () => import('../research/tabs/FinancialsTab'),
  Estimates: () => import('../research/tabs/EstimatesTab'),
  EstimateHistory: () => import('../research/tabs/EstimateHistoryTab'),
  AnalystRatings: () => import('../research/tabs/AnalystRatingsTab'),
  Ratings: () => import('../research/tabs/RatingsTab'),
  Ownership: () => import('../research/tabs/OwnershipTab'),
  People: () => import('../research/tabs/PeopleTab'),
  Calls: () => import('../research/tabs/CallsTab'),
  ModelBook: () => import('../research/tabs/ModelBookTab'),
  DecisionRecord: () => import('../research/tabs/DecisionRecordTab'),
  History: () => import('../research/tabs/HistoryTab'),
  Seasonality: () => import('../research/tabs/SeasonalityTab'),
  Filings: () => import('../research/tabs/FilingsTab'),
  FilingsFeed: () => import('../research/tabs/FilingsFeedTab'),
  FilingChanges: () => import('../research/tabs/FilingChangesTab'),
  MyResearch: () => import('./panels/MyResearchPanel'),
  AskAi: () => import('../research/tabs/AskAiTab'),
  Depth: () => import('./panels/DepthPanel'),
  Events: () => import('../research/depth/EventsPanel'),
  FilingSearch: () => import('../research/depth/FilingSearchPanel'),
  EarningsReaction: () => import('../research/depth/EarningsReactionPanel'),
  Ftd: () => import('../research/depth/FtdPanel'),
  MentionSeries: () => import('../research/depth/MentionSeriesPanel'),
  BrokerEstimates: () => import('../research/depth/BrokerEstimatesPanel'),
  OptionsChain: () => import('../research/tabs/OptionsChainTab'),
  IvHistory: () => import('../research/tabs/IvHistoryPanel'),
  Backtest: () => import('../research/tabs/BacktestPanel'),
  VolStats: named(() => import('../optionsAnalytics/VolPanels'), 'VolStatsPanel'),
  Positioning: () => import('../optionsAnalytics/PositioningPanel'),
  OptionsHistory: () => import('../optionsAnalytics/OptionsHistoryPanel'),
  OptionsScreener: () => import('../screener/options/OptionsScreener'),
  MarketTide: () => import('../optionsAnalytics/MarketTidePanel'),
  StrategyScreens: () => import('../optionsAnalytics/StrategyScreensPanel'),
  Flow: () => import('../research/tabs/FlowTab'),
  Help: () => import('./panels/HelpPanel'),
  Move: () => import('./panels/MovePanel'),
}

/** The panel name a registry variant renders: its `panel`, or the panel-set id of its
 *  `surface` page. Null for a door (or a surface the panel set does not bind). */
export function panelNameFor(variant) {
  if (!variant) return null
  if (variant.panel) return variant.panel
  if (variant.surface) return surfacePanel(variant.surface)?.id ?? null
  return null
}

const cache = new Map()
/** The lazy component for a panel name (memoised: one `lazy()` per name, ever). */
export function panelComponent(name) {
  if (!cache.has(name)) {
    const importer = PANEL_IMPORTERS[name] || SURFACE_IMPORTERS_BY_ID[name]
    cache.set(name, importer ? lazy(importer) : null)
  }
  return cache.get(name)
}

/** Panels that read or write the shell's URL (the calendar owns `?week=`, `?earnings=` …; the
 *  screener page writes `?s=`). At most ONE panel may show one of these, or two copies would
 *  both answer the same deep link. Surface ids are derived, never typed. */
export const URL_OWNING_PANELS = new Set(['Calendar', ...URL_WRITING_SURFACE_IDS])
