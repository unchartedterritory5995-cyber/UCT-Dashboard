import { useEffect, useState } from 'react'
import StockChart from '../../../components/StockChart'

const STORAGE_KEY = 'charts_mobile_sym'

export default function MobileChartFallback() {
  const [sym, setSym] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'SPY'
    } catch {
      return 'SPY'
    }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, sym) } catch {}
  }, [sym])

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* Charts section stays clean — no Journal 2.0 / brokerage trade markers. */}
      <StockChart sym={sym} onSymbolChange={setSym} hideJournalOverlay />
    </div>
  )
}
