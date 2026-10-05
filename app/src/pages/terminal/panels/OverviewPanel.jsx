// DES — the `/research/:sym` Overview tab, embedded. ⛔ An ADAPTER, not a fork: OverviewTab
// needs the `stats` / `analyst` / `ai` the page computes with `useResearchOverview`, so this
// calls the same hook and hands the tab exactly what ResearchPage hands it.
import useResearchOverview from '../../research/hooks/useResearchOverview'
import OverviewTab from '../../research/tabs/OverviewTab'

export default function OverviewPanel({ sym }) {
  const data = useResearchOverview(sym)
  return <OverviewTab sym={data.sym} stats={data.stats} analyst={data.analyst} ai={data.ai} row={null} />
}
