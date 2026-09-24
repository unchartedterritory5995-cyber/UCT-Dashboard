/**
 * Wave 6 — the table toolbar: a small floating bar that appears while the
 * caret is in a table, and only then.
 *
 * The table nodes themselves have been registered since the Notebook shipped
 * (`@tiptap/extension-table` in lib/tiptap.js) and `/table` inserts one, but
 * nothing could change a table once it existed: no row or column could be
 * added or removed, the header row could not be turned off, and the only way to
 * delete a table was to select all of its cells. This is that missing surface.
 *
 * ⛔ EVERY CONTROL IS A COMMAND THE TABLE EXTENSION ALREADY OWNS
 * (`addRowBefore`, `deleteColumn`, `toggleHeaderRow`, …). Nothing here edits
 * the document by hand, so the table stays a valid prosemirror-tables table
 * (its `fixTables` pass is the table extension's, not a second copy here).
 *
 * ⛔ A CONTROL THAT WOULD DO NOTHING IS DISABLED, NEVER SILENT: each button asks
 * `editor.can()` before it is offered (deleting the only column, for one).
 *
 * Keyboard: Tab / Shift-Tab move between cells (the table extension's own
 * keymap, railed in TableToolbar.test.jsx). Alt+F10 — the rich-editor
 * convention for "go to the toolbar" — moves focus onto this bar from inside a
 * table, and Escape hands it back to the cell it came from.
 *
 * Touch tier (≤1024px): every control meets `var(--tap-min)`.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { selectedRect } from '@tiptap/pm/tables'
import UIcon from '../../../../components/ui/UIcon'
import styles from './TableToolbar.module.css'

export const TABLE_TOOLBAR_LABEL = 'Table'

/** The table the selection sits in: `{ node, pos }` (pos is BEFORE the table), or null. */
export function tableAtSelection(state) {
  const $from = state?.selection?.$from
  if (!$from) return null
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d)
    if (node.type.name === 'table') return { node, pos: $from.before(d) }
  }
  return null
}

/**
 * ⛔ prosemirror-tables' `deleteRow` / `deleteColumn` answer `can()` with TRUE
 * even when the rows (or columns) in play are ALL of them — they refuse only
 * once asked to dispatch, and the click then does nothing at all. Deleting
 * every row is deleting the table, which has its own button; so those two are
 * disabled here, read from the SAME rectangle the commands themselves use.
 */
export function wouldEmptyTable(state, cmd) {
  let rect
  try { rect = selectedRect(state) } catch { return true }
  if (cmd === 'deleteRow') return rect.top === 0 && rect.bottom === rect.map.height
  if (cmd === 'deleteColumn') return rect.left === 0 && rect.right === rect.map.width
  return false
}

/** Does the table's FIRST row consist of header cells only? */
export function hasHeaderRow(table) {
  const first = table?.firstChild
  if (!first || !first.childCount) return false
  let all = true
  first.forEach((cell) => { if (cell.type.name !== 'tableHeader') all = false })
  return all
}

// One row of the bar: [command name, visible label, accessible name, icon].
// The command name is the table extension's own; `run` and `can` both read it.
const CONTROLS = [
  ['addRowBefore', 'Row above', 'Add a row above', 'plus'],
  ['addRowAfter', 'Row below', 'Add a row below', 'plus'],
  ['deleteRow', 'Delete row', 'Delete this row', 'trash'],
  ['addColumnBefore', 'Column left', 'Add a column to the left', 'plus'],
  ['addColumnAfter', 'Column right', 'Add a column to the right', 'plus'],
  ['deleteColumn', 'Delete column', 'Delete this column', 'trash'],
]

export default function TableToolbar({ editor }) {
  const barRef = useRef(null)

  const table = editor && !editor.isDestroyed && editor.isEditable ? tableAtSelection(editor.state) : null

  // Place the bar just above the table (below it when there is no room above),
  // clamped to the viewport. Written straight to the element: a position is not
  // state, and re-rendering the page to move a bar would be the wrong trade.
  const place = useCallback(() => {
    const bar = barRef.current
    if (!bar || !editor || editor.isDestroyed) return
    const at = tableAtSelection(editor.state)
    if (!at) return
    let dom = null
    try { dom = editor.view.nodeDOM(at.pos) } catch { dom = null }
    const rect = dom && typeof dom.getBoundingClientRect === 'function' ? dom.getBoundingClientRect() : null
    if (!rect) return
    const h = bar.offsetHeight || 0
    const w = bar.offsetWidth || 0
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0
    const left = Math.max(8, Math.min(rect.left, (vw || rect.left + w + 8) - w - 8))
    let top = rect.top - h - 6
    if (top < 8) top = rect.bottom + 6
    bar.style.left = `${Math.round(left)}px`
    bar.style.top = `${Math.round(top)}px`
  }, [editor])

  useLayoutEffect(() => { if (table) place() })

  useEffect(() => {
    if (!table) return undefined
    const onMove = () => place()
    // The app scrolls its inner .main, not the window: capture phase.
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [Boolean(table), place]) // eslint-disable-line react-hooks/exhaustive-deps

  // Alt+F10 from inside a table: focus the bar (and remember where to come back to).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const dom = editor.view?.dom
    if (!dom) return undefined
    const onKey = (e) => {
      if (e.key !== 'F10' || !e.altKey) return
      if (!tableAtSelection(editor.state) || !editor.isEditable) return
      const first = barRef.current?.querySelector('button:not([disabled])')
      if (!first) return
      e.preventDefault()
      first.focus()
    }
    dom.addEventListener('keydown', onKey)
    return () => dom.removeEventListener('keydown', onKey)
  }, [editor])

  if (!table) return null

  const can = (cmd) => {
    if (wouldEmptyTable(editor.state, cmd)) return false
    try { return Boolean(editor.can()[cmd]?.()) } catch { return false }
  }
  const run = (cmd) => {
    editor.chain().focus()[cmd]().run()
  }
  const header = hasHeaderRow(table.node)

  const onBarKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      // Back to the cell the member came from: focusing the bar never moved the
      // editor's own selection, so focusing the editor restores it.
      document.activeElement?.blur?.()
      editor.view.focus()
      return
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    // A toolbar is ONE tab stop in spirit; arrows move within it.
    const buttons = [...(barRef.current?.querySelectorAll('button:not([disabled])') || [])]
    const i = buttons.indexOf(document.activeElement)
    if (i < 0) return
    e.preventDefault()
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]
    next?.focus()
  }

  // A control must not take the caret out of the cell on mouse down; the chain
  // re-focuses the editor on run either way.
  const keep = (e) => e.preventDefault()

  return (
    <div
      ref={barRef}
      className={styles.bar}
      role="toolbar"
      aria-label={TABLE_TOOLBAR_LABEL}
      data-export-exclude
      onKeyDown={onBarKeyDown}
    >
      {CONTROLS.map(([cmd, label, name, icon], i) => (
        <span key={cmd} className={styles.slot}>
          {i === 3 && <span className={styles.divider} aria-hidden="true" />}
          <button
            type="button"
            className={styles.btn}
            onMouseDown={keep}
            onClick={() => run(cmd)}
            disabled={!can(cmd)}
            aria-label={name}
            title={name}
          >
            <UIcon name={icon} size={12} gold={false} />
            <span className={styles.label}>{label}</span>
          </button>
        </span>
      ))}
      <span className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.btn} ${header ? styles.btnOn : ''}`}
        onMouseDown={keep}
        onClick={() => run('toggleHeaderRow')}
        disabled={!can('toggleHeaderRow')}
        aria-pressed={header}
        aria-label="Header row"
        title={header ? 'Turn the header row off' : 'Make the first row a header'}
      >
        <span className={styles.label}>Header row</span>
      </button>
      <button
        type="button"
        className={`${styles.btn} ${styles.danger}`}
        onMouseDown={keep}
        onClick={() => run('deleteTable')}
        disabled={!can('deleteTable')}
        aria-label="Delete table"
        title="Delete this table"
      >
        <UIcon name="trash" size={12} gold={false} />
        <span className={styles.label}>Delete table</span>
      </button>
    </div>
  )
}
