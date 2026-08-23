import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { COLUMN_DEFS } from '../columnDefs'
import ColumnPicker from './ColumnPicker'
import styles from './ScannerShell.module.css'

// ── THE SEAL SAYS WHICH TIER YOU ARE LOOKING AT, ALWAYS ──────────────────────
//
// The seal already answered "how old is this data?" for the nightly snapshot.
// The live tier makes that question two-part: a NAMED SUBSET of columns can be
// recomputed from the live price during the session while every other column
// stays last night's. So the seal now carries BOTH answers, in one button and
// one popover — the existing provenance vocabulary extended, not a second one
// invented beside it.
//
// ⛔ SILENCE IS THE FAILURE MODE. A member who saw `⚡ LIVE 10:42` once and
// later sees a bare date will read the bare date as live. So whenever the
// server sends a `live` block at all — which it does on every scan once the
// read path knows the tier exists — the chip says one of exactly two words:
// `LIVE <time>` or `nightly`. Never nothing.
//
// ⛔ AND THE WORDING NEVER IMPLIES THE WHOLE ROW IS LIVE. The chip is a
// pointer; the popover states the count, names every live column, and says in
// the same breath that everything else is from the 03:00 build. `live.columns`
// and `live.anchor_note` come from the SERVER (`query.LIVE_ANCHOR_NOTE`) — this
// component renders the contract, it does not compose a second copy of it, and
// the count is `.length` of the list it is showing, never a number typed here.

function liveChipLabel(live) {
  if (!live) return null
  if (live.state === 'live') {
    const when = live.as_of_et ? ` as of ${live.as_of_et}` : ''
    return `${live.column_count} price-derived columns are live${when}; `
      + 'every other column on the row is from the 03:00 build'
  }
  return 'nightly snapshot — every column is from the 03:00 build'
    + (live.off_reason ? `. ${live.off_reason}` : '')
}

function LiveBlock({ live }) {
  if (!live) return null
  if (live.state !== 'live') {
    return (
      <div className={styles.sealLiveBlock}>
        <p className={styles.sealLiveOff}>
          <b>Live overlay off</b> — every column on this screen is from the 03:00 build.
          {live.off_reason ? ` ${live.off_reason}` : ''}
        </p>
      </div>
    )
  }
  const labels = (live.columns || []).map(c => COLUMN_DEFS[c]?.label || c)
  return (
    <div className={styles.sealLiveBlock}>
      <p className={styles.sealLiveLead}>
        <b>Live overlay</b> — {(live.live_rows_on_page ?? 0).toLocaleString()} of{' '}
        {(live.rows_on_page ?? 0).toLocaleString()} rows loaded here carry live values
        {live.as_of_et ? `, recomputed at ${live.as_of_et}` : ''} from the live price.
      </p>
      {live.anchor_note && <p className={styles.sealLiveNote}>{live.anchor_note}</p>}
      {labels.length > 0 && (
        <p className={styles.sealLiveCols}>
          <span className={styles.sealLiveColsLabel}>Live columns ({labels.length}):</span>{' '}
          {labels.join(', ')}. Every other column is from the 03:00 build.
        </p>
      )}
    </div>
  )
}

function Seal({ snapshot, snapshotDate }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const live = snapshot?.live
  // Nothing to attest to at all — no date AND no live block — is the one case
  // that still renders nothing. A live block with no date must still show,
  // because "which tier am I on" is answerable even when the date is not.
  if (!snapshotDate && !live) return null
  const label = `Snapshot ${snapshotDate || 'date unknown'} — data provenance`
    + (live ? `; ${liveChipLabel(live)}` : '')
  return (
    <span className={styles.sealWrap} ref={ref}>
      <button type="button" className={styles.seal} aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(o => !o)}>
        <UIcon name="check" size={10} /> {snapshotDate || 'no date'}
        {live && (live.state === 'live' ? (
          <span className={styles.sealLive}>
            <UIcon name="bolt" size={10} /> LIVE{live.as_of_et ? ` ${live.as_of_et}` : ''}
          </span>
        ) : (
          <span className={styles.sealNightly}>{' '}nightly</span>
        ))}
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
          <LiveBlock live={live} />
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
