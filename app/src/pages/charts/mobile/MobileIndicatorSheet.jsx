import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import styles from './MobileCharts.module.css'

/* Quick indicator control — the moving-average overlay slots as iOS switches,
 * plus the two doors deeper: the full Indicator Library (the SAME dialog the
 * chart toolbar owns, reached through StockChart's toolbarApiRef — never a
 * second mount) and the full settings modal.
 *
 * ⚠️ cs.overlays is POSITIONAL (chartDefaults merges stored blobs by index), so
 * rows are toggled by index and the array is never filtered or reordered here.
 */
export default function MobileIndicatorSheet({ open, onClose, cs, onWrite, onBrowseLibrary, onOpenSettings }) {
  const overlays = Array.isArray(cs?.overlays) ? cs.overlays : []

  const toggle = (idx) => {
    haptics.tap()
    const next = overlays.map((o, i) => (i === idx ? { ...o, enabled: !o.enabled } : o))
    onWrite({ ...cs, overlays: next, preset: 'custom' })
  }

  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" title="Indicators" ariaLabel="Indicators">
      <div className={styles.sheetList}>
        <div className={styles.sectionLabel}>Moving averages</div>
        {overlays.map((o, i) => (
          <div key={i} className={styles.indRow}>
            <span className={styles.indDot} style={{ background: o.color || 'var(--text-dim)' }} aria-hidden="true" />
            <span className={styles.indName}>{o.type || 'MA'} {o.period}</span>
            <button
              type="button"
              role="switch"
              aria-checked={!!o.enabled}
              aria-label={`${o.type || 'MA'} ${o.period}`}
              className={`${styles.switch} ${o.enabled ? styles.switchOn : ''}`}
              onClick={() => toggle(i)}
            >
              <span className={styles.knob} />
            </button>
          </div>
        ))}

        <div className={styles.sectionLabel}>More</div>
        <button
          type="button"
          className={styles.row}
          disabled={!onBrowseLibrary}
          onClick={() => { onClose(); onBrowseLibrary?.() }}
        >
          <span className={styles.rowIcon}><UIcon name="library" size={17} gold={false} /></span>
          <span className={styles.rowLabel}>Browse indicator library…</span>
          <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
        </button>
        <button
          type="button"
          className={styles.row}
          onClick={() => { onClose(); onOpenSettings?.() }}
        >
          <span className={styles.rowIcon}><UIcon name="gear" size={17} gold={false} /></span>
          <span className={styles.rowLabel}>All chart settings…</span>
          <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
        </button>
      </div>
    </Sheet>
  )
}
