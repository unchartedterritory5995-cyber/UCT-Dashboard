/**
 * Columns picker popover — Journal 2.0.
 * Spec §7.3 + §15.75.
 *
 * Renders as a popover anchored to the ▦ Columns button. Each entry
 * has: drag handle (keyboard-accessible via up/down buttons), checkbox,
 * label. Symbol + Actions are non-hideable — toggling them is a no-op.
 *
 * Order persists via the parent's useJ2ColumnPrefs hook; this component
 * only emits events. dnd-kit handles the pointer drag; arrow-button
 * equivalents provide the keyboard path §15.75 requires.
 */

import { useRef, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import styles from './ColumnsPicker.module.css'

function SortableRow({
  column,
  isHidden,
  isFirst,
  isLast,
  onToggle,
  onMoveUp,
  onMoveDown,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: column.key })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li ref={setNodeRef} style={style} className={styles.row}>
      <button
        type="button"
        className={styles.handle}
        {...attributes}
        {...listeners}
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = columns.findIndex((c) => c.key === active.id)
    const newIndex = columns.findIndex((c) => c.key === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const newOrder = arrayMove(columns.map((c) => c.key), oldIndex, newIndex)
    onReorder(newOrder)
  }

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
          className={styles.resetBtn}
          onClick={onReset}
        >
          Reset
        </button>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={columns.map((c) => c.key)}
          strategy={verticalListSortingStrategy}
        >
          <ul className={styles.list} role="list">
            {columns.map((column, i) => (
              <SortableRow
                key={column.key}
                column={column}
                isHidden={hiddenKeys.has(column.key)}
                isFirst={i === 0}
                isLast={i === columns.length - 1}
                onToggle={onToggle}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}
