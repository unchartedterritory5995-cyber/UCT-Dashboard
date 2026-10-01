// app/src/components/chart/engine/blockRuns.js
//
// ─── ⭐⭐ C48 — A PLOT THAT READS A CALL IN A BLOCK THAT MAY NOT RUN ON EVERY BAR ──
//
// Pine keeps one history per CALL SITE: a `ta.*` written inside an `if`, a local
// declared there, a helper called from it — each advances only on the bars the
// block runs. Capture `vw-call-site-history-{rddt,spy}-1d-2026-10-01`:
//
//   if close > open
//       c_sma := ta.sma(close, 3)      → the mean of the last 3 EXECUTIONS
//       cx = close * 2
//       c_x1 := cx[1]                  → `cx` at the previous EXECUTION
//
// The columnar lane computes every tree over every bar, so it reads those as the
// 3-BAR mean and the previous BAR's value — a different number on 163–307 of
// RDDT's 634 bars per row (`vendorHarness.c48CallSite`).
//
// ⭐ THE EVERY-BAR READ IS EXACT EXACTLY WHEN THE BLOCK'S EXECUTIONS ARE THE BARS.
// That is a fact about the DATA, not the script. `uncharted-volume-v2` writes
// `if not skipAll and isDaily` / `ta.highest(volD[1], …)`: on a daily chart the
// block runs on every bar, on a weekly chart on none — and the every-bar read is
// TradingView's on both (its columns match the vendor's captures). Refusing the
// call at translation would take a correct plot off every chart it is correct
// on; serving it everywhere draws the wrong number wherever the guard skips.
//
// So the translation stamps each such plot with its block's own guard, as a tree
// (`meta.blockRuns`, from `pine.js` — `Resolver.resolveBinding`, `execGuard`),
// and the bind evaluates the guard over the chart's bars:
//
//   the block RUNS on a bar after a bar it SKIPPED  →  the plot is refused, by
//   name, on this chart: its calls have a history the columnar lane does not keep.
//
// ⛔ Only a KNOWN skip counts. A bar where the guard is not computable (a
// warm-up prefix, a bar before a bounded window) is neither a run nor a skip —
// the plot is not computable there either, so nothing is drawn off it.
// ⛔ A guard that is always true, always false, or true then false for good is
// exact: before its first skip the executions are the bars, and after its last
// run nothing reads the call.
// ⛔ The whole plot, not the bars after the skip: a window read `L` bars after
// the skip is exact again, a recursive one (`ta.ema`, a running `var`) never
// provably is, and which the tree is is not this module's to guess.
// ⚠️ A document saved before this stamp existed carries no `meta.blockRuns` and
// is computed as it always was, until it is translated again.

/** The guard name a refused column carries — the translation's own, for the
 *  same reason (`pine:block`: a block this engine reads as one expression). */
export const BLOCK_RUNS_GUARD = 'pine:block'

const stampOf = (def) => {
  const br = def && def.meta && def.meta.blockRuns
  return br && Array.isArray(br.keys) && br.keys.length ? br : null
}

/** The gates plot `key` carries — `[{why, guard}]` — or null. */
export function blockRunsFor(def, key) {
  const br = stampOf(def)
  if (!br) return null
  const hit = br.keys.find((k) => k && k.key === key)
  return hit && Array.isArray(hit.gates) && hit.gates.length ? hit.gates : null
}

const isRun = (v) => v === true || (typeof v === 'number' && Number.isFinite(v) && v !== 0)
const isSkip = (v) => v === false || v === 0

/** The first bar on which the block RUNS after a bar it SKIPPED —
 *  `{skipped, bar}` — or null when its executions are the bars it has run on. */
export function firstRunAfterSkip(column) {
  let skipped = -1
  const n = column ? column.length : 0
  for (let i = 0; i < n; i += 1) {
    const v = column[i]
    if (isSkip(v)) { if (skipped < 0) skipped = i } else if (skipped >= 0 && isRun(v)) return { skipped, bar: i }
  }
  return null
}

/**
 * Why plot `key` is not computable on these bars, or null.
 * `evaluate(tree)` computes one guard tree over the binding's own bars and
 * inputs (the caller's `interpret`, with the plot's own budget and options).
 * ⛔ A guard that cannot be evaluated refuses the plot too: an unread guard is
 * not a block that ran on every bar.
 */
export function blockRunsRefusal(def, key, evaluate) {
  const gates = blockRunsFor(def, key)
  if (!gates) return null
  for (const gate of gates) {
    let column
    try {
      column = evaluate(gate.guard)
    } catch (err) {
      return `${gate.why} — and whether the block runs on every bar of this chart could not be computed (${String((err && err.message) || err).slice(0, 160)})`
    }
    const hit = firstRunAfterSkip(column)
    if (hit) {
      return `${gate.why} — on this chart the block skips bar ${hit.skipped} and runs again on bar ${hit.bar}, `
        + 'so its calls have not run on every bar'
    }
  }
  return null
}
