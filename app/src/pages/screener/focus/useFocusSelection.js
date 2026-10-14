// useFocusSelection.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNeighborWarm } from '../../../hooks/useNeighborWarm'

const isEditable = t => !!t && (/^(input|textarea|select)$/i.test(t.tagName || '') || t.isContentEditable)

export default function useFocusSelection({ rows = [], hasMore = false, onLoadMore, onOpen, onFlag, onWatch, tf = 'D' } = {}) {
  const [index, setIndex] = useState(0)
  const firstTicker = rows[0]?.ticker ?? null
  const prevFirst = useRef(firstTicker)

  useEffect(() => {
    if (prevFirst.current !== firstTicker) { prevFirst.current = firstTicker; setIndex(0) }
  }, [firstTicker])
  useEffect(() => {
    if (index > 0 && index >= rows.length) setIndex(Math.max(0, rows.length - 1))
  }, [rows.length, index])

  const safe = Math.min(index, Math.max(0, rows.length - 1))
  const selected = rows.length ? rows[safe] : null
  const symbols = useMemo(() => rows.map(r => r.ticker), [rows])
  useNeighborWarm(symbols, selected?.ticker ?? null, tf)

  const select = useCallback(i => setIndex(Math.max(0, Math.min(i, rows.length - 1))), [rows.length])

  const onKeyDown = useCallback(e => {
    if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === 'ArrowDown' || k === 'j') {
      e.preventDefault()
      if (safe >= rows.length - 1) { if (hasMore) onLoadMore?.(); return }
      setIndex(safe + 1)
    } else if (k === 'ArrowUp' || k === 'k') {
      e.preventDefault(); setIndex(Math.max(0, safe - 1))
    } else if (k === 'Enter') {
      if (selected) { e.preventDefault(); onOpen?.(selected) }
    } else if (k === 'F' && e.shiftKey) {
      if (selected) { e.preventDefault(); onFlag?.(selected) }
    } else if (k === 'w' || k === 'W') {
      if (selected && !e.shiftKey) { e.preventDefault(); onWatch?.(selected) }
    }
  }, [safe, rows.length, hasMore, onLoadMore, onOpen, onFlag, onWatch, selected])

  return { index: safe, selected, select, onKeyDown }
}
