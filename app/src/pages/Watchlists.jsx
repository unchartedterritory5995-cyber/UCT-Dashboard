// app/src/pages/Watchlists.jsx
import { useState, useEffect, useCallback } from 'react'
import { useFlagged } from '../hooks/useFlagged'
import useLivePrices from '../hooks/useLivePrices'
import StockChart from '../components/StockChart'
import styles from './Watchlists.module.css'

const PERIODS = [['5', '5min'], ['30', '30min'], ['60', '1hr'], ['D', 'Daily'], ['W', 'Weekly']]

export default function Watchlists() {
  const { flagged, remove: removeFlagged, isFlagged, toggle: toggleFlag } = useFlagged()
  const { prices } = useLivePrices(flagged)

  const [selectedSym, setSelectedSym] = useState(null)
  const [chartPeriod, setChartPeriod] = useState('D')
  const [flagToast, setFlagToast] = useState(null)

  // Auto-select first ticker when flagged list changes (or selected gets removed)
  useEffect(() => {
    if (selectedSym && flagged.includes(selectedSym)) return
    setSelectedSym(flagged[0] ?? null)
  }, [flagged])

  // Clear flag toast after 1.5s
  useEffect(() => {
    if (!flagToast) return
    const t = setTimeout(() => setFlagToast(null), 1500)
    return () => clearTimeout(t)
  }, [flagToast])

  // Arrow key navigation + Shift+F to unflag selected ticker
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = flagged.indexOf(selectedSym)
      const next = e.key === 'ArrowDown'
        ? Math.min(idx + 1, flagged.length - 1)
        : Math.max(idx - 1, 0)
      if (next >= 0) setSelectedSym(flagged[next])
    }
    if (e.shiftKey && e.key === 'F' && selectedSym) {
      removeFlagged(selectedSym)
      setFlagToast('removed')
    }
  }, [flagged, selectedSym, removeFlagged])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className={styles.page}>

      {/* ── Left panel: flagged list ── */}
      <div className={styles.leftPanel}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>⚑ Flagged</span>
          {flagged.length > 0 && (
            <span className={styles.listCount}>{flagged.length}</span>
          )}
          <span className={styles.listHint}>Shift+F to remove</span>
        </div>

        <div className={styles.listBody}>
          {flagged.length === 0 ? (
            <div className={styles.emptyList}>
              <div className={styles.emptyIcon}>⚑</div>
              <div className={styles.emptyText}>No flagged tickers yet.</div>
              <div className={styles.emptyHint}>Open any chart and press <strong>Shift+F</strong></div>
            </div>
          ) : (
            flagged.map(sym => {
              const q = prices[sym]
              const price = q?.price ?? null
              const changePct = q?.change_pct ?? null
              const isSelected = sym === selectedSym
              return (
                <div
                  key={sym}
                  className={`${styles.listRow}${isSelected ? ' ' + styles.listRowSelected : ''}`}
                  onClick={() => setSelectedSym(sym)}
                >
                  <span className={styles.rowSym}>{sym}</span>
                  <div className={styles.rowRight}>
                    {price != null && (
                      <span className={styles.rowPrice}>${price.toFixed(2)}</span>
                    )}
                    {changePct != null && (
                      <span className={`${styles.rowChange} ${changePct >= 0 ? styles.gain : styles.loss}`}>
                        {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
                      </span>
                    )}
                    <button
                      className={styles.removeBtn}
                      onClick={e => { e.stopPropagation(); removeFlagged(sym) }}
                      title="Remove from flagged"
                    >×</button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right panel: chart ── */}
      <div className={styles.rightPanel}>
        {selectedSym ? (
          <>
            <div className={styles.chartHeader}>
              <span className={styles.chartSym}>{selectedSym}</span>
              {flagToast && (
                <span className={`${styles.flagToast} ${styles.flagToastRemoved}`}>⚑ Removed</span>
              )}
              <button
                className={`${styles.flagBtn} ${styles.flagBtnActive}`}
                onClick={() => { removeFlagged(selectedSym); setFlagToast('removed') }}
                title="Remove from Flagged (Shift+F)"
              >⚑ Flagged</button>
              <div className={styles.chartPeriodTabs}>
                {PERIODS.map(([p, label]) => (
                  <button
                    key={p}
                    className={`${styles.chartPeriodBtn}${chartPeriod === p ? ' ' + styles.chartPeriodBtnActive : ''}`}
                    onClick={() => setChartPeriod(p)}
                  >{label}</button>
                ))}
              </div>
            </div>
            <StockChart sym={selectedSym} tf={chartPeriod} />
          </>
        ) : (
          <div className={styles.chartEmpty}>
            <div className={styles.chartEmptyIcon}>⚑</div>
            <div className={styles.chartEmptyText}>Select a ticker to view chart</div>
          </div>
        )}
      </div>

    </div>
  )
}
