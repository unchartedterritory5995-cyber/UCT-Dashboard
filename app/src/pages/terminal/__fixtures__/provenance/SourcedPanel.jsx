// TERM-019 rail fixture — the same panel as UnsourcedPanel.jsx plus ONE line: it reports its
// source to the terminal panel header. It must PASS `panelProvenance.rail.test.js`, so the rail
// is proven to tell the two apart rather than answering one way for everything.
import useSWR from 'swr'
import { PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness } from '../../../../components/terminal'
import { formatNumber, formatPercent } from '../../../../lib/presentation/presentationPrimitives'
import { memberText } from '../../../../lib/presentation/memberCopy'
import { sectionFetcher } from '../../../../components/research/sections/sectionFetch'

export default function SourcedPanel({ sym }) {
  const inPanel = useInTerminalPanel()
  const { data, error } = useSWR(sym ? `/api/fixture/${sym}` : null, sectionFetcher)
  usePanelFreshness(data ? { source: memberText(data.source) } : null)
  if (error) return <PanelState kind="error" title={memberText(error.message)} />
  if (!data) return <PanelSkeleton label="Loading" />
  return (
    <p data-inset={inPanel?.inset ? 'yes' : 'no'}>
      {formatNumber(data.value)} ({formatPercent(data.change, { signed: true })})
    </p>
  )
}
