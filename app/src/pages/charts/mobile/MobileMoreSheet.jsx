import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import { useFlagged } from '../../../hooks/useFlagged'
import { MOBILE_MENU_TYPES, labelMap, catalogMeta } from '../../../widgets/registry'
import styles from './MobileCharts.module.css'

const MENU_LABEL = labelMap('menu')

/* The ⋯ sheet: per-symbol actions (flag), the chart's settings door, the
 * layout's OTHER widgets as full-screen pages, and the add-widget roster
 * (registry MOBILE_MENU_TYPES — the same subset the tab-strip era offered).
 */
export default function MobileMoreSheet({
  open, onClose, sym,
  widgets = [],            // NON-chart widgets of the saved layout
  onOpenWidget,            // (widgetId) => void — open as a full-screen page
  onAddWidget,             // (type) => void
  onOpenSettings,          // chart settings modal
  onSetAlert,              // opens the price-alert sheet
  onShareSnapshot,         // chart PNG → native share sheet (row hidden when absent)
  onDrawOnChart,           // expands the collapsed drawing toolbar (row hidden when absent)
  className = '',
}) {
  const { isFlagged, toggle: toggleFlag } = useFlagged()
  const flagged = isFlagged(sym)

  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" title="Tools" ariaLabel="Chart tools" className={className}>
      <div className={styles.sheetList}>
        <button type="button" className={styles.row} onClick={() => { onClose(); onSetAlert?.() }}>
          <span className={styles.rowIcon}><UIcon name="bell" size={17} gold={false} /></span>
          <span className={styles.rowLabel}>Set price alert…</span>
          <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
        </button>
        {onDrawOnChart && (
          <button type="button" className={styles.row} onClick={() => { onClose(); onDrawOnChart() }}>
            <span className={styles.rowIcon}><UIcon name="edit" size={17} gold={false} /></span>
            <span className={styles.rowLabel}>Draw on chart</span>
            <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
          </button>
        )}
        <button
          type="button"
          className={styles.row}
          onClick={() => { haptics.tap(); toggleFlag(sym) }}
          aria-pressed={flagged}
        >
          <span className={styles.rowIcon}><UIcon name="flag" size={17} gold={flagged} /></span>
          <span className={styles.rowLabel}>{flagged ? `Unflag ${sym}` : `Flag ${sym}`}</span>
        </button>
        {onShareSnapshot && (
          <button type="button" className={styles.row} onClick={() => { onClose(); onShareSnapshot() }}>
            <span className={styles.rowIcon}><UIcon name="camera" size={17} gold={false} /></span>
            <span className={styles.rowLabel}>Share chart image</span>
            <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
          </button>
        )}
        <button type="button" className={styles.row} onClick={() => { onClose(); onOpenSettings?.() }}>
          <span className={styles.rowIcon}><UIcon name="gear" size={17} gold={false} /></span>
          <span className={styles.rowLabel}>Chart settings</span>
          <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
        </button>

        {widgets.length > 0 && (
          <>
            <div className={styles.sectionLabel}>Your widgets</div>
            {widgets.map((w) => (
              <button
                key={w.id}
                type="button"
                className={styles.row}
                aria-label={`Open ${MENU_LABEL[w.type] || w.type}`}
                onClick={() => { haptics.tap(); onClose(); onOpenWidget?.(w.id) }}
              >
                <span className={styles.rowIcon}><UIcon name={catalogMeta(w.type).icon} size={17} gold={false} /></span>
                <span className={styles.rowLabel}>{MENU_LABEL[w.type] || w.type}</span>
                <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
              </button>
            ))}
          </>
        )}

        <div className={styles.sectionLabel}>Add widget</div>
        {MOBILE_MENU_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={styles.row}
            aria-label={`Add ${MENU_LABEL[t] || t}`}
            onClick={() => { haptics.tap(); onClose(); onAddWidget?.(t) }}
          >
            <span className={styles.rowIcon}><UIcon name="plus" size={16} gold={false} /></span>
            <span className={styles.rowLabel}>{MENU_LABEL[t] || t}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
