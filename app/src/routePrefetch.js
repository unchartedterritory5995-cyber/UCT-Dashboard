// ─── Route chunk prefetch ────────────────────────────────────────────────────
// App.jsx wraps its whole <Routes> in ONE <Suspense>. So when a member clicks a
// section whose chunk is not already in memory, React unmounts the entire shell
// — sidebar and all — and paints the "Loading page" splash until the chunk
// lands. That splash IS the difference members feel between sections: a section
// visited earlier this session switches instantly because its module is already
// resolved, while a fresh one stalls.
//
// Measured on prod 2026-09-07 (warm cache, SPA navigation from /dashboard):
//   /uct-20        splash held  878 ms
//   /options-flow  splash held 1,235 ms, then a second "Loading flow data..."
//                  spinner, then content at 3,516 ms
//
// Warming the chunk on pointer/focus/touch intent closes the first gap: a human
// takes a few hundred ms between hovering a link and clicking it, and these
// chunks measure 85-180 ms, so by the time the click lands lazy() resolves
// without suspending and the shell never blanks.
//
// ⛔ Best-effort, never a gate. An unregistered href warms nothing, a route left
// on plain lazy() keeps today's behaviour, and every failure is swallowed —
// lazyWithRetry still owns the real load, and its stale-chunk reload must fire
// on the RENDER path, not on this warm.

// Longest registered prefix wins, so /calendar/mystocks warms MyStocksHub
// rather than Calendar. Returns the KEY, not the importer, so callers can dedupe
// on it.
export function importerKeyFor(importers, pathname) {
  let best = null
  for (const key of importers.keys()) {
    if (pathname === key || pathname.startsWith(key + '/')) {
      if (!best || key.length > best.length) best = key
    }
  }
  return best
}

// Pull the in-app path out of an anchor, or null if this link is not something
// we should (or can) warm.
export function routeHrefFrom(anchor) {
  if (!anchor) return null
  // Opens somewhere else — warming this tab's module graph buys nothing.
  const target = anchor.getAttribute && anchor.getAttribute('target')
  if (target && target !== '_self') return null
  const href = anchor.getAttribute && anchor.getAttribute('href')
  // In-app absolute paths only. "//host" is protocol-relative, i.e. external.
  if (!href || href[0] !== '/' || href[1] === '/') return null
  return href.replace(/[?#].*$/, '')
}

export function createRoutePrefetcher(importers, {
  getConnection,
  // A pointer crossing a link on its way somewhere else is not intent. The
  // sidebar is a vertical rail, so a sweep from top to bottom enters every
  // item in it — warming on the bare pointerover would pull several MB of
  // chunks the member never asked for, competing with the page they ARE on.
  // A short dwell separates 'passed over' from 'aiming at'; pointing at a
  // target and clicking it takes a human 200 ms+, so this costs no head start.
  dwellMs = 60,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const warmed = new Set()
  let pending = null

  function prefetch(pathname) {
    try {
      const key = importerKeyFor(importers, pathname)
      if (!key || warmed.has(key)) return false
      warmed.add(key)
      const p = importers.get(key)()
      // A failed warm must not poison the entry: forget it so a later hover (or
      // the render path's own lazyWithRetry) is free to try the import again.
      if (p && p.catch) p.catch(() => { warmed.delete(key) })
      return true
    } catch {
      return false // never let a prefetch break boot or navigation
    }
  }

  // The path this event is aimed at, or null if it is not a warmable in-app link
  // or the member's connection says don't.
  function targetPath(event) {
    // Don't spend a member's metered or slow connection on a page they may not
    // open. `navigator.connection` is Chromium-only, so absence means proceed.
    const conn = getConnection ? getConnection() : null
    if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''))) return null
    const t = event && event.target
    const anchor = t && typeof t.closest === 'function' ? t.closest('a[href]') : null
    return routeHrefFrom(anchor)
  }

  // Keyboard focus and touch are already deliberate — warm immediately.
  function handleIntent(event) {
    const path = targetPath(event)
    if (path) prefetch(path)
  }

  // Hover is only intent once it holds still. Cancelled by handleIntentEnd when
  // the pointer moves on, so a sweep warms nothing.
  function handleHover(event) {
    const path = targetPath(event)
    if (!path) return
    handleIntentEnd()
    pending = { path, id: setTimer(() => { pending = null; prefetch(path) }, dwellMs) }
  }

  function handleIntentEnd() {
    if (!pending) return
    clearTimer(pending.id)
    pending = null
  }

  return { prefetch, handleIntent, handleHover, handleIntentEnd, warmed }
}

// pointerover (not pointerenter) so ONE delegated listener sees every link;
// capture so a link that stops propagation still warms; passive so this can
// never delay scrolling or the click itself.
export function attachRoutePrefetch(doc, prefetcher) {
  if (!doc || !doc.addEventListener) return () => {}
  const opts = { capture: true, passive: true }
  const wiring = [
    ['pointerover', prefetcher.handleHover],
    ['pointerout', prefetcher.handleIntentEnd],
    ['focusin', prefetcher.handleIntent],
    ['touchstart', prefetcher.handleIntent],
  ]
  for (const [e, fn] of wiring) doc.addEventListener(e, fn, opts)
  return () => { for (const [e, fn] of wiring) doc.removeEventListener(e, fn, opts) }
}
