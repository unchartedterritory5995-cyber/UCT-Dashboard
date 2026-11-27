// app/src/components/chart/engine/firstPage.js
//
// ─── ⭐⭐ THE FIRST PAGE (coordinator-approved first-draw unit, 2026-11-23) ─────────────────────────────────────────
//
// ⚰️ Production 2026-11-23 (RDDT with Fred RS, a cold 1D -> intraday switch): every byte the pane needs had landed by
// 160-430 ms, and the pane stayed BLANK until 0.6-1.3 s: the worker computing Fred's values over 20,000-32,000 chart
// rows, with no picture of this pane to show meanwhile.
// So the NEWEST `FIRST_PAGE_ROWS` bars are computed TWICE, from two starts `FIRST_PAGE_PROBE` bars apart. ⛔ A plot is
// drawn on the first page ONLY where both starts agree BIT FOR BIT on every page bar AND its tree's reach is proved
// within the probe (`pageReachProvable`, e101): its values there do not depend on
// where history began (Fred's RS line, `close / SPX(t)`, reads no history at all). Any other plot (a moving average, a
// `var` state, `bar_index`) is WITHHELD whole on the first page, by name (`FIRST_PAGE_CODE`), and drawn when the full
// answer lands. The drawings (the run half) are not computed from a page: they wait for the full answer.
//
// ⛔⛔ THE COMPUTE RUNS IN THE WORKER (`hostLaneWorkerCore`, job kind 'firstPage'), NEVER ON THE CHART'S THREAD: measured
// 2026-11-23 on Fred RS 5m (4,224 rows), the two starts cost 125-158 ms of main thread against 5-11 ms without them
// (coordinator condition). The chart's thread only WIDENS the window that comes back (`widenFirstPage`: a copy).
import { astColumnsGiven, withWithheldBars, astTrees } from './astColumns.js'
import { maxLookback, declaredInputs } from './ast/lint.js'

export const FIRST_PAGE_ROWS = 1500
export const FIRST_PAGE_PROBE = 251
export const FIRST_PAGE_CODE = 'chart:first-page'
/** ⭐ What the member reads while a pane shows its first page (coordinator condition 2026-11-23): a plot withheld on the
 *  page is never read as missing. Published by `nativeRegistry.externalReadNotices` onto the disclosure strip. */
export const FIRST_PAGE_NOTE = 'Loading the full history: the newest bars are drawn first; older bars, and any line '
  + 'that needs them, are shown once the full history loads.'
/** The rows a page job carries: the page and the probe's earlier start. */
export const FIRST_PAGE_POST_ROWS = FIRST_PAGE_ROWS + FIRST_PAGE_PROBE

// ─── ⭐⭐ (e101, coordinator ruling 2026-11-27) TWO STARTS AGREEING IS NOT A PROOF; THE TREE'S OWN REACH IS ────────────
// ⚰️ MEASURED (`firstPageCensus.measure.test.js`, every corpus script the member door puts on the host lane, SPY 1D 8,507
// rows and SPY 60 23,554 rows): 571 plots agreed from both starts on the page, and 3 of them were WRONG against the full
// history (support-and-resistance-multi-time-frame, D: its weekly and monthly `valuewhen(high >= highest(high, 34), ...)`,
// whose deciding bar lies further back than both starts, so the starts agreed with each other and not with the full run).
// So a plot is drawn on the page only when its value at a bar PROVABLY depends on no bar further back than the probe's
// earlier start reaches: the tree's backward reach (`lint.js::maxLookback`, the evaluator's own declared windows, `tf`
// spans NOT trusted: a higher timeframe's read is refused) is a finite number of at most `FIRST_PAGE_PROBE` bars, and it
// reads no clock leaf whose value is a count from the history's first bar (`START_COUNTED_CLOCK`). Then the probe's values on the page are the full history's,
// and the two-start agreement (kept) proves the page's own values equal them. An unknown or unbounded reach, a knob-sized
// window (`lint.js`: unanalysable, fails closed) or a start-counted read is withheld on the page, by name, as before.

/** Clock leaves counted from the history's first bar (`closedTable.json` clock): the same bar reads another number when
 *  the history starts elsewhere, whatever its reach says. (A higher timeframe's read is refused beside them.) */
export const START_COUNTED_CLOCK = Object.freeze(['barindex', 'isfirst', 'lastbarindex'])
const readsStartCounted = (tree) => {
  const stack = [tree]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (typeof n.name === 'string' && START_COUNTED_CLOCK.includes(n.name)) return true
    // ⛔ a HIGHER timeframe's read (`tf`, `tf_live`): its reach in chart bars is a span ESTIMATE (`lint.js`: a period
    // is counted as a fixed number of chart bars), not a bound, and its first period on a page is partial. MEASURED: the
    // census's one remaining wrong plot after the reach rule was a monthly `valuewhen` whose estimated reach fit the probe.
    if (n.type === 'tf' || n.type === 'tf_live') return true
    for (const v of Object.values(n)) if (v && typeof v === 'object') stack.push(v)
  }
  return false
}

/** May plot `key` of `def` be drawn from a page: its tree's reach is finite and within the probe, and it reads no
 *  start-counted clock leaf. Exported for its rail. */
export function pageReachProvable(def, key) {
  const trees = astTrees(def)
  const tree = trees ? trees[key] : (def && def.compute && def.compute.ast)
  if (!tree || typeof tree !== 'object') return false
  let back
  try { back = maxLookback(tree, { inputs: declaredInputs(def) }) } catch { return false }
  return typeof back === 'number' && Number.isFinite(back) && back >= 0 && back <= FIRST_PAGE_PROBE
    && !readsStartCounted(tree)
}

/** Do two columns hold the same value on the last `n` bars, bit for bit (`NaN` equal to `NaN`)? */
export function sameTail(a, b, n) {
  if (!a || !b || a.length < n || b.length < n) return false
  for (let i = 1; i <= n; i += 1) if (!Object.is(a[a.length - i], b[b.length - i])) return false
  return true
}

/**
 * ⛔ WORKER SIDE. The page over `rows` (the newest `FIRST_PAGE_POST_ROWS` chart rows): per plot, whether both starts
 * agree bit for bit, and, for an exact plot only, its `FIRST_PAGE_ROWS` page values. A throw is the caller's.
 * @returns {{keys: string[], exact: boolean[], values: (Float64Array|null)[]}}
 */
export function firstPageWindow(def, rows, scalars, ctx, stop) {
  const page = astColumnsGiven(def, rows.slice(FIRST_PAGE_PROBE), scalars, ctx, stop)
  const probe = astColumnsGiven(def, rows, scalars, ctx, stop)
  const keys = []
  const exact = []
  const values = []
  for (const key of Object.keys(page)) {
    const col = page[key]
    if (!col || typeof col.length !== 'number' || col.length !== FIRST_PAGE_ROWS) continue
    const same = sameTail(col, probe[key], FIRST_PAGE_ROWS) && pageReachProvable(def, key)
    keys.push(key)
    exact.push(same)
    values.push(same ? Float64Array.from(col) : null)
  }
  return { keys, exact, values }
}

/**
 * CHART'S THREAD: the window widened to the chart's `n` rows (a copy, no compute): an exact plot's page values on the
 * newest bars, `NaN` before them; a start-dependent plot `NaN` everywhere; each plot's withholding named
 * (`FIRST_PAGE_CODE`: before the page for an exact plot, every bar otherwise). Null when the window holds no plot.
 */
export function widenFirstPage(win, n) {
  if (!win || !Array.isArray(win.keys) || !win.keys.length || n < FIRST_PAGE_ROWS) return null
  const cut = n - FIRST_PAGE_ROWS
  const all = new Float64Array(n).fill(1)
  const before = new Float64Array(n)
  before.fill(1, 0, cut)
  const out = {}
  const withheld = {}
  win.keys.forEach((key, j) => {
    const full = new Float64Array(n).fill(NaN)
    const exact = !!win.exact[j] && win.values[j] && win.values[j].length === FIRST_PAGE_ROWS
    if (exact) full.set(win.values[j], cut)
    out[key] = full
    withheld[key] = new Map([[FIRST_PAGE_CODE, exact ? before : all]])
  })
  return withWithheldBars(out, withheld)
}
