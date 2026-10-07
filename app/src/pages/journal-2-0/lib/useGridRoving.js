/**
 * useGridRoving: ONE Tab stop for a list of rows where each row holds a few controls.
 *
 * Finish program, lane KEYS round 5. The Notebook's notes list: every note is two controls (its
 * tick box and its card), sometimes three (Unarchive, Restore). With 50 notes that is 100 Tab
 * stops between the list's header and whatever comes after the list, and two Tabs per note for
 * a member ticking notes (Q11 in docs/notebook/fin-clicks.md).
 *
 * The rows keep their markup and their roles: a tick box is still a checkbox, a card is still
 * a button, and Space and Enter are still theirs. This hook only decides which ONE control is
 * in the Tab order and moves focus with the arrow keys:
 *
 *   Down / Up        the same control in the next / previous row (the tick stays on ticks,
 *                    the card on cards; a row with fewer controls takes its last one)
 *   Right / Left     the next / previous control in the same row
 *   Home / End       the first / last row, same control
 *
 * What it deliberately leaves alone:
 *   - any arrow with Shift held. Shift+Down and Shift+Up on a tick box extend the selection
 *     (lane 13Q-5, NotebookTab's own handler). That handler moves focus itself; the stop
 *     follows focus.
 *   - Ctrl, Cmd and Alt chords (Ctrl+Alt+B to the bulk bar, Ctrl+Alt+D).
 *   - Up and Down on a <select>, and every arrow in a text field: those keys are the control's.
 *
 * Rows are found by `rowSelector` inside the container. Controls are the row's buttons, links,
 * tick boxes and selects that are on screen. Tabindex only: nothing here changes a click or a tap.
 *
 * Lane KEYS3: a row that carries a tabindex of its own (a table row that opens its note on
 * Enter) counts as the first control of that row. `components/mobile/ResponsiveTable.jsx` uses
 * this hook for its opt-in `oneTabStop`, so the table view and the card view share one model.
 */
import { useCallback, useLayoutEffect, useRef } from 'react'

// `[data-grid-cell]`: a cell that is a control without being one of these elements (the Trades
// table's symbol cell is a <td> that opens its trade on Enter, and keeps its cell role).
const CONTROLS = 'button, a[href], input, select, textarea, [data-grid-cell]'
const isText = (el) => el.tagName === 'TEXTAREA'
  || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type))

function shown(list) {
  const on = list.filter((el) => el.getClientRects().length > 0)
  return on.length ? on : list              // no layout at all (a test environment): all count
}

export function gridRows(root, rowSelector) {
  if (!root) return []
  const all = [...root.querySelectorAll(CONTROLS)].filter((el) => !el.disabled && el.type !== 'hidden')
  const live = new Set(shown(all))
  return [...root.querySelectorAll(rowSelector)]
    .map((row) => {
      // a row that is itself one control (a card with no tick box beside it) is its own cell
      if (row.matches(CONTROLS)) return live.has(row) ? [row] : []
      const inside = [...row.querySelectorAll(CONTROLS)].filter((el) => live.has(el) && el.closest(rowSelector) === row)
      // a row that is itself focusable (a table row that opens on Enter: the shared
      // ResponsiveTable with `oneTabStop`) is the first cell of its own row
      return row.hasAttribute('tabindex') ? [row, ...inside] : inside
    })
    .filter((cells) => cells.length > 0)
}

export default function useGridRoving({ rowSelector, enabled = true } = {}) {
  const ref = useRef(null)
  const stopRef = useRef(null)

  const apply = useCallback(() => {
    const root = ref.current
    if (!root) return
    const marked = [...root.querySelectorAll('[data-grid-roving]')]
    if (!enabled) {
      for (const el of marked) { el.removeAttribute('tabindex'); el.removeAttribute('data-grid-roving') }
      stopRef.current = null
      return
    }
    const rows = gridRows(root, rowSelector)
    const cells = rows.flat()
    for (const el of marked) if (!cells.includes(el)) { el.removeAttribute('tabindex'); el.removeAttribute('data-grid-roving') }
    if (!cells.length) return
    let stop = stopRef.current
    if (!stop || !cells.includes(stop)) { stop = cells[0]; stopRef.current = stop }
    for (const el of cells) {
      const want = el === stop ? '0' : '-1'
      if (el.getAttribute('tabindex') !== want) el.setAttribute('tabindex', want)
      if (!el.hasAttribute('data-grid-roving')) el.setAttribute('data-grid-roving', '')
    }
  }, [rowSelector, enabled])

  useLayoutEffect(() => { apply() })
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || typeof MutationObserver === 'undefined') return undefined
    const mo = new MutationObserver(() => apply())
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  })

  const onKeyDown = useCallback((e) => {
    if (!enabled) return
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target
    if (!t || !t.tagName) return
    if (isText(t)) return
    if (t.tagName === 'SELECT' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return
    const rows = gridRows(ref.current, rowSelector)
    const r = rows.findIndex((cells) => cells.includes(t))
    if (r === -1) return
    const c = rows[r].indexOf(t)
    const inRow = (row) => row[Math.min(c, row.length - 1)]
    let next = t
    if (e.key === 'ArrowDown') next = r < rows.length - 1 ? inRow(rows[r + 1]) : t
    else if (e.key === 'ArrowUp') next = r > 0 ? inRow(rows[r - 1]) : t
    else if (e.key === 'ArrowRight') next = c < rows[r].length - 1 ? rows[r][c + 1] : t
    else if (e.key === 'ArrowLeft') next = c > 0 ? rows[r][c - 1] : t
    else if (e.key === 'Home') next = inRow(rows[0])
    else next = inRow(rows[rows.length - 1])
    e.preventDefault()
    if (next === t) return
    stopRef.current = next
    apply()
    next.focus()
  }, [apply, enabled, rowSelector])

  const onFocus = useCallback((e) => {
    if (!enabled) return
    const t = e.target
    if (!t || !t.hasAttribute || !t.hasAttribute('data-grid-roving') || stopRef.current === t) return
    stopRef.current = t
    apply()
  }, [apply, enabled])

  return { ref, onKeyDown, onFocus }
}
