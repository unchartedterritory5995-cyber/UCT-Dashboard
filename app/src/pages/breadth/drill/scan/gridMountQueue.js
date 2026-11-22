// The grid's chart-creation queue. Creating a chart engine is the heaviest thing
// a card does, so cards take turns: ONE chart per frame, the one nearest the
// middle of the screen first. While the member is actively scrolling, NO chart
// is created, so the scroll itself stays smooth; the moment it pauses, the
// queue drains at full speed. A card that leaves the window before its turn
// simply drops out (nothing was built for it).

const waiting = new Set()
let scheduled = false
let lastScrollAt = -1e9

const SCROLL_SETTLE_MS = 120
const WHILE_SCROLLING_GAP_MS = 60

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const frame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16))

function schedule(delay = 0) {
  if (scheduled) return
  scheduled = true
  const run = () => { scheduled = false; tick() }
  if (delay > 0) setTimeout(() => frame(run), delay)
  else frame(run)
}

function tick() {
  if (!waiting.size) return
  if (now() - lastScrollAt < SCROLL_SETTLE_MS) {
    // Mid-scroll: build nothing. A chart created mid-scroll halved the frame
    // rate in measurement (60 → 30 fps); the cards fill in the moment it pauses.
    schedule(WHILE_SCROLLING_GAP_MS)
    return
  }
  grantNext()
  if (waiting.size) schedule()
}

function grantNext() {
  let best = null
  let bestP = Infinity
  for (const e of waiting) {
    let p
    try { p = e.priority() } catch { p = 1e9 }
    if (p < bestP) { bestP = p; best = e }
  }
  if (!best) return
  waiting.delete(best)
  best.grant()
}

/** Queue a card for its chart. `entry` = { priority(): number (lower first), grant() }. */
export function claimMount(entry) {
  waiting.add(entry)
  schedule()
}

/** The card left the window (or unmounted) before its turn. */
export function releaseMount(entry) {
  waiting.delete(entry)
}

/** The sheet scrolled: slow chart creation down until it settles. */
export function noteScroll() {
  lastScrollAt = now()
}

/** Test-only. */
export function _queueSize() {
  return waiting.size
}

/** Test-only: forget everything (waiting cards, pending tick, scroll time). */
export function _resetQueue() {
  waiting.clear()
  scheduled = false
  lastScrollAt = -1e9
}
