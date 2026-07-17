// app/src/pages/charts/grid/useStaggeredMount.js
//
// Concurrency-limited mount queue for the multi-chart grid. At most `limit`
// cells are mounted-and-loading at once; a slot frees when the cell's chart
// reports first bars (StockChart onBarsReady) or after a safety timeout, so a
// dead ticker can't starve the queue. This bounds IN-FLIGHT requests — a fixed
// index*delay stagger doesn't (when the server is slow all N fetches pile up
// anyway, which is exactly the 2026-05-24 herd incident condition; see
// utils/barsIDB.js). Warm opens drain in milliseconds because IDB-cached cells
// release their slot on the same tick their bars paint.
//
// Contract: NEVER unmounts a live id (chart-instance-reuse invariant) — a
// layout switch only queues genuinely-new ids and purges removed ones.

import { useCallback, useEffect, useRef, useState } from 'react'

export default function useStaggeredMount(ids, { limit = 3, slotTimeoutMs = 5000 } = {}) {
  const [mountedIds, setMountedIds] = useState(() => new Set(ids.slice(0, limit)))
  const mountedRef = useRef(null)
  const pendingRef = useRef(null)   // mounted but not yet released (holds a slot)
  const queueRef = useRef(null)
  const timersRef = useRef(new Map())
  if (mountedRef.current === null) {
    mountedRef.current = new Set(ids.slice(0, limit))
    pendingRef.current = new Set(ids.slice(0, limit))
    queueRef.current = ids.slice(limit)
  }

  const releaseRef = useRef(null)

  const armTimer = useCallback((id) => {
    if (!(slotTimeoutMs > 0)) return
    const t = setTimeout(() => releaseRef.current?.(id), slotTimeoutMs)
    timersRef.current.set(id, t)
  }, [slotTimeoutMs])

  const admit = useCallback(() => {
    let changed = false
    while (pendingRef.current.size < limit && queueRef.current.length > 0) {
      const id = queueRef.current.shift()
      if (mountedRef.current.has(id)) continue
      mountedRef.current.add(id)
      pendingRef.current.add(id)
      armTimer(id)
      changed = true
    }
    if (changed) setMountedIds(new Set(mountedRef.current))
  }, [limit, armTimer])

  const release = useCallback((id) => {
    const timer = timersRef.current.get(id)
    if (timer) { clearTimeout(timer); timersRef.current.delete(id) }
    if (!pendingRef.current.delete(id)) return   // double-release is a no-op
    admit()
  }, [admit])
  releaseRef.current = release

  // Safety timers for the initially seeded batch.
  useEffect(() => {
    for (const id of pendingRef.current) {
      if (!timersRef.current.has(id)) armTimer(id)
    }
    const timers = timersRef.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconcile on id-set changes (layout switch): purge removed ids, queue new
  // ones, top up free slots. Never evicts a surviving mounted id.
  const idsKey = ids.join(',')
  useEffect(() => {
    const idsSet = new Set(ids)
    for (const id of [...mountedRef.current]) {
      if (!idsSet.has(id)) {
        mountedRef.current.delete(id)
        pendingRef.current.delete(id)
        const t = timersRef.current.get(id)
        if (t) { clearTimeout(t); timersRef.current.delete(id) }
      }
    }
    const queuedOrMounted = new Set([...mountedRef.current, ...queueRef.current])
    queueRef.current = queueRef.current.filter(id => idsSet.has(id))
    for (const id of ids) {
      if (!queuedOrMounted.has(id)) queueRef.current.push(id)
    }
    admit()
    setMountedIds(new Set(mountedRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, admit])

  return { mountedIds, release }
}
