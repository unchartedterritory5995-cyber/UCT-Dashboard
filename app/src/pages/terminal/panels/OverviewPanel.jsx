// DES — the `/research/:sym` Overview tab, embedded. ⛔ An ADAPTER, not a fork: OverviewTab
// needs the `stats` / `analyst` / `ai` the page computes with `useResearchOverview`, plus the
// "Latest report" row from `useLatestReport`, so this calls the same two hooks and hands the
// tab exactly what ResearchPage hands it.
import useResearchOverview from '../../research/hooks/useResearchOverview'
import useLatestReport from '../../research/hooks/useLatestReport'
import OverviewTab from '../../research/tabs/OverviewTab'
import { usePanelFreshness, panelAsOf, TickerNotFound, notFoundOf } from '../../../components/terminal'

// TERM-019: the overview's numbers come from two vendors (the stats from Yahoo Finance through
// /api/fundamentals, the analyst block from Finnhub with an FMP fallback through
// /api/earnings/intel); the analyst block dates its own targets. The header names both.
// The header's as-of is the stats snapshot's build time (`as_of` on /api/fundamentals).
const OVERVIEW_SOURCE = 'Yahoo Finance (stats) · Finnhub, FMP fallback (analyst)'

export default function OverviewPanel({ sym }) {
  const data = useResearchOverview(sym, { header: false })
  const report = useLatestReport(sym)
  // Wave 4: a symbol the server says is not a ticker (the wave-2 `not_found` marker on
  // /api/fundamentals) gets the shared "No data for XYZ — check the ticker" + suggestions, not
  // an overview of empty cards that reads like a real company with nothing on file.
  const notFound = notFoundOf(data.stats, data.sym)
  usePanelFreshness(data.stats && !data.error && !notFound ? panelAsOf(OVERVIEW_SOURCE, data.stats.as_of) : null)
  if (notFound) return <TickerNotFound sym={data.sym} payload={data.stats} testId="des-not-found" />
  // error + mutate: a failed read renders "couldn't load" with a Retry, never
  // "will appear here once available" -- the same props ResearchPage passes.
  return (
    <OverviewTab
      sym={data.sym}
      stats={data.stats}
      analyst={data.analyst}
      ai={data.ai}
      row={report.row}
      reportState={report.state}
      reportReason={report.reason}
      analystMissing={data.analystMissing}
      retryReport={report.retry}
      error={data.error}
      mutate={data.mutate}
      statsState={data.statsState}
      retryStats={data.retryStats}
      loading={data.loading}
      aiLoading={data.aiLoading}
    />
  )
}
