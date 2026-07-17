// app/src/pages/charts/grid/gridSpike.js
//
// Perf-spike instrumentation for the Multi-Chart grid. Inert unless the
// admin-only ?gridspike=N flag activates it (MultiChartGrid wires it up).
// Measures, machine-readably (for a Playwright/Chrome-MCP driver):
//   - per-cell mount → first-framed-paint (MutationObserver watching each
//     cell's container for its first <canvas> insertion — the chart is created
//     LAZILY after bars arrive, so canvas-appearance IS first paint; an
//     onTimeRangeChange latch never fires pre-chart)
//   - all-framed wall time from grid enter (includes the mount-queue stagger,
//     deliberately — that's the member-perceived open time)
//   - heap (performance.memory, Chrome-only; null elsewhere) at base / settled
//     (+10s) / idle (+60s)
//   - crosshair-sweep frame timing on cell #1: LWC attaches its mousemove
//     listener lazily inside mouseenter, ON THE TOP CANVAS — so the sweep
//     primes with a synthetic mouseenter and dispatches mousemove on the LAST
//     canvas in the cell. A moveEvents counter (fed by the cell's
//     onCrosshairMove via the counting bus) guards validity: zero delivered
//     events ⇒ sweep reported invalid, never a silent pass.
//   - idle long tasks over 60s (PerformanceObserver longtask)
// Emits one console.table + one '[gridspike:done] {json}' line, and mirrors
// everything on window.__gridSpike.

const SWEEP_MS = 5000
const SETTLE_MS = 10000
const IDLE_MS = 60000

export const SPIKE_SYMS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD',
  'AVGO', 'NFLX', 'QQQ', 'SPY', 'IWM', 'DIA', 'SMH', 'XLF',
]

function heapNow() {
  try { return performance.memory?.usedJSHeapSize ?? null } catch { return null }
}

function pct(sorted, p) {
  if (!sorted.length) return null
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return Math.round(sorted[i] * 100) / 100
}

export function createSpike({ n, tf }) {
  const spike = {
    config: { n, tf, startedAt: new Date().toISOString(), session: null },
    gridEnterAt: performance.now(),
    cells: {},          // id -> {sym, mountAt, framedAt, ms}
    heap: { base: heapNow(), settled: null, idle: null },
    sweep: null,
    idleLongTasks: null,
    done: false,
  }
  window.__gridSpike = spike

  let framedCount = 0
  let finishedPhase = false
  let moveEvents = 0

  // Counting bus handed to cells in spike mode: emit() counts crosshair events
  // (validity guard), subscribe is a no-op so NO cross-cell fan-out happens —
  // the sweep measures the sync-OFF configuration.
  spike.bus = {
    emit: () => { moveEvents += 1 },
    subscribe: () => () => {},
  }

  const observers = new Map()

  spike.reportCellMount = (id, sym) => {
    if (spike.cells[id]) return   // idempotent
    const rec = { sym, mountAt: performance.now(), framedAt: null, ms: null }
    spike.cells[id] = rec
    const host = document.querySelector(`[data-grid-cell-id="${id}"]`)
    if (!host) return
    const finishCell = () => {
      if (rec.framedAt != null) return
      requestAnimationFrame(() => {
        rec.framedAt = performance.now()
        rec.ms = Math.round(rec.framedAt - rec.mountAt)
        framedCount += 1
        observers.get(id)?.disconnect()
        observers.delete(id)
        if (framedCount >= n && !finishedPhase) { finishedPhase = true; afterAllFramed() }
      })
    }
    if (host.querySelector('canvas')) { finishCell(); return }
    const mo = new MutationObserver(() => {
      if (host.querySelector('canvas')) finishCell()
    })
    mo.observe(host, { childList: true, subtree: true })
    observers.set(id, mo)
  }

  function afterAllFramed() {
    spike.allFramedMs = Math.round(performance.now() - spike.gridEnterAt)
    setTimeout(() => {
      spike.heap.settled = heapNow()
      runSweep()
    }, SETTLE_MS)
  }

  function runSweep() {
    if (document.visibilityState !== 'visible') {
      // Background tabs freeze rAF (lesson_browser_verify_raf_background_freeze)
      // — frame numbers would be garbage. Invalid, never a pass.
      console.error('[gridspike] sweep aborted: tab not visible')
      spike.sweep = { invalid: true, reason: 'tab not visible' }
      idlePhase()
      return
    }
    const firstId = Object.keys(spike.cells)[0]
    const host = document.querySelector(`[data-grid-cell-id="${firstId}"]`)
    const canvases = host ? host.querySelectorAll('canvas') : []
    const cv = canvases[canvases.length - 1]
    if (!cv) {
      spike.sweep = { invalid: true, reason: 'no canvas in cell #1' }
      idlePhase()
      return
    }
    const rect = cv.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    // LWC only attaches mousemove inside its mouseenter handler.
    cv.dispatchEvent(new MouseEvent('mouseenter', { clientX: rect.left + 4, clientY: midY, bubbles: true }))

    moveEvents = 0
    const frames = []
    let last = performance.now()
    let rafOn = true
    const rafLoop = (t) => {
      frames.push(t - last)
      last = t
      if (rafOn) requestAnimationFrame(rafLoop)
    }
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(rafLoop) })

    let longTasks = 0
    let worstLongTask = 0
    let lto = null
    try {
      lto = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          longTasks += 1
          worstLongTask = Math.max(worstLongTask, Math.round(e.duration))
        }
      })
      lto.observe({ type: 'longtask', buffered: false })
    } catch { /* longtask unsupported — counts stay 0 */ }

    const t0 = performance.now()
    const tick = setInterval(() => {
      const el = performance.now() - t0
      if (el >= SWEEP_MS) {
        clearInterval(tick)
        rafOn = false
        try { lto?.disconnect() } catch { /* noop */ }
        const sorted = [...frames].sort((a, b) => a - b)
        spike.sweep = moveEvents === 0
          ? { invalid: true, reason: 'no crosshair events delivered' }
          : {
              moveEvents,
              medianFrameMs: pct(sorted, 50),
              p95FrameMs: pct(sorted, 95),
              effFps: sorted.length ? Math.round(1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length)) : null,
              longTasks,
              worstLongTaskMs: worstLongTask,
            }
        idlePhase()
        return
      }
      const x = rect.left + 4 + ((rect.width - 8) * ((el % 2000) / 2000))
      cv.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: midY, bubbles: true }))
    }, 8)
  }

  function idlePhase() {
    let longTasks = 0
    let worst = 0
    let lto = null
    try {
      lto = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          longTasks += 1
          worst = Math.max(worst, Math.round(e.duration))
        }
      })
      lto.observe({ type: 'longtask', buffered: false })
    } catch { /* unsupported */ }
    setTimeout(() => {
      try { lto?.disconnect() } catch { /* noop */ }
      spike.idleLongTasks = { count: longTasks, worstMs: worst, windowMs: IDLE_MS }
      spike.heap.idle = heapNow()
      finish()
    }, IDLE_MS)
  }

  function finish() {
    spike.done = true
    const rows = Object.entries(spike.cells).map(([id, c]) => ({
      id, sym: c.sym, mountToFramedMs: c.ms,
    }))
    const cellMs = rows.map(r => r.mountToFramedMs).filter(v => v != null).sort((a, b) => a - b)
    const summary = {
      config: spike.config,
      allFramedMs: spike.allFramedMs ?? null,
      framed: cellMs.length,
      cellMedianMs: pct(cellMs, 50),
      cellP95Ms: pct(cellMs, 95),
      heap: spike.heap,
      heapSettledDeltaMB: (spike.heap.base != null && spike.heap.settled != null)
        ? Math.round((spike.heap.settled - spike.heap.base) / 1048576) : null,
      heapIdleGrowthMB: (spike.heap.settled != null && spike.heap.idle != null)
        ? Math.round((spike.heap.idle - spike.heap.settled) / 1048576) : null,
      sweep: spike.sweep,
      idleLongTasks: spike.idleLongTasks,
    }
    try { console.table(rows) } catch { /* noop */ }
    console.log('[gridspike:done] ' + JSON.stringify(summary))
  }

  return spike
}
