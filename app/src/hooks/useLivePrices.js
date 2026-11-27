import { useEffect, useMemo, useRef, useState } from 'react'
import { registerTickers, subscribe, getSnapshot, pollNow } from './livePriceStore'
import { boardHiddenNow, useLayerBoard, whileBoardShown } from '../components/chart/boardVisibility'

/** True when every ticker in `key` maps to the same entry object in both snapshots. */
export function sameSlice(prev, next, key) {
  if (prev === next) return true
  if (!key) return true
  for (const t of key.split(',')) if (prev[t] !== next[t]) return false
  return true
}

/**
 * Fetch live prices for a list of tickers.
 * Returns { prices, isLoading, error, refresh }
 * where prices = { AAPL: { price: 195.23, change_pct: 1.45 }, ... }
 *
 * Backed by a shared singleton store (livePriceStore): all callers across the
 * app collapse into a SINGLE 2s poll of the union of their tickers, instead of
 * one poll per component. Each caller reads only its own slice. Same return
 * shape as before — consumers are unaffected.
 */
export default function useLivePrices(tickers = []) {
  // Stable, sorted, deduped key for this caller's ticker set.
  const key = tickers.length ? [...new Set(tickers)].filter(Boolean).sort().join(',') : ''

  // Subscribe to store updates -- re-render only when THIS caller's tickers changed (lane w9-10:
  // the store reuses an unmoved ticker's entry object, so a slice whose entries are all the same
  // references is unchanged and the update is skipped; four terminal panels on different names no
  // longer re-render each other on every 2 s poll). `keyRef` is the current key, read at emit time.
  const keyRef = useRef(key)
  keyRef.current = key
  const [all, setAll] = useState(getSnapshot)
  // Compared OUTSIDE setState: an updater that returns the previous state still costs React one
  // render of this component, which is the render this exists to skip.
  const allRef = useRef(all)
  allRef.current = all
  // ⭐ (2026-11-27, board keep-alive, layer mode; boardVisibility.js) a hidden layer board polls no price (its tickers
  // leave the shared poll) and is not re-rendered by one; after the show's first paint its tickers come back and it
  // re-reads the store once (a re-render only when its slice moved while hidden).
  const layer = useLayerBoard()
  const layerRef = useRef(layer)
  layerRef.current = layer
  useEffect(() => {
    const unsub = subscribe(() => {
      if (boardHiddenNow(layerRef.current)) return
      const next = getSnapshot()
      if (sameSlice(allRef.current, next, keyRef.current)) return
      allRef.current = next
      setAll(next)
    })
    setAll(getSnapshot()) // sync any value that landed before this effect ran
    return unsub
  }, [])
  // A new ticker set reads the store as it stands now (the held snapshot may predate it).
  useEffect(() => { setAll(getSnapshot()) }, [key])

  // Register/unregister this caller's tickers in the shared union.
  useEffect(() => {
    if (!key) return undefined
    let first = true
    return whileBoardShown(layer, () => {
      const off = registerTickers(key.split(','))
      if (!first) {
        const next = getSnapshot()
        if (!sameSlice(allRef.current, next, keyRef.current)) { allRef.current = next; setAll(next) }
      }
      first = false
      return off
    })
  }, [key, layer])

  // Select only this caller's slice (stable ref unless its tickers' data changes).
  const prices = useMemo(() => {
    if (!key) return {}
    const out = {}
    for (const t of key.split(',')) if (all[t]) out[t] = all[t]
    return out
  }, [all, key])

  return {
    prices,
    isLoading: key !== '' && Object.keys(prices).length === 0,
    error: null,
    refresh: pollNow,
  }
}
