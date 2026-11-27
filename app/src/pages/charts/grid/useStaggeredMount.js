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
//
// ⚡ (2026-11-26, the board switch; owner: "never a lone chart") TWO SWITCH LANES, both opt-in per render:
//  · `admitNowFor(id)`: a new id it answers true for is mounted in THIS render, so in the switch's own commit, beside
//    every other such id, outside the limit and the pacing (the board passes it only on a member's switch, for charts
//    whose bars are already held: no history to fetch, so no herd; their small freshness reads go out together). The
//    admission is recorded after the commit and holds NO slot (it was admitted outside the limit): a warm chart reports
//    ready in its own mount effect, which runs before this board's, and a slot it held would wait for the 5 s timer and
//    keep a mixed board's cold charts out (review of the warm admission, finding 1).
//  · `nextFrameFor(id)`: a new id it answers true for is admitted one animation frame after the switch instead of
//    waiting its turn in the paced queue (the board: a switch's non-chart widgets).
// Everything else (cold charts, first loads, the board's own reverts) queues exactly as before.

import { useCallback, useEffect, useRef, useState } from 'react'

const NO_IDS = Object.freeze([])
const nextFrame = (f) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16))

export default function useStaggeredMount(ids, { limit = 3, slotTimeoutMs = 5000, slotTimeoutFor = null, minAdmitIntervalMs = 0, admitNowFor = null, nextFrameFor = null } = {}) {
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

  // the switch lanes (see the header): ids this render mounts at once. They stay mounted in every render until an
  // effect has recorded them (a render between the commit and that effect no longer has `admitNowFor`, and must not
  // drop a body it already mounted: the chart-instance-reuse invariant)
  const stickyNowRef = useRef(null)
  if (stickyNowRef.current === null) stickyNowRef.current = new Set()
  if (admitNowFor) for (const id of ids) if (!mountedRef.current.has(id) && admitNowFor(id)) stickyNowRef.current.add(id)
  const nextFrameForRef = useRef(nextFrameFor)
  nextFrameForRef.current = nextFrameFor
  const idsRef = useRef(ids)
  idsRef.current = ids

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

  // The ids admitted at once (the switch lane) are recorded after the commit that mounted them, as mounted only: they
  // hold no slot (see the header). Declared before the reconcile below, which then finds them mounted, not new.
  useEffect(() => {
    const sticky = stickyNowRef.current
    if (!sticky.size) return
    const idsNow = new Set(idsRef.current)
    let changed = false
    for (const id of sticky) {
      if (!idsNow.has(id) || mountedRef.current.has(id)) continue
      mountedRef.current.add(id)
      changed = true
    }
    sticky.clear()
    if (changed) setMountedIds(new Set(mountedRef.current))
  })

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
    const soon = []
    for (const id of ids) {
      if (queuedOrMounted.has(id)) continue
      if (nextFrameForRef.current?.(id)) soon.push(id)
      else queueRef.current.push(id)
    }
    if (soon.length) {
      nextFrame(() => {
        let changed = false
        for (const id of soon) {
          if (mountedRef.current.has(id) || !idsRef.current.includes(id)) continue
          mountedRef.current.add(id)
          pendingRef.current.add(id)
          armTimer(id)
          changed = true
        }
        if (changed) setMountedIds(new Set(mountedRef.current))
      })
    }
    admit()
    setMountedIds(new Set(mountedRef.current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, admit])

  // the ids this render admits at once are mounted in it (the state catches up after the commit, with the same set)
  const sticky = stickyNowRef.current
  const shown = sticky.size ? new Set([...mountedIds, ...[...sticky].filter((id) => ids.includes(id))]) : mountedIds
  return { mountedIds: shown, release }
}
