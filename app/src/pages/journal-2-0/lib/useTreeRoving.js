/**
 * useTreeRoving: the keyboard model of a tree (WAI-ARIA tree view), for a tree whose rows are
 * rendered by ordinary components.
 *
 * Finish program, lane KEYS round 4. The Notebook's folder panel made every row, every arrow
 * and every row action its own Tab stop: 40 to 160 Tabs to get past it (Q2 and Q11 in
 * docs/notebook/fin-clicks.md). A tree is ONE Tab stop.
 *
 * It works on the DOM that is there, like `useToolbarRoving`, so the components keep their
 * shape. The markup contract, on elements inside the container:
 *
 *   [role="treeitem"]        one per row. Nested rows live inside their parent's treeitem, in a
 *                            [role="group"]. aria-expanded says whether a row is open (absent
 *                            on a row that cannot open). aria-label is the row's name.
 *   [data-tree-primary]      the control Enter and Space press (select the folder, open the note)
 *   [data-tree-toggle]       the control Right and Left press to open and close the row
 *
 * Keys, when focus is ON a treeitem, or on a button inside one (never in a field inside one,
 * such as rename; and Enter and Space on a button stay that button's own press):
 *
 *   Down / Up        next / previous visible row
 *   Home / End       first / last visible row
 *   Right            closed row: open it. Open row: its first child. Otherwise nothing.
 *   Left             open row: close it. Otherwise: its parent row.
 *   Enter / Space    press the row's primary control
 *   a letter         the next row whose name starts with what was typed (typing quickly
 *                    extends the search; it resets after half a second)
 *   Shift+F10 or the context-menu key     `onMenu(row)`: the caller opens the row's actions
 *
 * Exactly one row has tabIndex 0: the last row that had focus, else the selected row
 * (aria-selected="true"), else the first. A click on a control inside a row makes that row the
 * stop too, so Tab returns to where the member was working. Tabindex only: nothing here
 * changes what a click or a tap does.
 */
import { useCallback, useLayoutEffect, useRef } from 'react'

const ITEM = '[role="treeitem"]'
const TYPEAHEAD_MS = 500

export function treeItems(root) {
  return root ? [...root.querySelectorAll(ITEM)] : []
}
const own = (item, selector) => {
  // a control that belongs to THIS row, not to a row nested inside it
  for (const el of item.querySelectorAll(selector)) {
    if (el.closest(ITEM) === item) return el
  }
  return null
}
const nameOf = (item) => (item.getAttribute('aria-label') || item.textContent || '').trim().toLowerCase()

export default function useTreeRoving({ onMenu } = {}) {
  const ref = useRef(null)
  const stopRef = useRef(null)
  const typed = useRef({ text: '', at: 0 })

  const apply = useCallback(() => {
    const root = ref.current
    const items = treeItems(root)
    if (!items.length) return
    let stop = stopRef.current
    if (!stop || !items.includes(stop)) {
      stop = items.find((el) => el.getAttribute('aria-selected') === 'true') || items[0]
      stopRef.current = stop
    }
    for (const el of items) {
      // By attribute, not by property: a row with NO tabindex reads -1 and cannot take focus.
      const want = el === stop ? '0' : '-1'
      if (el.getAttribute('tabindex') !== want) el.setAttribute('tabindex', want)
    }
  }, [])

  useLayoutEffect(() => { apply() })
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || typeof MutationObserver === 'undefined') return undefined
    const mo = new MutationObserver(() => apply())
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  })

  const focusItem = useCallback((item) => {
    if (!item) return
    stopRef.current = item
    apply()
    item.focus()
  }, [apply])

  const onKeyDown = useCallback((e) => {
    const root = ref.current
    const target = e.target
    if (!root || !target || !target.matches || !root.contains(target)) return
    // The row itself, or a button or link inside a row: a member who CLICKED a folder has
    // focus on its button, and the arrows must carry on from that row. A field inside a row
    // (rename, new subfolder) keeps every key.
    const onRow = target.matches(ITEM)
    const item = onRow ? target : (target.matches('button, a[href]') ? target.closest(ITEM) : null)
    if (!item || !root.contains(item)) return
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      if (!onMenu) return
      e.preventDefault()
      onMenu(item)
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const items = treeItems(root)
    const i = items.indexOf(item)
    const expanded = item.getAttribute('aria-expanded')
    const go = (to) => { e.preventDefault(); focusItem(to) }
    switch (e.key) {
      case 'ArrowDown': if (i < items.length - 1) go(items[i + 1]); else e.preventDefault(); return
      case 'ArrowUp': if (i > 0) go(items[i - 1]); else e.preventDefault(); return
      case 'Home': go(items[0]); return
      case 'End': go(items[items.length - 1]); return
      case 'ArrowRight': {
        e.preventDefault()
        if (expanded === 'false') own(item, '[data-tree-toggle]')?.click()
        else if (expanded === 'true') {
          const child = [...item.querySelectorAll(ITEM)].find((el) => el.parentElement.closest(ITEM) === item)
          if (child) focusItem(child)
        }
        return
      }
      case 'ArrowLeft': {
        e.preventDefault()
        if (expanded === 'true') own(item, '[data-tree-toggle]')?.click()
        else focusItem(item.parentElement ? item.parentElement.closest(ITEM) : null)
        return
      }
      case 'Enter':
      case ' ': {
        if (!onRow) return                       // on a button inside the row: the button's own press
        e.preventDefault()
        own(item, '[data-tree-primary]')?.click()
        return
      }
      default:
    }
    if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now()
      const t = typed.current
      t.text = now - t.at > TYPEAHEAD_MS ? e.key.toLowerCase() : t.text + e.key.toLowerCase()
      t.at = now
      // a single repeated letter steps through the rows that start with it
      const from = t.text.length === 1 ? i + 1 : i
      const order = [...items.slice(from), ...items.slice(0, from)]
      const hit = order.find((el) => nameOf(el).startsWith(t.text))
      if (hit) { e.preventDefault(); if (hit !== item) focusItem(hit) }
    }
  }, [focusItem, onMenu])

  const onFocus = useCallback((e) => {
    const root = ref.current
    const item = e.target && e.target.closest ? e.target.closest(ITEM) : null
    if (!item || !root || !root.contains(item) || stopRef.current === item) return
    stopRef.current = item
    apply()
  }, [apply])

  return { ref, onKeyDown, onFocus, focusItem }
}
