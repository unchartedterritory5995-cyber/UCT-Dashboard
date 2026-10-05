// DES — the `/research/:sym` Overview tab, embedded. ⛔ An ADAPTER, not a fork: OverviewTab
// needs the `stats` / `analyst` / `ai` the page computes with `useResearchOverview`, so this
// calls the same hook and hands the tab exactly what ResearchPage hands it.
import useResearchOverview from '../../research/hooks/useResearchOverview'
import OverviewTab from '../../research/tabs/OverviewTab'

export default function OverviewPanel({ sym }) {
  const data = useResearchOverview(sym)
  // row (the "Latest report" EPS/Revenue line: eps_estimate/reported_eps/surprise_pct/
  // rev_estimate/rev_actual/rev_surprise_pct) is not among meta/stats/analyst/ai that
  // useResearchOverview fetches, and ResearchPage.jsx itself passes row={null} too — the
  // data genuinely is not available here without a new fetch (e.g. the earnings-history
  // endpoint behind earningsModalRow.js). Deferred; do not wire without adding that fetch.
  return <OverviewTab sym={data.sym} stats={data.stats} analyst={data.analyst} ai={data.ai} row={null} />
}
