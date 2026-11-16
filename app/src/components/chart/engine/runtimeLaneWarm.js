// app/src/components/chart/engine/runtimeLaneWarm.js
//
// ─── ⚡ PRELOAD (perf/pine-runtime-chunk-preload) — WARM THE PER-BAR LANE AFTER THE FIRST PAINT ───
//
// Measured on production (RS Rating, RDDT 1D, 2026-11-16): "Add this script to my chart" to labels
// drawn took 7.98 s in a cold tab, 1.85 s warm. The cold cost is the per-bar lane: its loader chunk
// (`runtime/runtimeAsync.js`) and then its worker chunk (~1.3 MB, ~380 KB gzip), fetched, parsed and
// evaluated only when the first run is asked for.
//
// A chart whose member HAS a definition on that lane (a saved runtime document, a run half, a
// run-read paint: `nativeRegistry.definitionUsesRuntimeLane`) warms it after its first paint, in idle
// time: the loader chunk is imported and the worker spawned (`runtimeAsync.warmRuntimeLane`), so the
// cost is paid while the member reads the chart, not when the script is added or drawn.
//
// ⛔ THE RULES THIS KEEPS (CLAUDE.md speed rules 4 and 5, and the runtime pane's gate):
//   · never before the first chart paint (`afterFirstChartPaint`), and then only in idle time;
//   · never for a member whose runtime pane is not permitted (`permitted()` is asked at the moment,
//     not at arming): such a member fetches NOTHING;
//   · never for a member with no definition on that lane: a chart that never uses it fetches nothing;
//   · no first-open bytes: the import is the caller's own dynamic `import()` (`load`), so the lane
//     stays in its own chunks, exactly where `registerRuntimeLaneLoader` already puts it.
// The decision is a pure function of its injected parts, so the rail can drive every branch.

let _warmed = false
let _armed = false

/** Ask, once the first chart paint has happened and the browser is idle, whether to warm the lane,
 *  and warm it at most once per page. Re-arming is cheap and idempotent: call it whenever the set of
 *  installed definitions may have changed (a later install can make the answer yes).
 *  @param {{afterPaint: (fn: Function) => void, idle: (fn: Function) => void, permitted: () => boolean,
 *           usesLane: () => boolean, load: () => Promise<unknown>}} deps
 *  @returns {boolean} whether a check was scheduled now */
export function armRuntimeLaneWarm(deps) {
  if (_warmed || _armed || !deps) return false
  _armed = true
  deps.afterPaint(() => deps.idle(() => {
    _armed = false
    if (_warmed) return
    // ⛔ asked AT THE MOMENT: a pane switched off since arming fetches nothing
    if (!safe(deps.permitted)) return
    if (!safe(deps.usesLane)) return
    _warmed = true
    try {
      Promise.resolve(deps.load()).catch(() => { _warmed = false })
    } catch {
      _warmed = false
    }
  }))
  return true
}

function safe(fn) {
  try { return !!fn() } catch { return false }
}

/** Run `fn` when the browser is idle (or after `timeoutMs` at the latest). */
export function whenIdle(fn, { timeoutMs = 2000 } = {}) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => fn(), { timeout: timeoutMs })
    return
  }
  setTimeout(fn, 0)
}

/** Test seam. */
export function __resetRuntimeLaneWarm() { _warmed = false; _armed = false }
