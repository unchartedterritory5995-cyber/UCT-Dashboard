// app/src/data/barStore/useBarSnapshot.js — React binding of the BarStore (P2b).
//
// useSyncExternalStore over one key: the component re-renders exactly when that key's
// snapshot identity changes (S10), and a key change returns the NEW key's snapshot in the
// same render — never the previous key's (S7). Subscribing starts the key's life cycle
// (hydrate, persist, live feed, network loop); unmounting the last subscriber stops it.

import { useCallback, useRef, useSyncExternalStore } from 'react'
import { getBarStore } from './index'
import { boardHiddenNow, forwardWhileCurrent, forwardWhileShown, useLayerBoard } from '../../components/chart/boardVisibility'

/**
 * @param {string|null} key   a barStore key (types.keyOf) or null (nothing subscribed)
 * @param {{depth?:number, session?:'rth'|'eth', priority?:'visible'|'urgent'|'grid'|'background', store?:object, wake?:'all'|'base'}} [opts]
 * @returns {import('./types').Snapshot|null}
 */
export function useBarSnapshot(key, { depth = 0, session = 'rth', priority = 'visible', store = null, wake = 'all' } = {}) {
  const s = store ?? getBarStore()
  // wake 'base': re-render only on BASE changes (the registry's split notify); the snapshot
  // returned is the one as of the last base change — a developing-bar tick never re-renders.
  const base = wake === 'base'
  // ⭐ (2026-11-27, board keep-alive, layer mode; boardVisibility.js) a hidden layer board KEEPS its key subscribed (its
  // network loop and live feed keep the store current, and a subscribed key is never evicted) but is not re-rendered
  // by it: while hidden the hook reads the snapshot it HELD at the hide. The show catches up in its own task: React
  // re-reads the store and re-renders only when the snapshot moved while hidden (review of #2901, M2: the first frame
  // after a show is never a stale one).
  const layer = useLayerBoard()
  const heldRef = useRef(null)
  const sub = useCallback((cb) => {
    if (!key) return () => {}
    // a CURRENT layer (the double-buffered row) keeps its BASE feed: re-rendered in an idle task while hidden
    const f = base && layer?.current ? forwardWhileCurrent(layer, cb) : forwardWhileShown(layer, cb)
    const off = s.subscribe(key, f.cb, { depth, session, priority, wake: base ? 'base' : 'all' })
    return () => { f.stop(); off() }
  }, [s, key, depth, session, priority, base, layer])
  const get = useCallback(() => {
    if (!key) return null
    const held = heldRef.current
    if (layer && held && held.key === key && boardHiddenNow(layer) && !(base && layer.current)) return held.snap
    return base ? s.getBaseSnapshot(key) : s.getSnapshot(key)
  }, [s, key, base, layer])
  const snap = useSyncExternalStore(sub, get, get)
  if (!layer || !boardHiddenNow(layer)) heldRef.current = { key, snap }
  return snap
}
