import StockChart from '../../../components/StockChart'
import { useWorkspace } from '../WorkspaceContext'

export default function ChartWidget({ color, opts }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const sym = groupSyms[color] || 'SPY'
  return <StockChart sym={sym} onSymbolChange={(s) => setGroupSym(color, s)} />
}
