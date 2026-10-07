// DES — the `/research/:sym` Overview tab, embedded. ⛔ An ADAPTER, not a fork: OverviewTab
// needs the `stats` / `analyst` / `ai` the page computes with `useResearchOverview`, plus the
// "Latest report" row from `useLatestReport`, so this calls the same two hooks and hands the
// tab exactly what ResearchPage hands it.
import useResearchOverview from '../../research/hooks/useResearchOverview'
import useLatestReport from '../../research/hooks/useLatestReport'
import OverviewTab from '../../research/tabs/OverviewTab'
import { usePanelFreshness, panelAsOf } from '../../../components/terminal'

// TERM-019: the overview's numbers come from two vendors (the stats from Yahoo Finance through
// /api/fundamentals, the analyst block from Finnhub with an FMP fallback through
// /api/earnings/intel); the analyst block dates its own targets. The header names both.
// The header's as-of is the stats snapshot's build time (`as_of` on /api/fundamentals).
const OVERVIEW_SOURCE = 'Yahoo Finance (stats) · Finnhub, FMP fallback (analyst)'

export default function OverviewPanel({ sym }) {
  const data = useResearchOverview(sym, { header: false })
  const report = useLatestReport(sym)
  usePanelFreshness(data.stats && !data.error ? panelAsOf(OVERVIEW_SOURCE, data.stats.as_of) : null)
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
    />
  )
}
