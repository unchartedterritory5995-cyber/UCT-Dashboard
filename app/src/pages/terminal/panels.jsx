// UCT Terminal — what a `panel` name in functions.js renders.
//
// ⛔ EXISTING COMPONENTS, EMBEDDED, NEVER FORKED. Each importer below is the SAME module
// `/research/:sym` or `/calendar` mounts; the shell passes `sym` (and the registry's own
// `props`) and nothing else. The four entries under `./panels/` are thin adapters that
// exist only because the page computes a prop the tab needs (OverviewTab's `stats`), or
// because the component is the chart (embedded as-is, engine untouched), or because the
// shell owns it (Help).
//
// The importers are exported so `functions.rail.test.js` can IMPORT every one and assert
// a default-exported component — the "resolves to a real component" rail is import-based,
// not a list typed beside this one.
import { lazy } from 'react'

export const PANEL_IMPORTERS = {
  Calendar: () => import('../Calendar'),
  Overview: () => import('./panels/OverviewPanel'),
  Chart: () => import('./panels/ChartPanel'),
  News: () => import('../research/tabs/NewsTab'),
  Catalysts: () => import('../research/tabs/CatalystsTab'),
  Technical: () => import('../research/tabs/TechnicalTab'),
  Financials: () => import('../research/tabs/FinancialsTab'),
  Estimates: () => import('../research/tabs/EstimatesTab'),
  AnalystRatings: () => import('../research/tabs/AnalystRatingsTab'),
  Ratings: () => import('../research/tabs/RatingsTab'),
  Ownership: () => import('../research/tabs/OwnershipTab'),
  Calls: () => import('../research/tabs/CallsTab'),
  ModelBook: () => import('../research/tabs/ModelBookTab'),
  DecisionRecord: () => import('../research/tabs/DecisionRecordTab'),
  History: () => import('../research/tabs/HistoryTab'),
  Seasonality: () => import('../research/tabs/SeasonalityTab'),
  Filings: () => import('../research/tabs/FilingsTab'),
  FilingChanges: () => import('../research/tabs/FilingChangesTab'),
  AskAi: () => import('../research/tabs/AskAiTab'),
  OptionsChain: () => import('../research/tabs/OptionsChainTab'),
  Flow: () => import('../research/tabs/FlowTab'),
  Help: () => import('./panels/HelpPanel'),
}

const cache = new Map()
/** The lazy component for a panel name (memoised: one `lazy()` per name, ever). */
export function panelComponent(name) {
  if (!cache.has(name)) {
    const importer = PANEL_IMPORTERS[name]
    cache.set(name, importer ? lazy(importer) : null)
  }
  return cache.get(name)
}

/** Panels that read the shell's URL (the calendar owns `?week=`, `?earnings=` …). At most
 *  ONE panel may show one of these, or two copies would both answer the same deep link. */
export const URL_OWNING_PANELS = new Set(['Calendar'])
