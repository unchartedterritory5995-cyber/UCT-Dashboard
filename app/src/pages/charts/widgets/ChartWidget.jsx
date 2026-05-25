import { useCallback } from 'react'
import StockChart from '../../../components/StockChart'
import { useWorkspace } from '../WorkspaceContext'
import styles from '../ChartsWorkspace.module.css'

const TFS = [
  ['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'],
  ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M'],
]

export default function ChartWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const sym = groupSyms[color] || 'SPY'
  const tf = opts?.tf || 'D'
  const setTf = useCallback((nextTf) => {
    if (nextTf === tf) return
    onOptsChange?.({ ...(opts || {}), tf: nextTf })
  }, [opts, tf, onOptsChange])

  return (
    <div className={styles.chartWidget}>
      <div className={styles.tfBar}>
        {TFS.map(([code, label]) => (
          <button
            key={code}
            type="button"
            className={`${styles.tfBtn} ${tf === code ? styles.tfBtnActive : ''}`}
            onClick={() => setTf(code)}
          >{label}</button>
        ))}
      </div>
      <div className={styles.chartFill}>
        <StockChart
          sym={sym}
          tf={tf}
          onSymbolChange={(s) => setGroupSym(color, s)}
          onTfChange={setTf}
        />
      </div>
    </div>
  )
}
