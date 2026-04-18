/**
 * Journal 2.0 — column picker prefs hook.
 *
 * Persists column order + visibility to localStorage (audit §6). Returns
 * a stable API: { columns, visibleColumns, toggleColumn, reorderColumns,
 * resetColumns }. `columns` is the ordered full list; `visibleColumns`
 * is what should actually render.
 *
 * Columns marked `nonHideable: true` in the default config are always
 * visible even if the stored state attempts to hide them (spec §7.3
 * rule: "Symbol and Actions are non-hideable").
 */

import { useCallback, useEffect, useState } from 'react'

/**
 * @typedef {Object} ColumnDef
 * @property {string} key
 * @property {string} label
 * @property {boolean} [nonHideable]
 * @property {string} [tooltip]
 */

/**
 * @param {string} storageKey
 * @param {ColumnDef[]} defaultColumns
 */
export default function useJ2ColumnPrefs(storageKey, defaultColumns) {
  const [order, setOrder] = useState(() => defaultColumns.map((c) => c.key))
  const [hidden, setHidden] = useState(() => new Set())

  // Hydrate from localStorage (post-mount to avoid SSR issues, though
  // this app is SPA — same shape keeps it portable).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.order)) {
        // Only accept keys that exist in the current defaults; drop unknowns.
        const known = new Set(defaultColumns.map((c) => c.key))
        const cleanOrder = parsed.order.filter((k) => known.has(k))
        // Append any new default columns that weren't in the saved order
        for (const c of defaultColumns) {
          if (!cleanOrder.includes(c.key)) cleanOrder.push(c.key)
        }
        setOrder(cleanOrder)
      }
      if (Array.isArray(parsed.hidden)) {
        setHidden(new Set(parsed.hidden))
      }
    } catch {
      // Corrupt JSON → ignore and use defaults
    }
  }, [storageKey])  // defaultColumns intentionally omitted — they're module-level constants

  // Persist on change.
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ order, hidden: [...hidden] }),
      )
    } catch {
      // Quota exceeded / private mode — silent; prefs are best-effort.
    }
  }, [storageKey, order, hidden])

  const columns = order
    .map((key) => defaultColumns.find((c) => c.key === key))
    .filter(Boolean)

  const visibleColumns = columns.filter(
    (c) => c.nonHideable || !hidden.has(c.key),
  )

  const toggleColumn = useCallback((key) => {
    const def = defaultColumns.find((c) => c.key === key)
    if (def?.nonHideable) return  // enforce non-hideable invariant
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [defaultColumns])

  const reorderColumns = useCallback((newOrder) => {
    // Keep only keys that exist in defaults
    const known = new Set(defaultColumns.map((c) => c.key))
    const cleaned = newOrder.filter((k) => known.has(k))
    // Append any missing
    for (const c of defaultColumns) {
      if (!cleaned.includes(c.key)) cleaned.push(c.key)
    }
    setOrder(cleaned)
  }, [defaultColumns])

  const resetColumns = useCallback(() => {
    setOrder(defaultColumns.map((c) => c.key))
    setHidden(new Set())
  }, [defaultColumns])

  return {
    columns,
    visibleColumns,
    hiddenKeys: hidden,
    toggleColumn,
    reorderColumns,
    resetColumns,
  }
}
