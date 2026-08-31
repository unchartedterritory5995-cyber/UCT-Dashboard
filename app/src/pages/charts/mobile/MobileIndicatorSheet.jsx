import { useMemo } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import * as engineRegistry from '../../../components/chart/engine/nativeRegistry'
import { catalogRows, userCatalogRows, catalogGeneration } from '../../../components/chart/indicatorCatalog'
import { isRowOn, toggledRow } from '../../../components/chart/IndicatorLibraryDialog'
import styles from './MobileCharts.module.css'

/* Quick indicator control — the moving-average overlay slots as iOS switches,
 * a STUDIES section (below), plus the two doors deeper: the full Indicator
 * Library (the SAME dialog the chart toolbar owns, reached through StockChart's
 * toolbarApiRef — never a second mount) and the full settings modal.
 *
 * ⚠️ cs.overlays is POSITIONAL (chartDefaults merges stored blobs by index), so
 * rows are toggled by index and the array is never filtered or reordered here.
 */

/* The studies a trader reaches for most, one switch each — TradingView mobile's
 * add-RSI is two taps and this matches it (ƒx → switch) instead of routing the
 * common case through the full library dialog. Everything else stays one tap
 * deeper behind "Browse indicator library…". The section also unions in ANY
 * other study currently ON (library adds, member formulas, carved-out rows), so
 * what this sheet shows always agrees with the toolbar's ƒx badge — a running
 * study the sheet hides would read as a badge counting ghosts. */
const QUICK_STUDY_IDS = ['rsi', 'macd', 'bb', 'vwap', 'atr', 'stoch']

export default function MobileIndicatorSheet({ open, onClose, cs, onWrite, onBrowseLibrary, onOpenSettings }) {
  const overlays = Array.isArray(cs?.overlays) ? cs.overlays : []

  const toggle = (idx) => {
    haptics.tap()
    const next = overlays.map((o, i) => (i === idx ? { ...o, enabled: !o.enabled } : o))
    onWrite({ ...cs, overlays: next, preset: 'custom' })
  }

  // Same union + generation discipline as IndicatorLibraryDialog: the registry
  // module namespace never changes identity, so a memo keyed on it alone would
  // miss user-formula installs — `catalogGeneration` is the recompute key.
  const generation = catalogGeneration(engineRegistry)
  const rows = useMemo(
    () => [...catalogRows(engineRegistry), ...userCatalogRows(engineRegistry)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generation],
  )
  const studyRows = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]))
    const quick = QUICK_STUDY_IDS.map((id) => byId.get(id)).filter(Boolean)
    const extras = rows.filter((r) => !QUICK_STUDY_IDS.includes(r.id) && isRowOn(r, cs))
    return [...quick, ...extras]
  }, [rows, cs])

  // ONE write door for a flipped study — the same `toggledRow` the library
  // dialog commits through, so this switch and that checkbox can never disagree
  // about what a toggle does. Identity return = refused write = persist nothing.
  const toggleStudy = (row) => {
    haptics.tap()
    const next = toggledRow(row, cs, engineRegistry)
    if (next !== cs) onWrite({ ...next, preset: 'custom' })
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

        <div className={styles.sectionLabel}>Studies</div>
        {studyRows.map((r) => {
          const on = isRowOn(r, cs)
          return (
            <div key={r.id} className={styles.indRow}>
              <span className={styles.indName}>
                {r.name}
                {r.sessionOnly && <span className={styles.indNote}> · intraday</span>}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={r.name}
                className={`${styles.switch} ${on ? styles.switchOn : ''}`}
                onClick={() => toggleStudy(r)}
              >
                <span className={styles.knob} />
              </button>
            </div>
          )
        })}

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
