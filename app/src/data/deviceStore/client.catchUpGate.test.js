// @vitest-environment node
// ⭐ THE FEED'S CATCH-UP WAITS FOR A QUIET PAGE (2026-11-23, the live-session read of the device store, item 1b). The leader's
// minute feed starts on this page's first visibility report ('live'), and a feed that starts, or comes back after the app
// was hidden (liveFeed.visible -> consumer.syncNow), catches up at once: mid-session that is today.bin, the whole day so
// far, downloaded and replayed. ONE gate already holds the seed ingest: the first chart paint, then an idle period
// (client.js start(): afterPaint -> idle). The page-load report rides the same callback (G1 pins it). A member coming back
// to the app reported visible inside the visibility event itself, which is exactly when a member starts switching again:
// now that report waits for the same idle (G2), a hidden report still goes at once (the feed stops polling), and a page
// hidden again before its idle reports nothing visible (G3). No new gate: the client's own `idle`.
import { describe, it, expect, vi } from 'vitest'
import { createDeviceClient } from './client'

function fakeWorker() {
  const w = { posted: [], onmessage: null, onerror: null, terminate: vi.fn() }
  w.postMessage = (m) => { w.posted.push(m) }
  return w
}
const lives = (w) => w.posted.filter((m) => m.op === 'live').map((m) => m.visible)
const ingests = (w) => w.posted.filter((m) => m.op === 'ingest').length

function client({ vis }) {
  const w = fakeWorker()
  const painted = []
  const idles = []
  let onChange = null
  const c = createDeviceClient({
    makeWorker: () => w, manifestUrl: () => 'https://x.test/m.json',
    afterPaint: (fn) => { painted.push(fn) }, idle: (fn) => { idles.push(fn) },
    visible: () => vis.v, onVisibilityChange: (cb) => { onChange = cb }, setIntervalFn: () => 1, clearIntervalFn: () => {},
    storage: null, noteFiles: () => {}, killed: () => false,
  })
  const runIdle = () => { const q = idles.splice(0); q.forEach((fn) => fn()) }
  return { w, c, painted, idles, runIdle, change: () => onChange?.() }
}

describe("the feed's catch-up waits for a quiet page", () => {
  it('G1 the page-load start: the feed is asked only after the first chart paint AND an idle period, with the seed ingest', () => {
    const vis = { v: true }
    const t = client({ vis })
    t.c.start()
    expect(lives(t.w)).toEqual([])
    t.painted.forEach((fn) => fn())                        // the first chart paint
    expect(lives(t.w)).toEqual([])                         // ...not yet: the page has not been idle
    expect(ingests(t.w)).toBe(0)
    t.runIdle()
    expect(ingests(t.w)).toBe(1)
    expect(lives(t.w)).toEqual([true])
    // the ingest is asked first, the feed after it (the leader starts the feed once the ingest in flight settles)
    expect(t.w.posted.findIndex((m) => m.op === 'ingest')).toBeLessThan(t.w.posted.findIndex((m) => m.op === 'live'))
  })

  it('G2 back from hidden: the visible report waits for the next idle; a hidden report goes at once', () => {
    const vis = { v: true }
    const t = client({ vis })
    t.c.start()
    t.painted.forEach((fn) => fn())
    t.runIdle()
    expect(lives(t.w)).toEqual([true])
    vis.v = false; t.change()
    expect(lives(t.w)).toEqual([true, false])              // hidden: at once, so the feed stops polling
    vis.v = true; t.change()
    expect(lives(t.w)).toEqual([true, false])              // visible again: NOT inside the visibility event
    t.runIdle()
    expect(lives(t.w)).toEqual([true, false, true])        // ...at the next idle
  })

  it('G3 hidden again before that idle: nothing visible is reported', () => {
    const vis = { v: true }
    const t = client({ vis })
    t.c.start()
    t.painted.forEach((fn) => fn())
    t.runIdle()
    vis.v = false; t.change()
    vis.v = true; t.change()
    vis.v = false; t.change()
    t.runIdle()
    expect(lives(t.w)).toEqual([true, false, false])
  })
})
