// app/src/data/barStore/useBarSnapshot.js — React binding of the BarStore (P2b).
//
// useSyncExternalStore over one key: the component re-renders exactly when that key's
// snapshot identity changes (S10), and a key change returns the NEW key's snapshot in the
// same render — never the previous key's (S7). Subscribing starts the key's life cycle
// (hydrate, persist, live feed, network loop); unmounting the last subscriber stops it.

import { useCallback, useRef, useSyncExternalStore } from 'react'
import { getBarStore } from './index'
import { useBoardHidden } from '../../components/chart/boardVisibility'

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
  // ⭐ (2026-11-27, board keep-alive, layer mode; boardVisibility.js) a hidden layer board subscribes to nothing: its
  // key's network loop, live feed and persist stop as at an unmount, and the show subscribes again. While hidden it
  // reads the snapshot it HELD at the hide, so nothing the store does meanwhile (an eviction included) reaches its chart.
  const hidden = useBoardHidden()
  const sub = useCallback(
    (cb) => (key && !hidden ? s.subscribe(key, cb, { depth, session, priority, wake: base ? 'base' : 'all' }) : () => {}),
    [s, key, depth, session, priority, base, hidden],
  )
  const get = useCallback(() => (key ? (base ? s.getBaseSnapshot(key) : s.getSnapshot(key)) : null), [s, key, base])
  const heldRef = useRef(null)
  const getHeld = useCallback(() => (heldRef.current && heldRef.current.key === key ? heldRef.current.snap : get()), [key, get])
  const read = hidden ? getHeld : get
  const snap = useSyncExternalStore(sub, read, read)
  if (!hidden) heldRef.current = { key, snap }
  return snap
}
