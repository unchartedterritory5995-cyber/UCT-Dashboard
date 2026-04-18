/**
 * Chart modal — opens a chart for a specific symbol with right-click
 * → Add Position flow.
 * Spec §8.2 scoped to Journal 2.0 only (per Phase 0 audit).
 */

import { useCallback, useEffect, useId, useState } from 'react'
import J2Chart from './J2Chart'
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
  const [menu, setMenu] = useState(null)  // { x, y, symbol, price, date } | null
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !menu) onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, onClose])

  const handleBarContextMenu = useCallback((bar) => {
    setMenu({ ...bar, x: bar.clientX, y: bar.clientY })
  }, [])

  const handleReset = useCallback(() => {
    // Bumping the remount key forces J2Chart to re-run fitContent after
    // setData. Simpler than threading a ref up from the child.
    setResetKey((k) => k + 1)
  }, [])

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
            {symbol} chart
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
          <J2Chart
            key={`${symbol}-${resetKey}`}
            symbol={symbol}
            onBarContextMenu={handleBarContextMenu}
          />
        </div>
      </div>

      <ChartContextMenu
        open={!!menu}
        x={menu?.x || 0}
        y={menu?.y || 0}
        onReset={handleReset}
        onAddToPortfolio={() => {
          if (!menu) return
          onAddFromBar?.({
            symbol: menu.symbol,
            price: menu.price,
            date: menu.date,
          })
        }}
        onOpenSettings={onOpenSettings}
        onClose={() => setMenu(null)}
      />
    </div>
  )
}
