// A chunk held in a module-level slot, for an optional tool a member types into the moment it opens (go-live wave 1,
// fix round 2): the note's find bar, the notes list's Ask panel.
//
// ⛔ WHY NOT React.lazy HERE. A `lazy()` component suspends on its FIRST render even when its module is already in
// hand: the factory's `import()` is a fresh promise, so the first read finds it pending and throws it. The
// <Suspense> commits its fallback, and React 19 then holds the reveal back until FALLBACK_THROTTLE_MS (300 ms in
// react-dom 19.2) has passed since that fallback commit. Measured in Chromium (a warmed chunk, Ctrl+F then type):
// 305 ms from the press to the field holding focus through `lazy` + <Suspense>, 3 ms rendering the component
// directly, and with `lazy` both typed letters landed in the note behind the bar.
//
// So the chunk is fetched ahead (on idle, and at the press) into this slot, and a component that reads the slot
// renders the real thing directly once it is there, in the same commit as the press. Until then the caller draws
// its own stand-in.
//
// A failed fetch is retried once in place (`importWithOneRetry`) and then recorded as `failed`: never a page reload
// (lazyChunk's second-failure path), never a throw into the editor's error boundary. The next `warm()` asks again
// (under a fresh specifier, lib/lazyChunk.js), so a "Try again" or the next editor mount can still recover it.
import { useSyncExternalStore } from 'react'
import { RETRY_WAIT_MS, importWithOneRetry } from './lazyChunk'

const IDLE = Object.freeze({ status: 'idle', Component: null })
const LOADING = Object.freeze({ status: 'loading', Component: null })
const FAILED = Object.freeze({ status: 'failed', Component: null })

/** `load` is a plain `() => import('./X')` of a module whose default export is the component. */
export function heldModule(load, waitMs = RETRY_WAIT_MS) {
  let snapshot = IDLE
  let inflight = null
  const listeners = new Set()
  const publish = (next) => {
    snapshot = next
    listeners.forEach((fn) => fn())
  }
  const warm = () => {
    if (snapshot.Component) return Promise.resolve(snapshot.Component)
    if (inflight) return inflight
    publish(LOADING)
    inflight = importWithOneRetry(load, waitMs).then(
      (mod) => {
        inflight = null
        const Component = mod?.default
        if (!Component) { publish(FAILED); return null }
        publish(Object.freeze({ status: 'ready', Component }))
        return Component
      },
      () => { inflight = null; publish(FAILED); return null },
    )
    return inflight
  }
  return {
    warm,
    get: () => snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    /** Tests only: forget the module, as on a fresh page. */
    resetForTests: () => { inflight = null; snapshot = IDLE },
  }
}

/** `{ status: 'idle' | 'loading' | 'ready' | 'failed', Component }`, re-rendering when the slot changes. */
export function useHeldModule(held) {
  return useSyncExternalStore(held.subscribe, held.get, held.get)
}
