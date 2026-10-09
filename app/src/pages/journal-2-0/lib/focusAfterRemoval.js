/**
 * Where keyboard focus goes when a confirmed delete removes the control that opened it
 * (wave 10 follow-up F7, Part C; F4's review, Important 1).
 *
 * ConfirmModal returns focus to its invoker on close, but a folder, saved-view or position
 * delete removes the invoker's own row before the dialog closes, so focus fell to <body>
 * (WCAG 2.4.3). The caller knows which list the row lived in, so it records, BEFORE the
 * removal, the keys of the rows that could take focus after it, and hands ConfirmModal a
 * resolver that looks them up AFTER the removal.
 *
 * ⛔ Keys, never elements. A folder delete moves its subfolders up one level, and React
 * remounts a moved row as a NEW element: a snapshot of elements would hold only
 * disconnected nodes by the time it is read.
 */

/** The keys that may take focus once `removedKey` is gone: the rows after it (nearest
 *  first), then the rows before it (nearest first). Empty when the key is not in the list. */
export function neighbourKeys(keys, removedKey) {
  const list = Array.isArray(keys) ? keys : []
  const i = list.indexOf(removedKey)
  if (i < 0) return []
  return [...list.slice(i + 1), ...list.slice(0, i).reverse()].filter((k) => k !== removedKey)
}

/** The keys of the elements under `root` that carry `attr`, in document order. */
export function keysInOrder(root, attr) {
  if (!root || typeof root.querySelectorAll !== 'function') return []
  return Array.from(root.querySelectorAll(`[${attr}]`)).map((el) => el.getAttribute(attr))
}

/** A candidate as an element: an element, a ref (`{ current }`), or a function returning either. */
export function asElement(candidate) {
  let c = candidate
  if (typeof c === 'function') c = c()
  if (c && typeof c === 'object' && !('nodeType' in c) && 'current' in c) c = c.current
  return c && c.nodeType === 1 ? c : null
}

/** Focus can land here: still in the document, focusable, not disabled. */
export function canTakeFocus(el) {
  return !!el && el.isConnected && typeof el.focus === 'function' && !el.disabled
    && el !== el.ownerDocument?.body
}

/** The first candidate that can take focus, or null. */
export function firstFocusable(...candidates) {
  for (const c of candidates) {
    const el = asElement(c)
    if (canTakeFocus(el)) return el
  }
  return null
}

/** A resolver for ConfirmModal's `fallbackFocus`: the first surviving neighbour row
 *  (`[attr="<key>"]` under `root`), else each later fallback in turn. */
export function neighbourFallback(root, attr, keys, ...fallbacks) {
  return () => {
    const r = asElement(root)
    const rows = r ? keys.map((k) => () => r.querySelector(`[${attr}="${cssEscape(k)}"]`)) : []
    return firstFocusable(...rows, ...fallbacks)
  }
}

/**
 * A resolver whose landing, when it is a control INSIDE a tree row, becomes that row.
 * F3 (screen-reader pass 2026-10-09): the folder tree's focus target is the `[role="treeitem"]`
 * (NVDA switches to focus mode for a focused tree view item, and not for a focused button), and
 * the keys the callers record live on the row's primary BUTTON. A landing outside any tree row
 * (a pane heading, a saved-view row) is returned unchanged.
 */
export function treeRowOf(resolve) {
  return () => {
    const el = asElement(resolve)
    if (!el) return null
    const row = typeof el.closest === 'function' ? el.closest('[role="treeitem"]') : null
    return row && canTakeFocus(row) ? row : el
  }
}

function cssEscape(v) {
  const s = String(v)
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s)
  return s.replace(/["\\]/g, '\\$&')
}
