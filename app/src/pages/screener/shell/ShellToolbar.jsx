import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import ColumnPicker from './ColumnPicker'
import styles from './ScannerShell.module.css'

function Seal({ snapshot, snapshotDate }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  if (!snapshotDate) return null
  return (
    <span className={styles.sealWrap} ref={ref}>
      <button type="button" className={styles.seal} aria-expanded={open}
        aria-label={`Snapshot ${snapshotDate} — data provenance`}
        onClick={() => setOpen(o => !o)}>
        <UIcon name="check" size={10} /> {snapshotDate}
      </button>
      {open && snapshot && (
        <div className={styles.sealPop} role="dialog" aria-label="Snapshot provenance">
          <div className={styles.sealRow}><span>Rows served</span><b>{snapshot.rows?.toLocaleString()}</b></div>
          <div className={styles.sealRow}><span>Most built</span>
            <b>{snapshot.snapshot_date} ({snapshot.rows_on_snapshot_date?.toLocaleString()})</b></div>
          <div className={styles.sealRow}><span>Oldest / newest</span>
            <b>{snapshot.oldest_snapshot_date || '—'} / {snapshot.newest_snapshot_date || '—'}</b></div>
          {snapshot.rows_missing_snapshot_date > 0 && (
            <div className={styles.sealRow}><span>No date</span><b>{snapshot.rows_missing_snapshot_date}</b></div>
          )}
          {snapshot.mixed && (
            <p className={styles.sealMixed}>Mixed snapshot — not every row was rebuilt the same night.</p>
          )}
        </div>
      )}
    </span>
  )
}

export default function ShellToolbar({ meta, view, onView, visibleColumns, allColumns,
  onColumns, onResetColumns, density, onDensity, snapshot, snapshotDate,
  total, shown, isLoading, onExport, exportState, saveBar }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <div className={styles.toolbar}>
      <div className={styles.viewTabs} role="tablist" aria-label="Column views">
        {(meta?.views || []).map(v => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key}
            className={`${styles.viewTab} ${view === v.key ? styles.viewTabOn : ''}`}
            onClick={() => onView(v.key)}>{v.label}</button>
        ))}
      </div>
      <span className={styles.statusLine} aria-live="polite">
        {isLoading && !shown ? 'Scanning…' : `${(total ?? 0).toLocaleString()} matches`}
      </span>
      <Seal snapshot={snapshot} snapshotDate={snapshotDate} />
      <span className={styles.toolGroup}>
        <span className={styles.pickerAnchor}>
          <button type="button" className={styles.toolBtn} aria-label="Choose columns"
            aria-expanded={pickerOpen} onClick={() => setPickerOpen(o => !o)}>
            <UIcon name="columns" size={13} /> Columns
          </button>
          <ColumnPicker open={pickerOpen} onClose={() => setPickerOpen(false)}
            allColumns={allColumns} visible={visibleColumns}
            onChange={onColumns} onReset={() => { onResetColumns(); setPickerOpen(false) }} />
        </span>
        <button type="button" className={styles.toolBtn}
          aria-label={`Density: ${density}`} aria-pressed={density === 'compact'}
          onClick={() => onDensity(density === 'compact' ? 'comfortable' : 'compact')}>
          <UIcon name="rows" size={13} />
        </button>
        <button type="button" className={styles.toolBtn} disabled={exportState?.busy} onClick={onExport}>
          <UIcon name="download" size={13} /> {exportState?.busy ? 'Exporting…' : 'CSV'}
        </button>
        {saveBar}
      </span>
      {(exportState?.note || exportState?.error) && (
        <span role="status" className={exportState.error ? styles.exportErr : styles.exportNote}>
          {exportState.error || exportState.note}
        </span>
      )}
    </div>
  )
}
