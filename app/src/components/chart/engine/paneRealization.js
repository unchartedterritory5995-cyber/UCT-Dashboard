// app/src/components/chart/engine/paneRealization.js
//
// ─── A SLOT IS NOT A PLACE TO CREATE A SERIES ───────────────────────────────
//
// ⚰️⚰️ THE DEFECT THIS MODULE EXISTS FOR, MEASURED AGAINST A CONTROL.
// `paneLayout` hands out FINAL VISUAL SLOTS — where each pane ends up once the
// chart is arranged. The candle series, though, is created at physical pane 0
// long before the binder runs. Hand the binder final slots on a COLD build while
// Price's slot is 1, and its first `addSeries(…, 0)` lands inside the candles'
// own pane: lightweight-charts realises that as ONE shared pane, four semantic
// panes render as three, and no later move splits them back — panes do not
// separate retroactively. The same chart with no arrangement rebuilt all four,
// so it was the arrangement doing it. The LIVE path never saw this, because
// there the panes already existed.
//
// ⭐⭐ SO THERE ARE TWO IDEAS AND THEY MUST NOT COLLAPSE INTO ONE:
//
//   FINAL VISUAL SLOT   where a pane ends up — `paneLayout.panes[].index`,
//                       `priceIndex`, `volumeIndex`.
//   REALISATION         making the physical chart able to hold that
//                       arrangement, BEFORE anything is created into it.
//
// `prepare` establishes the precondition; only then may series be placed at
// final slots; `settle` asserts the result. A future caller that places series
// at slots without preparing first has reintroduced the merge, and
// `__tests__/paneRealization.test.js` fails in exactly that shape.
//
// ⚠️ EVERY MOVE HERE IS `IPaneApi.moveTo` — the PANE verb. It carries a pane's
// contents with it (a host and its guests travel as one) and destroys nothing.
// `ISeriesApi.moveToPane` is the series verb: move the last series out of a pane
// and the library collects the pane, every later index shifts, and the next move
// lands somewhere else. An earlier attempt used it and took a four-pane chart to
// two on a single "move up".

/** How many panes sit above the arrangement and are not part of it. */
const pinnedCount = (opts) => (Number.isInteger(opts?.pinned) && opts.pinned > 0 ? opts.pinned : 0)

const paneList = (chart) => {
  try { return (typeof chart?.panes === 'function' ? chart.panes() : []) || [] } catch { return [] }
}

/** The slot a semantic pane key occupies in the final arrangement, or -1. */
export function slotOfKey(order, key, opts) {
  const at = Array.isArray(order) ? order.indexOf(key) : -1
  return at < 0 ? -1 : at + pinnedCount(opts)
}

/**
 * Move ONE semantic pane to its final slot, by EXCHANGING it with whatever is
 * there. A no-op when it is already in place or the chart cannot answer.
 *
 * ⚰️ `chart.swapPanes`, NOT `IPaneApi.moveTo`, AND THE REASON IS A VALIDATION
 * DIFFERENCE INSIDE THE LIBRARY. `moveTo` asserts its target against
 * `paneWidgets().length` — the RENDERED widgets, which do not exist yet for a
 * pane added moments earlier — so the first move after `addPane` throws
 * "Invalid pane index". `swapPanes` asserts against the model's own pane array,
 * which `addPane` updates synchronously. Measured: `addPane(true)×3` then
 * `moveTo(1)` throws on a real chart, and the throw was being swallowed by the
 * caller's try/catch — which is why preparation silently did nothing and the
 * merge survived the first fix.
 *
 * ⚠️ AN EXCHANGE, NOT AN INSERT. Walking the order top-to-bottom and swapping
 * each key into its slot is a selection sort: it converges in at most one swap
 * per pane and every swap carries both panes' contents, so a host and its guests
 * are never separated.
 */
export function moveKeyToSlot(chart, key, opts) {
  try {
    const want = slotOfKey(opts?.order, key, opts)
    if (want < 0) return false
    const pane = opts?.paneOf ? opts.paneOf(key) : null
    if (!pane) return false
    const have = pane.paneIndex?.()
    if (!Number.isInteger(have) || have === want) return false
    if (paneList(chart).length <= Math.max(have, want)) return false
    chart.swapPanes(have, want)
    return true
  } catch { return false }
}

/**
 * STEP 1 — make the physical chart able to hold the arrangement.
 *
 * Runs BEFORE the binder. After it, every final slot the binder is about to use
 * names a DISTINCT pane, so a collision is not merely unlikely — it is
 * unconstructible.
 *
 * @param {object} chart  the lightweight-charts API
 * @param {object} opts
 * @param {string[]} opts.order             resolved pane order, top to bottom
 * @param {number}   opts.paneCountRequired `paneLayout.paneCountRequired`
 * @param {number}   [opts.pinned]          panes above the arrangement (index pane)
 * @param {Function} opts.paneOf            key → IPaneApi | null
 * @param {string}   opts.priceKey
 * @param {string}   [opts.volumeKey]       omit when volume is a BAND, not a pane
 */
export function prepareArrangement(chart, opts) {
  const order = Array.isArray(opts?.order) ? opts.order : []
  if (order.length <= 1) return
  try {
    // (a) ENOUGH DISTINCT PANES. `addPane(true)` preserves an empty pane so it
    //     survives until the binder fills it; `settleArrangement` removes any
    //     that stay empty. The guard is paranoia, not arithmetic — this loop
    //     must never be the thing that hangs a chart.
    const need = Number.isInteger(opts.paneCountRequired) ? opts.paneCountRequired : 0
    for (let guard = 0; guard < 24 && paneList(chart).length < need; guard++) {
      chart.addPane(true)
    }
    // (b) THE CANDLES OUT OF THE WAY, FIRST. Pane 0 is where they are born and
    //     where the binder would otherwise put whatever the member arranged to
    //     the top. This single move is the whole cold-build fix.
    if (opts.priceKey) moveKeyToSlot(chart, opts.priceKey, opts)
    if (opts.volumeKey) moveKeyToSlot(chart, opts.volumeKey, opts)
  } catch { /* pane API unavailable — the chart renders unarranged */ }
}

/**
 * STEP 2 — assert the final order, and leave no placeholder behind.
 *
 * Runs AFTER the binder, so it catches panes that only came into existence
 * during that sync. Idempotent: on an already-arranged chart it moves nothing.
 */
export function settleArrangement(chart, opts) {
  const order = Array.isArray(opts?.order) ? opts.order : []
  if (order.length <= 1) return
  try {
    // Top-to-bottom: each pane into its slot. Moving one shifts the others, so
    // the live index is re-read at every step rather than precomputed.
    for (const key of order) moveKeyToSlot(chart, key, opts)
    // ⛔ AND NO PLACEHOLDERS LEFT BEHIND. `addPane(true)` keeps an empty pane
    // alive on purpose; one the binder never filled would sit in the stack
    // taking height and make the pane COUNT disagree with the number of panes
    // the chart actually has anything in.
    const pinned = pinnedCount(opts)
    const panes = paneList(chart)
    for (let i = panes.length - 1; i >= pinned; i--) {
      try {
        if ((panes[i].getSeries?.() || []).length === 0) chart.removePane(i)
      } catch { /* leave it rather than risk removing a live pane */ }
    }
  } catch { /* pane API unavailable */ }
}
