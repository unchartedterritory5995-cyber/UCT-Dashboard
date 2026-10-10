/**
 * Columns picker popover — Journal 2.0.
 * Spec §7.3 + §15.75.
 *
 * Renders as a popover anchored to the ▦ Columns button. Each entry
 * has: drag handle (keyboard-accessible via up/down buttons), checkbox,
 * label. Symbol + Actions are non-hideable — toggling them is a no-op.
 *
 * Order persists via the parent's useJ2ColumnPrefs hook; this component
 * only emits events. The pointer drag is the platform's own HTML5
 * drag-and-drop (CAP-A12: the app's one drag mechanism; this file was the
 * only @dnd-kit consumer). HTML5 drag never fires on touch, so the ↑/↓
 * buttons are the touch AND keyboard path §15.75 requires — the same
 * "drag is not the only door" rule the terminal's panel grip follows.
 */

import { useRef, useEffect, useState } from 'react'
import styles from './ColumnsPicker.module.css'

const COLUMN_DRAG_TYPE = 'application/x-uct-j2-column'

/** Move `key` to the slot `targetKey` occupies (arrayMove semantics). */
export function reorderKeys(keys, key, targetKey) {
  const from = keys.indexOf(key)
  const to = keys.indexOf(targetKey)
  if (from < 0 || to < 0 || from === to) return null
  const next = keys.slice()
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

function SortableRow({
  column,
  isHidden,
  isFirst,
  isLast,
  isDragging,
  isDropTarget,
  drag,
  onToggle,
  onMoveUp,
  onMoveDown,
}) {
  const style = {
    opacity: isDragging ? 0.5 : 1,
    outline: isDropTarget ? '1px dashed var(--border-accent)' : undefined,
  }

  return (
    <li
      style={style}
      className={styles.row}
      data-column-key={column.key}
      onDragOver={drag.onDragOver}
      onDragLeave={drag.onDragLeave}
      onDrop={drag.onDrop}
    >
      <button
        type="button"
        className={styles.handle}
        draggable
        onDragStart={drag.onDragStart}
        onDragEnd={drag.onDragEnd}
        aria-label={`Drag ${column.label}`}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <label className={styles.labelWrap}>
        <input
          type="checkbox"
          checked={!isHidden}
          onChange={() => onToggle(column.key)}
          disabled={column.nonHideable}
          className={styles.checkbox}
          aria-label={`Show ${column.label}`}
        />
        <span className={styles.label}>
          {column.label}
          {column.nonHideable && <span className={styles.lockedTag}>always on</span>}
        </span>
      </label>
      <div className={styles.moveBtns} aria-label="Reorder">
        <button
          type="button"
          className={styles.moveBtn}
          onClick={() => onMoveUp(column.key)}
          disabled={isFirst}
          aria-label={`Move ${column.label} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className={styles.moveBtn}
          onClick={() => onMoveDown(column.key)}
          disabled={isLast}
          aria-label={`Move ${column.label} down`}
        >
          ↓
        </button>
      </div>
    </li>
  )
}

export default function ColumnsPicker({
  open,
  anchorRef,
  columns,
  hiddenKeys,
  onToggle,
  onReorder,
  onReset,
  onClose,
}) {
  const popoverRef = useRef(null)
  const [dragKey, setDragKey] = useState(null)
  const [dropKey, setDropKey] = useState(null)

  // Close on outside click or Esc.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (popoverRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, anchorRef, onClose])

  if (!open) return null

  const dragFor = (key) => ({
    onDragStart: (e) => {
      try {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(COLUMN_DRAG_TYPE, key)
      } catch { /* a browser that refuses dataTransfer still has dragKey */ }
      setDragKey(key)
    },
    onDragEnd: () => { setDragKey(null); setDropKey(null) },
    onDragOver: (e) => {
      if (!dragKey) return
      e.preventDefault()
      try { e.dataTransfer.dropEffect = 'move' } catch { /* */ }
      if (dropKey !== key) setDropKey(key)
    },
    onDragLeave: (e) => {
      if (dropKey === key && !e.currentTarget.contains(e.relatedTarget)) setDropKey(null)
    },
    onDrop: (e) => {
      const from = dragKey || e?.dataTransfer?.getData?.(COLUMN_DRAG_TYPE) || null
      setDragKey(null)
      setDropKey(null)
      if (!from) return
      e.preventDefault()
      const newOrder = reorderKeys(columns.map((c) => c.key), from, key)
      if (newOrder) onReorder(newOrder)
    },
  })

  const moveUp = (key) => {
    const idx = columns.findIndex((c) => c.key === key)
    if (idx <= 0) return
    const newOrder = columns.map((c) => c.key)
    ;[newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]]
    onReorder(newOrder)
  }

  const moveDown = (key) => {
    const idx = columns.findIndex((c) => c.key === key)
    if (idx < 0 || idx === columns.length - 1) return
    const newOrder = columns.map((c) => c.key)
    ;[newOrder[idx + 1], newOrder[idx]] = [newOrder[idx], newOrder[idx + 1]]
    onReorder(newOrder)
  }

  return (
    <div
      ref={popoverRef}
      className={styles.popover}
      role="dialog"
      aria-label="Column visibility and order"
    >
      <div className={styles.popoverHeader}>
        <span className={styles.popoverTitle}>Columns</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onReset}
        >
          Reset
        </button>
      </div>
      <ul className={styles.list} role="list">
        {columns.map((column, i) => (
          <SortableRow
            key={column.key}
            column={column}
            isHidden={hiddenKeys.has(column.key)}
            isFirst={i === 0}
            isLast={i === columns.length - 1}
            isDragging={dragKey === column.key}
            isDropTarget={dragKey != null && dragKey !== column.key && dropKey === column.key}
            drag={dragFor(column.key)}
            onToggle={onToggle}
            onMoveUp={moveUp}
            onMoveDown={moveDown}
          />
        ))}
      </ul>
    </div>
  )
}
