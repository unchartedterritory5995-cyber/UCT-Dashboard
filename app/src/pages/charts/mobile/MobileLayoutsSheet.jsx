import { useState, useRef, useEffect } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import haptics from '../../../components/mobile/haptics'
import ArtifactHistory, { useArtifactVersionsAvailable } from '../../../components/artifactHistory/ArtifactHistory'
import RecentlyDeleted from '../../../components/artifactHistory/RecentlyDeleted'
import styles from './MobileCharts.module.css'

/* The phone's door to the workspace/layout system the desktop already has.
 *
 * ⭐ THIS SHEET OWNS NO PERSISTENCE. Every action is a call back into
 * ChartsWorkspace's EXISTING handlers — `applyTemplate`, `applyUctDefault`,
 * `handleSaveLayout`, `handleSaveAsTemplate`, `handleDeleteTemplate` — which are
 * the same functions the desktop menu calls. There is deliberately no
 * mobile-only layout store, no second `/api/charts/layouts` client and no
 * duplicated business logic: the 2026-09 research found the durable model
 * already existed and only the phone door was missing, so this is the door.
 *
 * ⛔ A TEMPLATE DOES NOT CARRY THE TICKERS. `handleSaveAsTemplate` sends
 * `groups: null` and `applyTemplate` deliberately leaves each color group's
 * symbol alone ("a template must not swap the stock you're looking at"). The
 * copy below says "arrangement" for that reason — do not promise symbols.
 *
 * ⛔ PREBUILT (`scope: 'global'`) ROWS ARE FIRM-PUBLISHED AND READ-ONLY unless
 * the viewer is an admin: the backend refuses a non-admin DELETE on a global
 * row, so the control is not rendered for them rather than rendered-and-failing.
 *
 * COV-06 (phone door): the same two version-history entry points the desktop
 * Layout Dock has — "Version history" on each of MY layouts, and "Recently
 * deleted" under My layouts — using the SAME shared components. Both are HIDDEN
 * unless the ARTIFACT_VERSIONS_ENABLED status probe answers 200, and the probe
 * only runs while this sheet is open. A restore/bring-back hands the route's row
 * to `onRestored`, which is ChartsWorkspace's `handleDockRestored` (adopts the
 * row; re-applies the OPEN layout without the switch flush).
 */
export default function MobileLayoutsSheet({
  open, onClose,
  mine = [],               // user-owned templates    (scope 'user')
  prebuilt = [],           // firm-published templates (scope 'global')
  active = null,           // { id, name, scope } | null — the open named layout
  isAdmin = false,
  loading = false,
  savedFlash = false,      // ChartsWorkspace's "just saved" pulse
  onApply,                 // (tpl) => void   — applyTemplate
  onApplyUctDefault,       // ()    => void   — the frozen restore point
  onSaveCurrent,           // ()    => void   — handleSaveLayout
  onSaveAs,                // (name, scope) => Promise<void> — handleSaveAsTemplate
  onDelete,                // (id)  => void   — handleDeleteTemplate
  onRestored,              // (row) => void   — handleDockRestored (COV-06)
  className = '',
}) {
  const [mode, setMode] = useState('list')       // 'list' | 'saveAs' | 'history'
  const [historyOf, setHistoryOf] = useState(null)   // the layout whose history is open
  const [deletedRev, setDeletedRev] = useState(0)    // re-reads Recently deleted after a delete
  const historyAvailable = useArtifactVersionsAvailable(!!open)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('user')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const inputRef = useRef(null)

  // Reopening always lands on the list — a half-typed name from last time is
  // noise, and a stranded delete confirmation is a hazard.
  useEffect(() => {
    if (!open) { setMode('list'); setName(''); setErr(''); setConfirmId(null); setBusy(false); setHistoryOf(null) }
  }, [open])

  // The keyboard only helps if the field is focused; a phone sheet that opens a
  // text mode without focus costs an extra tap every time.
  useEffect(() => {
    if (mode === 'saveAs') { const t = setTimeout(() => inputRef.current?.focus(), 120); return () => clearTimeout(t) }
    return undefined
  }, [mode])

  const activeId = active?.id ?? null
  const takenNames = new Set([...mine, ...prebuilt].map(t => (t.name || '').trim().toLowerCase()))

  const submitSaveAs = async () => {
    const nm = name.trim()
    if (!nm) { setErr('Name required'); return }
    if (takenNames.has(nm.toLowerCase())) { setErr('That name is already used'); return }
    setBusy(true); setErr('')
    try {
      await onSaveAs?.(nm, isAdmin ? scope : 'user')
      haptics.tap()
      onClose?.()
    } catch (e) {
      setErr(e?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const openHistory = (t) => { haptics.tap(); setConfirmId(null); setHistoryOf(t); setMode('history') }
  const restored = (row) => { if (row) onRestored?.(row) }

  const renderRow = (t, { deletable, versioned = false }) => {
    const isActive = t.id === activeId
    const confirming = confirmId === t.id
    return (
      <div key={`${t.scope || 'user'}-${t.id}`} className={styles.layoutRow}>
        <button
          type="button"
          className={styles.row}
          aria-current={isActive ? 'true' : undefined}
          aria-label={`Open layout ${t.name}`}
          onClick={() => { haptics.tap(); onClose?.(); onApply?.(t) }}
        >
          <span className={styles.rowIcon}>
            <UIcon name={isActive ? 'check' : 'columns'} size={16} gold={isActive} />
          </span>
          <span className={styles.rowLabel}>{t.name}</span>
          <span className={styles.rowRight}>
            {!deletable && <span className={styles.layoutBadge}>Firm</span>}
          </span>
        </button>
        {versioned && historyAvailable && !confirming && (
          <button
            type="button"
            className={styles.layoutHistory}
            aria-label={`Version history of layout ${t.name}`}
            onClick={() => openHistory(t)}
          >
            <UIcon name="clock" size={15} gold={false} />
          </button>
        )}
        {deletable && (confirming ? (
          <span className={styles.layoutConfirm}>
            <button type="button" className={styles.layoutConfirmYes} onClick={() => {
              setConfirmId(null)
              Promise.resolve(onDelete?.(t.id)).finally(() => setDeletedRev(n => n + 1))
            }}>Delete</button>
            <button type="button" className={styles.layoutConfirmNo} onClick={() => setConfirmId(null)}>Cancel</button>
          </span>
        ) : (
          <button
            type="button"
            className={styles.layoutDel}
            aria-label={`Delete layout ${t.name}`}
            onClick={() => { haptics.tap(); setConfirmId(t.id) }}
          >
            <UIcon name="trash" size={15} gold={false} />
          </button>
        ))}
      </div>
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      variant="bottom-sheet"
      title={mode === 'saveAs' ? 'Save layout as' : mode === 'history' ? 'Version history' : 'Layouts'}
      ariaLabel="Chart layouts"
      className={className}
    >
      {mode === 'history' && historyOf ? (
        <div className={`${styles.sheetList} ${styles.historyHost}`}>
          <button type="button" className={styles.row} onClick={() => { setMode('list'); setHistoryOf(null) }}>
            <span className={styles.rowLabel}>{'‹ Back'}</span>
          </button>
          <ArtifactHistory
            kind="layout"
            artifactId={historyOf.id}
            title={`Versions of “${historyOf.name}”`}
            onRestored={(res) => restored(res?.artifact)}
            onUnavailable={() => { setMode('list'); setHistoryOf(null) }}
          />
        </div>
      ) : mode === 'saveAs' ? (
        <div className={styles.sheetList}>
          <button type="button" className={styles.row} onClick={() => { setMode('list'); setErr('') }}>
            <span className={styles.rowLabel}>{'‹ Back'}</span>
          </button>
          <div className={styles.layoutForm}>
            <input
              ref={inputRef}
              className={styles.layoutInput}
              value={name}
              onChange={(e) => { setName(e.target.value); if (err) setErr('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSaveAs() }}
              placeholder="Layout name"
              aria-label="Layout name"
              maxLength={60}
              enterKeyHint="done"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
            />
            {isAdmin && (
              <div className={styles.layoutScope} role="radiogroup" aria-label="Who can see this layout">
                {[['user', 'Just me'], ['global', 'Firm-wide']].map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={scope === v}
                    className={scope === v ? styles.layoutScopeOn : styles.layoutScopeBtn}
                    onClick={() => setScope(v)}
                  >{label}</button>
                ))}
              </div>
            )}
            {err && <div className={styles.layoutErr} role="alert">{err}</div>}
            <button
              type="button"
              className={styles.layoutPrimary}
              disabled={busy || !name.trim()}
              onClick={submitSaveAs}
            >{busy ? 'Saving…' : 'Save layout'}</button>
            <div className={styles.layoutNote}>
              Saves the arrangement and chart settings. The tickers in each colour group stay
              as they are — opening a layout never swaps the symbol you are looking at.
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.sheetList}>
          <div className={styles.sectionLabel}>
            {active?.name ? `Current — ${active.name}` : 'Current — unsaved arrangement'}
          </div>

          <button type="button" className={styles.row} onClick={() => { haptics.tap(); onSaveCurrent?.() }}>
            <span className={styles.rowIcon}><UIcon name="pin" size={16} gold={false} /></span>
            <span className={styles.rowLabel}>{savedFlash ? 'Saved ✓' : 'Save'}</span>
            <span className={styles.rowSub}>{active?.name ? 'updates this layout' : 'keeps the working board'}</span>
          </button>

          <button type="button" className={styles.row} onClick={() => { haptics.tap(); setMode('saveAs') }}>
            <span className={styles.rowIcon}><UIcon name="copy" size={16} gold={false} /></span>
            <span className={styles.rowLabel}>Save as…</span>
            <span className={styles.rowRight}><UIcon name="chevronRight" size={14} gold={false} /></span>
          </button>

          <div className={styles.sectionLabel}>Prebuilt</div>
          <button
            type="button"
            className={styles.row}
            aria-current={active == null ? 'true' : undefined}
            onClick={() => { haptics.tap(); onClose?.(); onApplyUctDefault?.() }}
          >
            <span className={styles.rowIcon}><UIcon name={active == null ? 'check' : 'columns'} size={16} gold={active == null} /></span>
            <span className={styles.rowLabel}>UCT Default</span>
            <span className={styles.rowRight}><span className={styles.layoutBadge}>Firm</span></span>
          </button>
          {prebuilt.map(t => renderRow(t, { deletable: isAdmin }))}

          <div className={styles.sectionLabel}>My layouts</div>
          {loading && <div className={styles.layoutNote}>Loading…</div>}
          {!loading && mine.length === 0 && (
            <div className={styles.layoutNote}>
              None yet. “Save as…” keeps this arrangement so you can come back to it from any device.
            </div>
          )}
          {mine.map(t => renderRow(t, { deletable: true, versioned: true }))}

          {/* COV-06: a deleted layout's history outlives it; bring it back here.
              Hidden unless ARTIFACT_VERSIONS_ENABLED answers and something was deleted. */}
          {historyAvailable && (
            <div className={styles.historyHost}>
              <RecentlyDeleted kind="layout" noun="layout" refreshKey={deletedRev}
                onBroughtBack={(res) => restored(res?.artifact)} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
