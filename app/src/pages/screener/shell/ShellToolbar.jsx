import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { COLUMN_DEFS } from '../columnDefs'
import ColumnPicker from './ColumnPicker'
import { DEFAULT_VIEW } from './specUrl'
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
// and `live.anchor_note` come from the SERVER (`query.anchor_note`) — this
// component renders the contract, it does not compose a second copy of it, and
// the count is `.length` of the list it is showing, never a number typed here.
//
// ⛔ AND A ROSTER OF NONE IS NOT A LIVE CLAIM. `live_unnamed` is the server's
// word for "these rows carry overlay values but the tier named no columns".
// The chip must not shout LIVE over a disclosure that names nothing, and it
// must not say `nightly` either — that would be false about values that were
// recomputed. It says the honest third thing, quietly.

function liveChipLabel(live) {
  if (!live) return null
  if (live.state === 'live') {
    const when = live.as_of_et ? ` as of ${live.as_of_et}` : ''
    return `${live.column_count} price-derived columns are live${when}; `
      + 'every other column on the row is from the 03:00 build'
  }
  if (live.state === 'live_unnamed') {
    return 'the live overlay did not name which columns it recomputed'
      + (live.off_reason ? `. ${live.off_reason}` : '')
  }
  return 'nightly snapshot — every column is from the 03:00 build'
    + (live.off_reason ? `. ${live.off_reason}` : '')
}

//: The page-scoped counts sit directly under the seal's result-set-scoped
//: "Rows served", so the server's own qualifier is rendered with them —
//: without it the two numbers read as a contradiction.
function ScopeNote({ live }) {
  if (!live?.scope_note) return null
  return <p className={styles.sealLiveScope}>{live.scope_note}.</p>
}

function LiveBlock({ live }) {
  if (!live) return null
  if (live.state === 'live_unnamed') {
    return (
      <div className={styles.sealLiveBlock}>
        <p className={styles.sealLiveOff}>
          <b>Live overlay — unnamed</b> —{' '}
          {(live.live_rows_on_page ?? 0).toLocaleString()} of{' '}
          {(live.rows_on_page ?? 0).toLocaleString()} rows loaded here carry overlay
          values, but the overlay did not name which columns it recomputed.
          {live.off_reason ? ` ${live.off_reason}` : ''} Treat every column as the
          03:00 build until it does.
        </p>
        <ScopeNote live={live} />
      </div>
    )
  }
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
      <ScopeNote live={live} />
      {live.as_of_note && <p className={styles.sealLiveNote}>{live.as_of_note}</p>}
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
        ) : live.state === 'live_unnamed' ? (
          <span className={styles.sealUnnamed}>
            <UIcon name="warning" size={10} /> overlay (unnamed)
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

// A saved column preset is active when the columns on screen are exactly its
// list (order included — a preset owns its column ORDER, not just the set).
// The firm views surfaced as one-click tabs beside Overview (short tab labels
// override the longer view labels). Keys must exist in `meta.views`; a missing
// one renders nothing. Everything else stays in the Columns "Start from a layout".
const FEATURED_VIEWS = [
  { key: 'momentum', label: 'Momentum' },
  { key: 'bases', label: 'Base watch' },
  { key: 'uct_ratings', label: 'UCT Ratings' },
]

const sameCols = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])

export default function ShellToolbar({ meta, view, onView, visibleColumns, allColumns,
  onColumns, onResetColumns, density, onDensity, snapshot, snapshotDate,
  total, shown, isLoading, onExport, exportState, saveBar, reviewBar = null,
  libraryBar = null,
  presets = [], onApplyPreset, onDeletePreset, onSavePreset }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const overviewCols = (meta?.views || []).find(v => v.key === DEFAULT_VIEW)?.columns
  // Close the column picker on a click outside its anchor (button + popover) —
  // otherwise it stayed open until the Columns button was clicked a second time.
  const pickerAnchorRef = useRef(null)
  useEffect(() => {
    if (!pickerOpen) return undefined
    const onDoc = e => {
      if (pickerAnchorRef.current && !pickerAnchorRef.current.contains(e.target)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])
  return (
    <div className={styles.toolbar}>
      <div className={styles.viewTabs} role="tablist" aria-label="Column views">
        {/* Overview + a CURATED set of firm views as tabs (owner call,
            2026-09-22 — the mockup's Overview / Momentum / Base watch row). The
            other firm layouts still live only in the Columns picker's "Start from
            a layout" list; these few are the everyday workflows worth a one-click
            tab. A view is "active" when the on-screen columns ARE its set, so a
            layout, preset or manual column change correctly un-highlights it. */}
        {(meta?.views || []).filter(v => v.key === DEFAULT_VIEW).map(v => {
          const on = sameCols(visibleColumns, overviewCols)
          return (
            <button key={v.key} type="button" role="tab" aria-selected={on}
              className={`${styles.viewTab} ${on ? styles.viewTabOn : ''}`}
              onClick={() => onView(v.key)}>{v.label}</button>
          )
        })}
        {FEATURED_VIEWS.map(fv => {
          const v = (meta?.views || []).find(x => x.key === fv.key)
          if (!v) return null
          const on = sameCols(visibleColumns, v.columns)
          return (
            <button key={v.key} type="button" role="tab" aria-selected={on}
              className={`${styles.viewTab} ${on ? styles.viewTabOn : ''}`}
              onClick={() => onView(v.key)}>{fv.label}</button>
          )
        })}
        {/* The member's own saved column views, after the firm's. Each carries a
            gold dot + an inline delete; applying one sets the columns, so it is
            active exactly when the columns on screen are its list. */}
        {presets.map(p => {
          const on = sameCols(visibleColumns, p.columns)
          return (
            <span key={p.id} className={`${styles.presetTab} ${on ? styles.presetTabOn : ''}`}>
              <button type="button" role="tab" aria-selected={on} className={styles.presetTabBtn}
                onClick={() => onApplyPreset?.(p)}>
                <span className={styles.presetDot} aria-hidden="true" />{p.name}
              </button>
              {onDeletePreset && (
                <button type="button" className={styles.presetDel} aria-label={`Delete view ${p.name}`}
                  onClick={() => onDeletePreset(p.id)}>
                  <UIcon name="x" size={9} />
                </button>
              )}
            </span>
          )
        })}
      </div>
      <span className={styles.statusLine} aria-live="polite">
        {isLoading && !shown ? 'Scanning…' : `${(total ?? 0).toLocaleString()} matches`}
      </span>
      <Seal snapshot={snapshot} snapshotDate={snapshotDate} />
      <span className={styles.toolGroup}>
        <span className={styles.pickerAnchor} ref={pickerAnchorRef}>
          <button type="button" className={styles.toolBtn} aria-label="Choose columns"
            aria-expanded={pickerOpen} onClick={() => setPickerOpen(o => !o)}>
            <UIcon name="columns" size={13} /> Columns
          </button>
          <ColumnPicker open={pickerOpen} onClose={() => setPickerOpen(false)}
            allColumns={allColumns} visible={visibleColumns}
            onChange={onColumns} onReset={() => { onResetColumns(); setPickerOpen(false) }}
            onSavePreset={onSavePreset}
            layouts={meta?.views} onApplyLayout={cols => onColumns(cols)} />
        </span>
        <button type="button" className={styles.toolBtn} disabled={exportState?.busy} onClick={onExport}>
          <UIcon name="download" size={13} /> {exportState?.busy ? 'Exporting…' : 'CSV'}
        </button>
        {/* ⭐ THESE DOORS SIT WITH THE OTHER ACTIONS ON THE RESULT SET (Columns,
            CSV) rather than beside the filters — they act on the answer, not on
            the question. Each is a SLOT for the same reason: this toolbar renders
            chrome and must not learn what a review session, a saved scan or the
            structure library is. `libraryBar` (a reference to the STRUCTURE
            column's base structures) moved here out of the filter-chips row,
            where it read as a stray filter. */}
        {libraryBar}
        {reviewBar}
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
