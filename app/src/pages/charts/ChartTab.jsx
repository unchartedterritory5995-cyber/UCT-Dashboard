import StockChart from '../../components/StockChart'
import { useChartsSym } from './ChartsSymContext'

export default function ChartTab() {
  const { sym, setSym } = useChartsSym()
  const resolved = sym || 'SPY'
  return <StockChart sym={resolved} onSymbolChange={setSym} />
}
