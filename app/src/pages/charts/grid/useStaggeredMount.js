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

export default function useStaggeredMount(ids, { limit = 3, slotTimeoutMs = 5000, slotTimeoutFor = null, minAdmitIntervalMs = 0 } = {}) {
  const [mountedIds, setMountedIds] = useState(() => new Set(ids.slice(0, limit)))
  const mountedRef = useRef(null)
  const pendingRef = useRef(null)   // mounted but not yet released (holds a slot)
  const queueRef = useRef(null)
  const timersRef = useRef(new Map())
  const lastAdmitRef = useRef(0)     // when the last admission (or the seeded batch) happened
  const paceTimerRef = useRef(null)  // the one pending paced admission
  if (mountedRef.current === null) {
    mountedRef.current = new Set(ids.slice(0, limit))
    pendingRef.current = new Set(ids.slice(0, limit))
    queueRef.current = ids.slice(limit)
    lastAdmitRef.current = Date.now()
  }

  const releaseRef = useRef(null)
  const admitRef = useRef(null)
  // A per-id safety timeout, consulted when each slot is armed (a ref, so its identity can never
  // change armTimer or admit). Undefined falls back to `slotTimeoutMs`. It only shortens a timer
  // that already exists: admissions, and so commits, stay one per panel.
  const slotTimeoutForRef = useRef(slotTimeoutFor)
  slotTimeoutForRef.current = slotTimeoutFor

  const armTimer = useCallback((id) => {
    const ms = slotTimeoutForRef.current?.(id) ?? slotTimeoutMs
    if (!(ms > 0)) return
    const t = setTimeout(() => releaseRef.current?.(id), ms)
    timersRef.current.set(id, t)
  }, [slotTimeoutMs])

  // `minAdmitIntervalMs` paces admissions on top of the slot limit: a panel can report ready the
  // moment its cache answers, with its network reads still to come, so a free slot alone says
  // nothing about the load already started. Off (0) for every caller that does not pass it.
  const admit = useCallback(() => {
    if (minAdmitIntervalMs > 0) {
      if (paceTimerRef.current !== null) return
      if (!(pendingRef.current.size < limit && queueRef.current.length > 0)) return
      const wait = Math.min(minAdmitIntervalMs, minAdmitIntervalMs - (Date.now() - lastAdmitRef.current))
      if (wait > 0) {
        paceTimerRef.current = setTimeout(() => { paceTimerRef.current = null; admitRef.current?.() }, wait)
        return
      }
    }
    let changed = false
    while (pendingRef.current.size < limit && queueRef.current.length > 0) {
      const id = queueRef.current.shift()
      if (mountedRef.current.has(id)) continue
      mountedRef.current.add(id)
      pendingRef.current.add(id)
      armTimer(id)
      changed = true
      if (minAdmitIntervalMs > 0) {
        lastAdmitRef.current = Date.now()
        break
      }
    }
    if (changed) setMountedIds(new Set(mountedRef.current))
    if (changed && minAdmitIntervalMs > 0) admitRef.current?.()   // arms the next paced admission
  }, [limit, armTimer, minAdmitIntervalMs])
  admitRef.current = admit

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
      clearTimeout(paceTimerRef.current)
      paceTimerRef.current = null
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
