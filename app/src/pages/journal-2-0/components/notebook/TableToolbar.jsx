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
 * ⛔ THE ROW / COLUMN / HEADER CONTROLS ARE COMMANDS THE TABLE EXTENSION
 * ALREADY OWNS (`addRowBefore`, `deleteColumn`, `toggleHeaderRow`, …), so the
 * table stays a valid prosemirror-tables table (its `fixTables` pass is the
 * table extension's, not a second copy here). ⚰️ This said "nothing here edits
 * the document by hand" until wave 10 (G-134): Sort and Wider / Narrower are
 * transaction builders in `lib/tableTools.js` — each ONE transaction over
 * prosemirror-tables' own `TableMap`, reordering whole rows or writing the
 * same `colwidth` the drag handle writes, so the table's shape never changes.
 *
 * ⛔ A CONTROL THAT WOULD DO NOTHING IS DISABLED, NEVER SILENT: each button asks
 * `editor.can()` before it is offered (deleting the only column, for one).
 *
 * Keyboard: Tab / Shift-Tab move between cells (the table extension's own
 * keymap, railed in TableToolbar.test.jsx). Alt+F10 — the rich-editor
 * convention for "go to the toolbar" — moves focus onto this bar from inside a
 * table, and Escape hands it back to the cell it came from.
 *
 * ⛔ THE BAR IS ONE TAB STOP (screen-reader pass 2026-10-09, finding F2). Each of
 * its twelve buttons used to be its own Tab stop, so from the note heading Tab
 * reached the body on the 29th press on any note with a table, while the Editor
 * toolbar two stops earlier was ONE stop with arrow roving. The same hook now
 * runs this bar (`lib/useToolbarRoving.js`): exactly one enabled control holds
 * tabIndex 0, Left and Right move one control and wrap, Home and End jump to
 * the ends, and the stop follows focus. The first stop is the first ENABLED
 * control, because the hook never gives the stop to a disabled one. Escape is
 * this file's own key (the hook does not know about the editor).
 * Rail: TableToolbar.oneStop.test.jsx.
 *
 * Touch tier (≤1024px): every control meets `var(--tap-min)`.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { selectedRect } from '@tiptap/pm/tables'
import UIcon from '../../../../components/ui/UIcon'
import useToolbarRoving from '../../lib/useToolbarRoving'
import {
  COLUMN_MAX_PX, COLUMN_MIN_PX, COLUMN_STEP_PX, canSortTable, currentColumnWidth,
  hasHeaderRowNode, setColumnWidthTr, sortTableTr, tableContext,
} from '../../lib/tableTools'
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
 * Wave 10 (lane TY7): the bump-reducer's SIGNAL is whether the caret is inside
 * a table, never the table/button state itself -- the component re-reads
 * `tableAtSelection(editor.state)` (and every `can()`/`sortable`/`width` read)
 * fresh in its own render body regardless, exactly as it did before this fix.
 * This only decides whether a transaction is worth a NEW reference.
 *
 * - Outside a table, two transactions IN A ROW (prev was already `null`) bail
 *   to the SAME `null` reference -- the common case for every note with no
 *   table in it, which used to re-render this (always-null-rendering) bar on
 *   every keystroke of every note, table or not.
 * - Entering or leaving a table is always a NEW reference (`null` <-> `{}`),
 *   so the bar's mount/unmount keeps following the caret exactly as before.
 * - WHILE inside a table, every transaction returns a FRESH `{}` -- never
 *   bails -- so a row/column edit (which never touches `tableAtSelection`'s
 *   own answer, only the TABLE's shape) still re-renders this bar with no
 *   external driver, the property `TableToolbar.test.jsx`'s "owns its own
 *   freshness" describe block pins directly.
 */
export function tableBumpReducer(prev, editor) {
  if (!editor || editor.isDestroyed) return prev
  const inTable = Boolean(editor.isEditable && tableAtSelection(editor.state))
  if (!inTable) return prev === null ? prev : null
  return {}
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

/** Does the table's FIRST row consist of header cells only? ⛔ One
 *  implementation: the sort pins exactly the row this button says is a header
 *  (lib/tableTools.js), so the two can never disagree. */
export function hasHeaderRow(table) {
  return hasHeaderRowNode(table)
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
  // F2: the one-stop toolbar pattern, on the DOM that is there. The hook owns tabindex and
  // the arrow keys; this component keeps Escape and Alt+F10. The hook's ref is the bar's DOM
  // ref (as in WidgetEmbedView). `barRef` is this component's own ref to the SAME element,
  // mirrored after every commit, for placement (which writes the bar's style) and Alt+F10.
  // ⛔ Each shorter wiring trips the React Compiler lint: a merged callback ref writes into the
  // hook's ref (NoteEditorPage's wiring, refused as a mutation); reading `.current` off the
  // hook's returned object marks every `roving.*` in JSX as a ref access; and a callback that
  // reads `.current` off a destructured hook field is not seen as reading a ref at all.
  const { ref: rovingRef, onKeyDown: rovingKeyDown, onFocus: rovingFocus } = useToolbarRoving()
  const barRef = useRef(null)
  useLayoutEffect(() => { barRef.current = rovingRef.current })

  // Wave 10 (TY, standard 4): this component's OWN subscription, mirroring
  // LinkPasteMenu -- not a field on NoteEditorPage's toolbar-sync reducer. This
  // bar reads a LOT at render time (`table`/`tableAtSelection`, and per-command
  // `editor.can()` results for six row/column buttons below, `sortable`, `ctx`,
  // `width`, `header`), all selection- or doc-dependent, and every one of them
  // would need its own signature field to stay fresh behind that reducer's
  // bailout -- table edits (Add a row, Delete column, …) are themselves
  // transactions that don't touch a mark/block/font field, so a table-only
  // session would otherwise never re-render this bar's DISABLED states after
  // the first edit. NoteEditorPage.jsx's own audit table (readToolbarFormatState)
  // names this file precisely so nobody re-adds `inTable` there believing it is
  // still needed.
  //
  // ⛔⛔ Wave 10 (lane TY7, "whose caller" perf pass): "costs nothing the typing
  // budget measures" was WRONG, measured -- this line used to bump a BARE
  // counter (`(x) => x + 1`) on every transaction, unconditionally, in every
  // note, table or not. React's own `commitBeforeMutationEffects` runs a
  // selection-offset DOM walk over the ENTIRE focused contenteditable on every
  // commit (`vendor-react …js:6690` -- confirmed by reading the compiled,
  // unminified React source, not assumed): it does not care whether THIS
  // component's commit did anything, only that a commit happened while the
  // editor (a contentEditable) has focus. A CPU-profile caller-tree walk
  // (docs/notebook/perf-runs/ty7/) traced the bulk of that cost to exactly
  // this always-new counter forcing a commit on a note with NO table at all --
  // disabling it alone cut commitBeforeMutationEffects from 0.736 to 0.047
  // ms/key at 2,000 paragraphs (a diagnostic revert, not this fix).
  // `tableBumpReducer` keeps the stated goal (a table edit always re-renders
  // this bar, with NO external re-render driver -- TableToolbar.test.jsx's
  // "owns its own freshness" describe block) but stops bumping when the caret
  // stays OUTSIDE a table across consecutive transactions, which is every
  // keystroke in a note that has no table in it at all.
  const [, bump] = useReducer(tableBumpReducer, null)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined
    const update = () => bump(editor)
    editor.on('transaction', update)
    return () => { editor.off('transaction', update) }
  }, [editor])

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
      // The bar's ONE Tab stop (the control the roving hook marked), else its first
      // enabled control: Alt+F10 lands where Tab would.
      const bar = barRef.current
      const first = bar?.querySelector('button[tabindex="0"]:not([disabled])')
        || bar?.querySelector('button:not([disabled])')
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

  // Wave 10 (G-134): sort by the caret's column, and size that column. Each is
  // ONE transaction (lib/tableTools.js), so one Undo reverses it. The drag
  // handle between columns (the table extension's column resizing, mouse only)
  // and Wider / Narrower write the same stored `colwidth`; the buttons are the
  // keyboard and touch door to it.
  const sortable = canSortTable(editor.state)
  const ctx = tableContext(editor.state)
  const width = ctx ? currentColumnWidth(editor.view, ctx) : null
  const dispatch = (tr) => {
    if (!tr || editor.isDestroyed) return
    editor.view.dispatch(tr.scrollIntoView())
    editor.view.focus()
  }
  const sortBy = (dir) => dispatch(sortTableTr(editor.state, dir))
  const resizeBy = (delta) => {
    const now = tableContext(editor.state)
    if (!now) return
    dispatch(setColumnWidthTr(editor.state, now, now.col, currentColumnWidth(editor.view, now) + delta))
  }

  const onBarKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      // Back to the cell the member came from: focusing the bar never moved the
      // editor's own selection, so focusing the editor restores it.
      document.activeElement?.blur?.()
      // ⛔ `editor.view` THROWS once the editor is destroyed (a note switch
      // with the bar still focused) — wave 6 fix round 5, R5-1 sweep.
      if (!editor.isDestroyed) editor.view.focus()
      return
    }
    // Left / Right (wrapping), Home / End: the one-stop hook's keys. ⚰️ This file carried
    // its own Left/Right walk over `button:not([disabled])` while every control stayed a
    // Tab stop — arrows that moved within a bar nobody could skip past.
    rovingKeyDown(e)
  }

  // A control must not take the caret out of the cell on mouse down; the chain
  // re-focuses the editor on run either way.
  const keep = (e) => e.preventDefault()

  return (
    <div
      ref={rovingRef}
      className={styles.bar}
      role="toolbar"
      aria-label={TABLE_TOOLBAR_LABEL}
      data-export-exclude
      onKeyDown={onBarKeyDown}
      onFocus={rovingFocus}
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
        className={styles.btn}
        onMouseDown={keep}
        onClick={() => sortBy('asc')}
        disabled={!sortable.ok}
        aria-label="Sort rows by this column, A to Z"
        title={sortable.ok ? 'Sort the rows by this column: A to Z, smallest number first (the header row stays on top)' : sortable.reason}
      >
        <span className={styles.label}>Sort A→Z</span>
      </button>
      <button
        type="button"
        className={styles.btn}
        onMouseDown={keep}
        onClick={() => sortBy('desc')}
        disabled={!sortable.ok}
        aria-label="Sort rows by this column, Z to A"
        title={sortable.ok ? 'Sort the rows by this column: Z to A, largest number first (the header row stays on top)' : sortable.reason}
      >
        <span className={styles.label}>Sort Z→A</span>
      </button>
      <button
        type="button"
        className={styles.btn}
        onMouseDown={keep}
        onClick={() => resizeBy(-COLUMN_STEP_PX)}
        disabled={width == null || width <= COLUMN_MIN_PX}
        aria-label="Make this column narrower"
        title="Make this column narrower (or drag the column's edge)"
      >
        <span className={styles.label}>Narrower</span>
      </button>
      <button
        type="button"
        className={styles.btn}
        onMouseDown={keep}
        onClick={() => resizeBy(COLUMN_STEP_PX)}
        disabled={width == null || width >= COLUMN_MAX_PX}
        aria-label="Make this column wider"
        title="Make this column wider (or drag the column's edge)"
      >
        <span className={styles.label}>Wider</span>
      </button>
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
