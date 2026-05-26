import { useCallback, useRef } from 'react'
import StockChart from '../../../components/StockChart'
import SymbolSearch from '../../../components/chart/SymbolSearch'
import { useWorkspace } from '../WorkspaceContext'
import styles from '../ChartsWorkspace.module.css'

const TFS = [
  ['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'],
  ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M'],
]

// Letter or digit, no modifier combos. Period allowed for class-share tickers (BRK.B).
const TICKER_KEY_RE = /^[A-Za-z0-9.]$/

export default function ChartWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const sym = groupSyms[color] || 'SPY'
  const tf = opts?.tf || 'D'
  const setTf = useCallback((nextTf) => {
    if (nextTf === tf) return
    onOptsChange?.({ ...(opts || {}), tf: nextTf })
  }, [opts, tf, onOptsChange])

  const searchRef = useRef(null)
  const focusableRef = useRef(null)

  const handleChartClick = useCallback(() => {
    // Don't steal focus from a child input (e.g., the open search dropdown).
    const ae = document.activeElement
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
    focusableRef.current?.focus({ preventScroll: true })
  }, [])

  const handleChartKeyDown = useCallback((e) => {
    // Bail if the event is bubbling up from an input (search box, etc.).
    const tgt = e.target
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (!TICKER_KEY_RE.test(e.key)) return
    e.preventDefault()
    searchRef.current?.openWith(e.key)
  }, [])

  return (
    <div className={styles.chartWidget}>
      <div className={styles.tfBar}>
        <div className={styles.symbolSlot}>
          <SymbolSearch ref={searchRef} sym={sym} onSymbolChange={(s) => setGroupSym(color, s)} />
        </div>
        <span className={styles.tfBarDivider} aria-hidden="true" />
        {TFS.map(([code, label]) => (
          <button
            key={code}
            type="button"
            className={`${styles.tfBtn} ${tf === code ? styles.tfBtnActive : ''}`}
            onClick={() => setTf(code)}
          >{label}</button>
        ))}
      </div>
      <div
        ref={focusableRef}
        className={styles.chartFill}
        tabIndex={0}
        onClick={handleChartClick}
        onKeyDown={handleChartKeyDown}
      >
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
