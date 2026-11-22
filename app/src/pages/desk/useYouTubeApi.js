// Loads the YouTube IFrame Player API once and reports when it's ready.
// The API enables us to detect when a video ends (→ "Next up" card) and switch
// videos in-place — so users navigate our library instead of YouTube's
// off-site end-screen suggestions.
import { useEffect, useState } from 'react'

let loadPromise = null

function loadApi() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.YT && window.YT.Player) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      try { prev && prev() } catch { /* ignore */ }
      resolve()
    }
    if (!document.getElementById('yt-iframe-api')) {
      const s = document.createElement('script')
      s.id = 'yt-iframe-api'
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  })
  return loadPromise
}

/** `start` (default true): load now. false waits until a caller passes true (the app-wide video layer
 *  passes "a video is open, or the page has drawn its first chart and gone idle"). */
export function useYouTubeApi({ start = true } = {}) {
  const [ready, setReady] = useState(
    () => typeof window !== 'undefined' && !!(window.YT && window.YT.Player),
  )
  useEffect(() => {
    if (!start) return undefined
    let alive = true
    loadApi().then(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [start])
  return ready
}

// The page's first chart sets this mark and fires this event (lib/barsPackClient.markFirstChartPaint).
// A literal, not an import, so the app-wide video layer does not pull the pack client into the shell.
export const FIRST_CHART_PAINT = 'uct:first-chart-paint'
export const WARM_MAX_WAIT_MS = 15000

/** True once the page has drawn its first chart (or after WARM_MAX_WAIT_MS on a page without one) AND the
 *  main thread is idle. Speed rule 4 (CLAUDE.md): background work never competes with the first paint;
 *  the YouTube player API (two third-party scripts) used to load at boot on every page for every member. */
export function useAfterFirstPaintIdle(maxWaitMs = WARM_MAX_WAIT_MS) {
  const [due, setDue] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    let done = false
    let idleId = null
    const ric = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 1))
    const cic = window.cancelIdleCallback || window.clearTimeout
    const go = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      window.removeEventListener(FIRST_CHART_PAINT, go)
      idleId = ric(() => setDue(true), { timeout: 5000 })
    }
    const timer = window.setTimeout(go, maxWaitMs)
    window.addEventListener(FIRST_CHART_PAINT, go)
    try { if (performance.getEntriesByName(FIRST_CHART_PAINT, 'mark').length) go() } catch { /* no performance API */ }
    return () => {
      done = true
      window.clearTimeout(timer)
      window.removeEventListener(FIRST_CHART_PAINT, go)
      if (idleId != null) cic(idleId)
    }
  }, [maxWaitMs])
  return due
}
