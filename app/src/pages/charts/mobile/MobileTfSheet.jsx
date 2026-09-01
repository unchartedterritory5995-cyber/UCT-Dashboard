import Sheet from '../../../components/mobile/Sheet'
import haptics from '../../../components/mobile/haptics'
import { tfLabel, tfSortKey } from '../../../components/chart/timeframes'
import { TF_ORDER } from '../../../components/chart/keyboardShortcuts'
import styles from './MobileCharts.module.css'

/* Timeframe picker — a bottom-sheet grid of the 8 native timeframes plus any
 * custom intervals the user has built in chart settings (desktop and phone see
 * the same list; customs come from cs.header.customTimeframes). The active code
 * is gold. One tap commits + closes.
 */
export default function MobileTfSheet({ open, onClose, tf, onTf, customTfs = [], className = '' }) {
  const codes = [...new Set([...TF_ORDER, ...customTfs, ...(tf ? [tf] : [])])]
    .sort((a, b) => tfSortKey(a) - tfSortKey(b))

  return (
    <Sheet open={open} onClose={onClose} variant="bottom-sheet" title="Timeframe" ariaLabel="Timeframe picker" className={className}>
      <div className={styles.tfGrid} role="listbox" aria-label="Timeframes">
        {codes.map((code) => (
          <button
            key={code}
            type="button"
            role="option"
            aria-selected={code === tf}
            className={`${styles.tfCell} ${code === tf ? styles.tfCellActive : ''}`}
            onClick={() => { haptics.tap(); onTf(code); onClose() }}
          >
            {tfLabel(code)}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
