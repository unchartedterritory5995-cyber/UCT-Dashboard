// useFocusSelection.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNeighborWarm } from '../../../hooks/useNeighborWarm'
import { prefetchBars, prefetchBarsToIDB, warmMemFromIDB } from '../../../utils/prefetchBars'

// A focus walk is mostly downward: warm 4 ahead and 1 behind (not a symmetric
// ±6), and let the NEXT 2 rows bypass the cold-start pack-ingest hold.
export const WARM_AHEAD = 4
export const WARM_BEHIND = 1
export const URGENT_NEXT = 2

const EMPTY = []

const isEditable = t => {
  if (!t) return false
  if (/^(input|textarea|select)$/i.test(t.tagName || '') || t.isContentEditable) return true
  const role = typeof t.getAttribute === 'function' ? t.getAttribute('role') : null
  return role === 'textbox' || role === 'combobox'
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)

// resetKey must be a primitive (string or number), never an object: it is compared with !==.
export default function useFocusSelection({
  rows = EMPTY, resetKey, hasMore = false, onLoadMore, onOpen, onFlag, onWatch, tf = 'D',
} = {}) {
  // Selection is held as a TICKER (survives re-sorts) plus the last index (used
  // to clamp when the selected stock leaves the list), tagged with the resetKey
  // it belongs to.
  const [stored, setStored] = useState(() => ({
    resetKey, ticker: rows[0]?.ticker ?? null, lastIndex: 0,
  }))

  // Reset during render, not in an effect, so there is no one-frame flash of
  // the previous result set's selection.
  let sel = stored
  if (resetKey !== stored.resetKey) {
    sel = { resetKey, ticker: rows[0]?.ticker ?? null, lastIndex: 0 }
    setStored(sel)
  }

  const last = Math.max(0, rows.length - 1)
  const found = rows.findIndex(r => r.ticker === sel.ticker)
  // A re-sort moved the selected stock: remember where it now sits, so a later
  // disappearance clamps near where it last was.
  if (found >= 0 && found !== sel.lastIndex) {
    sel = { ...sel, lastIndex: found }
    setStored(sel)
  }
  const index = found >= 0 ? found : clamp(sel.lastIndex, 0, last)
  const selected = rows[index] ?? null

  const symbols = useMemo(() => rows.map(r => r.ticker), [rows])
  // radius 0: useNeighborWarm only registers the list's live prices here; the bar
  // warm is asymmetric, so it is done below.
  useNeighborWarm(symbols, selected?.ticker ?? null, tf, { radius: 0 })
  const selTicker = selected?.ticker ?? null
  useEffect(() => {
    const at = selTicker == null ? -1 : symbols.indexOf(selTicker)
    if (at < 0) return
    const onTf = tf || 'D'
    const ahead = symbols.slice(at + 1, at + 1 + WARM_AHEAD).filter(Boolean)
    const behind = symbols.slice(Math.max(0, at - WARM_BEHIND), at).filter(Boolean)
    const around = [...ahead, ...behind]
    if (!around.length) return
    warmMemFromIDB(around, [onTf])                      // durable -> sync mem, no network
    prefetchBarsToIDB(around, onTf, { priority: true }) // normal path: held during pack ingest
    // Next rows: opt-in bypass of the cold-start hold, capped at URGENT_NEXT inside.
    prefetchBars(ahead.slice(0, URGENT_NEXT), onTf, { urgent: true })
  }, [symbols, selTicker, tf])

  // The latest derived state, updated synchronously by commit() so that two
  // keydowns before a re-render both act on the state the first one left.
  const live = useRef(null)
  // eslint-disable-next-line react-hooks/refs -- latest-value ref: keydown handlers read it, commit() advances it between renders
  live.current = { sel, index, rows }

  const loadRequestedFor = useRef(null)
  const loadKey = (rs, rk) => `${rk}|${rs.length}`

  const commit = useCallback(i => {
    const cur = live.current
    if (!cur.rows.length) return
    const t = clamp(i, 0, cur.rows.length - 1)
    const next = { resetKey: cur.sel.resetKey, ticker: cur.rows[t].ticker, lastIndex: t }
    live.current = { ...cur, sel: next, index: t }
    setStored(next)
  }, [])

  const select = useCallback(i => commit(i), [commit])

  const onKeyDown = useCallback(e => {
    if (e.isComposing) return
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
    const { rows: rs, index: idx } = live.current
    const selRow = rs[idx] ?? null
    const k = e.key
    if (k === 'ArrowDown' || k === 'j') {
      e.preventDefault()
      if (idx >= rs.length - 1) {
        // Ask for the next page at most once per result set and length of the list we are on.
        const key = loadKey(rs, live.current.sel.resetKey)
        if (hasMore && !e.repeat && loadRequestedFor.current !== key) {
          loadRequestedFor.current = key
          onLoadMore?.()
        }
        return
      }
      commit(idx + 1)
    } else if (k === 'ArrowUp' || k === 'k') {
      e.preventDefault()
      if (idx > 0) commit(idx - 1)
    } else if (k === 'Enter') {
      if (selRow && !e.repeat) { e.preventDefault(); onOpen?.(selRow) }
    } else if (k === 'F' && e.shiftKey) {
      if (selRow && !e.repeat) { e.preventDefault(); onFlag?.(selRow) }
    } else if (k === 'w' || k === 'W') {
      if (selRow && !e.shiftKey && !e.repeat) { e.preventDefault(); onWatch?.(selRow) }
    }
  }, [commit, hasMore, onLoadMore, onOpen, onFlag, onWatch])

  return { index, selected, select, onKeyDown }
}
