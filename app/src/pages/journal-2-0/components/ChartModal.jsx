/**
 * Chart modal — opens the full dashboard chart for a specific symbol
 * with right-click → Add Position flow.
 * Spec §8.2 scoped to Journal 2.0 only (per Phase 0 audit).
 *
 * Uses the shared dashboard `StockChart` for visual + behavioral
 * consistency with every other chart in the app (drawings, toolbar,
 * indicators, real-time prices). The only change the shared chart
 * needed was a non-breaking optional `onBarContextMenu` prop.
 */

import { useCallback, useEffect, useId, useState } from 'react'
import StockChart from '../../../components/StockChart'
import ChartContextMenu from './ChartContextMenu'
import shellStyles from './ModalShell.module.css'
import styles from './ChartModal.module.css'

export default function ChartModal({
  symbol,
  onAddFromBar,
  onOpenSettings,
  onClose,
}) {
  const titleId = useId()
  const [menu, setMenu] = useState(null)  // { bar, clientX, clientY } | null

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !menu) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, onClose])

  const handleBarContextMenu = useCallback(({ bar, clientX, clientY }) => {
    setMenu({ bar, clientX, clientY })
  }, [])

  const barDateIso = (bar) => {
    if (!bar) return null
    const d = new Date(Number(bar.t) * 1000)
    return d.toISOString().slice(0, 10)
  }

  return (
    <div
      className={shellStyles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div
        className={`${shellStyles.modal} ${styles.wideModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={shellStyles.header}>
          <h2 id={titleId} className={shellStyles.title}>
            {symbol}
            <span className={styles.hint}> · right-click a bar to add</span>
          </h2>
          <button
            type="button"
            className={shellStyles.xBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <StockChart
            sym={symbol}
            height="100%"
            onBarContextMenu={handleBarContextMenu}
          />
        </div>
      </div>

      <ChartContextMenu
        open={!!menu}
        x={menu?.clientX || 0}
        y={menu?.clientY || 0}
        onReset={null}
        onAddToPortfolio={() => {
          if (!menu?.bar) return
          onAddFromBar?.({
            symbol,
            price: menu.bar.c,  // close of clicked bar
            date: barDateIso(menu.bar),
          })
        }}
        onOpenSettings={onOpenSettings}
        onClose={() => setMenu(null)}
      />
    </div>
  )
}
