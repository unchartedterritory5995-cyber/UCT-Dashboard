// TERM-019 rail fixture — a panel that RENDERS A VALUE and says nothing about where it came from.
//
// ⛔ It must FAIL `panelProvenance.rail.test.js`. It imports the modules nearly every terminal
// panel imports (the terminal barrel, the shared formatters, member copy, the section fetcher), so
// if any of them ever started reaching a provenance primitive on its own, every panel would
// "adopt" through it and this fixture would go green with them — the rail would have stopped
// measuring anything. Never mounted; `__fixtures__` is test infrastructure (reachable.test.js).
import useSWR from 'swr'
import { PanelSkeleton, PanelState, useInTerminalPanel } from '../../../../components/terminal'
import { formatNumber, formatPercent } from '../../../../lib/presentation/presentationPrimitives'
import { memberText } from '../../../../lib/presentation/memberCopy'
import { sectionFetcher } from '../../../../components/research/sections/sectionFetch'

export default function UnsourcedPanel({ sym }) {
  const inPanel = useInTerminalPanel()
  const { data, error } = useSWR(sym ? `/api/fixture/${sym}` : null, sectionFetcher)
  if (error) return <PanelState kind="error" title={memberText(error.message)} />
  if (!data) return <PanelSkeleton label="Loading" />
  return (
    <p data-inset={inPanel?.inset ? 'yes' : 'no'}>
      {formatNumber(data.value)} ({formatPercent(data.change, { signed: true })})
    </p>
  )
}
