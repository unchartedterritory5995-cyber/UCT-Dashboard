// app/src/components/chart/TracingsPanel.jsx — the Drawing Boards manager (content).
//
// "Drawing Boards" are named overlay sheets of drawings that span every ticker (our
// take on TC2000's boards). This panel lists the boards and is the surface for:
// picking the ACTIVE board (what you draw on), renaming a board, adding one, and
// deleting. It renders CONTENT only — the toolbar button owns the portal +
// positioning + open/close, so this stays a plain, testable component.
//
// Styled to MATCH the toolbar's "customize drawing tools" menu (FavoriteDrawingsMenu):
// same --menu-* chrome, 7/8px rows, a gold checkmark on the active row, gold-tint
// hover. Boards have NO color and NO default name; tracingLabel() supplies the
// "Board N" fallback. (Board colors were removed per owner decision 2026-08-28.)
import { useState, useCallback } from 'react'
import useTracings from './useTracings'
import { tracingLabel, peekTracingDrawings } from './drawingsStore'
import styles from './TracingsPanel.module.css'

const Check = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3,8.5 6.5,12 13,4.5" />
  </svg>
)
const Trash = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <polyline points="3,5 4,14 12,14 13,5" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="6" y1="3" x2="10" y2="3" />
  </svg>
)
const Plus = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />
  </svg>
)
const Pencil = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.8 2.6l2.6 2.6" /><path d="M11.6 1.8 14.2 4.4 5.4 13.2 2 14l.8-3.4z" />
  </svg>
)
const XMark = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
  </svg>
)

function BoardRow({ t, active, currentSym, onActivate, onRename, onDelete, canDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)

  const count = currentSym ? peekTracingDrawings(t.id, currentSym).length : 0
  const label = tracingLabel(t)

  const commit = () => {
    setEditing(false)
    const v = draft.trim()
    if (v !== (t.name || '')) onRename(t.id, v)
  }

  return (
    <div className={`${styles.row} ${active ? styles.rowActive : ''}`} data-testid="tracing-row">
      <button
        type="button"
        className={styles.pick}
        aria-pressed={active}
        title={active ? 'Active board — you draw on this one' : 'Draw on this board'}
        onClick={() => { setConfirming(false); onActivate(t.id) }}
      >
        <span className={styles.check}>{active ? <Check /> : null}</span>
        {editing ? (
          <input
            className={styles.nameInput}
            autoFocus
            value={draft}
            placeholder={label}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={`${styles.name} ${t.name ? '' : styles.namePlaceholder}`}
            onDoubleClick={(e) => { e.stopPropagation(); setDraft(t.name || ''); setEditing(true) }}
            title="Double-click to rename"
          >
            {label}
          </span>
        )}
      </button>

      <div className={styles.actions}>
        {currentSym ? <span className={styles.count} title={`${count} on ${currentSym}`}>{count}</span> : null}

        {confirming ? (
          <>
            <button
              type="button"
              className={styles.confirmDel}
              title="Confirm delete"
              aria-label={`Confirm delete ${label}`}
              onClick={(e) => { e.stopPropagation(); onDelete(t.id, label) }}
            >
              <Check />
            </button>
            <button
              type="button"
              className={styles.cancelDel}
              title="Cancel"
              aria-label="Cancel delete"
              onClick={(e) => { e.stopPropagation(); setConfirming(false) }}
            >
              <XMark />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={styles.edit}
              title="Rename this board"
              aria-label={`Rename ${label}`}
              onClick={(e) => { e.stopPropagation(); setDraft(t.name || ''); setEditing(true) }}
            >
              <Pencil />
            </button>
            <button
              type="button"
              className={styles.del}
              title={canDelete ? 'Delete this board' : 'Keep at least one board'}
              aria-label={`Delete ${label}`}
              disabled={!canDelete}
              onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
            >
              <Trash />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function TracingsPanel({ currentSym = null, onClose = null }) {
  const { tracings, activeId, createTracing, renameTracing, setActiveTracing, deleteTracing } = useTracings()

  const handleActivate = useCallback((id) => setActiveTracing(id), [setActiveTracing])
  const handleNew = useCallback(() => {
    const id = createTracing()
    setActiveTracing(id)          // a new board is made to draw on — switch to it
  }, [createTracing, setActiveTracing])
  // Deletion is confirmed inline in the row (a second ✓ button), NOT a browser
  // dialog — so this just removes the board once the row's confirm is clicked.
  const handleDelete = useCallback((id) => {
    deleteTracing(id)
  }, [deleteTracing])

  return (
    <div className={styles.panel} role="dialog" aria-label="Drawing Boards">
      <div className={styles.header}>
        <span className={styles.title}>Drawing Boards</span>
        {onClose ? (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        ) : null}
      </div>

      <div className={styles.list}>
        {tracings.map((t) => (
          <BoardRow
            key={t.id}
            t={t}
            active={t.id === activeId}
            currentSym={currentSym}
            onActivate={handleActivate}
            onRename={renameTracing}
            onDelete={handleDelete}
            canDelete={tracings.length > 1}
          />
        ))}
      </div>

      <button type="button" className={styles.newRow} onClick={handleNew}>
        <span className={styles.newIcon}><Plus /></span>
        <span>New board</span>
      </button>
    </div>
  )
}
