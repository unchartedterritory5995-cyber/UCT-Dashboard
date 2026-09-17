// Joystick hub — W3 / R9: the smoothness instrument. Frame gaps, input→paint latency and long
// tasks, sampled for the length of ONE gesture and summarised into a row the existing G0 trace
// carries out.
//
// ⛔⛔ NO SINK, NO NETWORK, EVER — the same charter `gestureTrace.js` holds. This module measures
// and summarises; the only way a number leaves the device is the member pressing "Copy trace".
//
// ⛔ AND NO VERDICTS. It reports p50 / p95 / max and a dropped-frame count. It does NOT compare
// them against the design bar's M1–M4 thresholds, and it never concludes "janky". The bar lives in
// `docs/plans/joystick/design-bar.md`; a second copy of a threshold here would agree with it right
// up until the moment the two disagreed, which is the only moment anyone would read either
// (`lesson_a_second_authority_over_one_value`).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ⛔⛔ THE THREE WAYS THIS INSTRUMENT COULD LIE, AND WHAT EACH ONE COSTS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. **A HIDDEN TAB THROTTLES rAF.** Chrome defers paint and throttles timers in a background tab
//    (`lesson_hidden_chrome_tab_defers_paint_and_throttles_timers`), so a capture taken while the
//    tab is not visible reports frame gaps of hundreds of milliseconds that belong to the BROWSER,
//    not to the hub. Those numbers look exactly like the defect this instrument exists to find.
//    ⇒ visibility is sampled at every frame, and any capture that was ever hidden is `valid:false`
//      with `voidReason: 'hidden'`. **VOID, never slow.**
//
// 2. **`longtask` IS NOT UNIVERSALLY SUPPORTED — and iOS Safari is the target.** `PerformanceObserver`
//    with `entryTypes: ['longtask']` throws or silently observes nothing on Safari. An unsupported
//    observer that reports `count: 0` is indistinguishable from a device with no long tasks, and
//    zero is the flattering direction. ⇒ `longTasks.supported` is reported beside the count, and
//    when it is false the counts are `null` rather than `0`. **An absence is only evidence if the
//    instrument could have seen a presence.**
//
// 3. **A SATURATED RING READS AS A QUIET ONE.** Same trap `gestureTrace.js` already names. ⇒ every
//    summary carries `frames`, `capacity` and `dropped` (samples the cap discarded), so a capture
//    that outran its buffer says so instead of reporting a tidy window that is really a tail.
//
// ⭐ Everything the module touches is INJECTED (`env`), so the whole thing is unit-testable with
// synthetic time and no browser at all — and so a test can drive it to the OTHER answer. A metric
// nobody has seen go red is not a metric (`lesson_gate_that_cannot_fail`).

/** Frames kept per capture. A gesture is well under a second; 240 is ~4s at 60fps of headroom. */
export const SMOOTHNESS_CAP = 240

/** 60fps is 16.67ms. A frame is "dropped" when the gap is long enough to have missed one whole
 *  vsync with margin — measured, not a CSS duration. Exported so a reader can see the definition
 *  rather than infer it from a number in a summary. */
export const FRAME_BUDGET_MS = 1000 / 60
export const DROPPED_FRAME_GAP_MS = FRAME_BUDGET_MS * 1.5

/**
 * The browser surface this module uses, in one place so a test can replace all of it.
 *
 * ⛔ RESOLVED LAZILY, INSIDE THE FUNCTION — never as a default parameter value. A default argument
 * is evaluated once at module import and captures the original object forever, so a later stub of
 * `performance`/`requestAnimationFrame` would never be seen. That is the exact defect CLAUDE.md
 * records against `gate_shards.py` (`tree_state_fn=tree_state`), where a unit test ran a real
 * six-shard gate because the patch reached nothing.
 */
function defaultEnv() {
  return {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    raf: (cb) => globalThis.requestAnimationFrame(cb),
    caf: (id) => globalThis.cancelAnimationFrame(id),
    visibility: () => (typeof document !== 'undefined' ? document.visibilityState : 'visible'),
    observeLongTasks,
  }
}

/**
 * Subscribe to long tasks. Returns `{ supported, stop() }`.
 *
 * ⚠️ Three distinct failure shapes, all of which must read as UNSUPPORTED rather than as zero:
 * no `PerformanceObserver` at all; a constructor that throws on an unknown entry type; and an
 * observer that constructs fine but whose `supportedEntryTypes` never includes `longtask`
 * (Safari). The last one is the dangerous one — it looks like it worked.
 */
function observeLongTasks(onEntry) {
  const PO = globalThis.PerformanceObserver
  if (typeof PO !== 'function') return { supported: false, stop() {} }
  const types = PO.supportedEntryTypes
  if (Array.isArray(types) && !types.includes('longtask')) return { supported: false, stop() {} }
  try {
    const obs = new PO((list) => { for (const e of list.getEntries()) onEntry(e) })
    obs.observe({ entryTypes: ['longtask'] })
    return { supported: true, stop: () => { try { obs.disconnect() } catch { /* already gone */ } } }
  } catch {
    // A throwing constructor IS the unsupported case on several engines.
    return { supported: false, stop() {} }
  }
}

/** Nearest-rank percentile over a SORTED copy. `p` is 0..1. */
function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]
}

/** Round to 2dp so a summary is readable without pretending to sub-microsecond precision. */
const r2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100)

/**
 * Create a capture. One capture spans one gesture: `start()` on pointerdown, `stop()` on
 * pointerup, and the returned summary is what goes into the trace ring.
 *
 * @param {Partial<ReturnType<typeof defaultEnv>>} [env] injected browser surface (tests supply all)
 */
export function createFrameCapture(env) {
  const E = { ...defaultEnv(), ...(env || {}) }

  let running = false
  let rafId = null
  let startedAt = 0
  let lastFrameAt = 0
  let frames = 0          // total frames SEEN (may exceed the cap)
  const gaps = []         // kept gaps, capped
  let everHidden = false
  let pendingInputAt = null
  const latencies = []    // input → next painted frame
  let longTaskHandle = { supported: false, stop() {} }
  const longTasks = []

  function onFrame(ts) {
    if (!running) return
    // ⛔ Prefer the timestamp rAF hands us; fall back to `now()` only when a caller (or a test's
    // fake rAF) supplies none. Mixing the two silently would compare two different clocks.
    const t = typeof ts === 'number' ? ts : E.now()

    if (E.visibility() !== 'visible') everHidden = true

    if (frames > 0) {
      const gap = t - lastFrameAt
      if (gaps.length < SMOOTHNESS_CAP) gaps.push(gap)
    }
    if (pendingInputAt !== null) {
      latencies.push(t - pendingInputAt)
      pendingInputAt = null
    }
    lastFrameAt = t
    frames += 1
    rafId = E.raf(onFrame)
  }

  return {
    /** Begin sampling. Idempotent: a second start while running is ignored, not stacked. */
    start() {
      if (running) return
      running = true
      startedAt = E.now()
      lastFrameAt = startedAt
      frames = 0
      gaps.length = 0
      latencies.length = 0
      longTasks.length = 0
      everHidden = E.visibility() !== 'visible'
      pendingInputAt = null
      longTaskHandle = E.observeLongTasks((e) => longTasks.push(e.duration))
      rafId = E.raf(onFrame)
    },

    /**
     * Mark a pointer event. The NEXT frame records the input→paint latency (design bar M2).
     *
     * ⚠️ Only one mark is outstanding at a time, deliberately: several pointer events can arrive
     * between two frames, and pairing all of them with the same frame would report the same paint
     * several times and drag p95 toward zero. The FIRST unpaired input wins, which is the one that
     * actually waited.
     */
    markInput(at) {
      if (!running) return
      if (pendingInputAt === null) pendingInputAt = typeof at === 'number' ? at : E.now()
    },

    /** Stop sampling and summarise. Safe to call twice; the second call re-summarises. */
    stop() {
      if (running) {
        running = false
        if (rafId !== null) { try { E.caf(rafId) } catch { /* fake raf in tests */ } rafId = null }
        longTaskHandle.stop()
      }
      const windowMs = Math.max(0, lastFrameAt - startedAt)
      const sortedGaps = [...gaps].sort((a, b) => a - b)
      const sortedLat = [...latencies].sort((a, b) => a - b)

      // ⛔ VOID BEATS SLOW. A hidden tab and a genuinely stuttering hub produce the same numbers,
      // so the summary must refuse rather than rank them. Two frames is the floor at which a gap
      // exists at all.
      const voidReason = everHidden ? 'hidden' : (frames < 2 ? 'too-few-frames' : null)

      return {
        valid: voidReason === null,
        voidReason,
        frames,
        capacity: SMOOTHNESS_CAP,
        dropped: Math.max(0, (frames - 1) - gaps.length), // gaps the cap refused
        windowMs: r2(windowMs),
        fps: windowMs > 0 && frames > 1 ? r2(((frames - 1) * 1000) / windowMs) : null,
        gapMs: {
          p50: r2(percentile(sortedGaps, 0.5)),
          p95: r2(percentile(sortedGaps, 0.95)),
          max: r2(sortedGaps.length ? sortedGaps[sortedGaps.length - 1] : null),
        },
        droppedFrames: sortedGaps.filter((g) => g > DROPPED_FRAME_GAP_MS).length,
        inputLatencyMs: {
          samples: sortedLat.length,
          p50: r2(percentile(sortedLat, 0.5)),
          p95: r2(percentile(sortedLat, 0.95)),
          max: r2(sortedLat.length ? sortedLat[sortedLat.length - 1] : null),
        },
        // ⛔ `null`, not `0`, when the engine cannot observe them. See hazard 2 in the header.
        longTasks: longTaskHandle.supported
          ? {
            supported: true,
            count: longTasks.length,
            totalMs: r2(longTasks.reduce((a, b) => a + b, 0)),
            maxMs: r2(longTasks.length ? Math.max(...longTasks) : 0),
          }
          : { supported: false, count: null, totalMs: null, maxMs: null },
      }
    },
  }
}
