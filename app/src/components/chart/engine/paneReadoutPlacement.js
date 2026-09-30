// app/src/components/chart/engine/paneReadoutPlacement.js
//
// ─── WHERE A PANE READOUT GOES: ASK THE RENDERER, BY IDENTITY ───────────────
//
// ⚰️⚰️ MEASURED IN THE FUNDAMENTALS HARNESS 2026-09-22, AND REPRODUCED WITH NO
// FUNDAMENTALS AT ALL. Two own-pane `sym:` series, the first for a symbol with
// no bars (`ZZZZ`), the second SPY: SPY's line drew in a pane labelled "ZZZZ",
// and SPY's own readout floated to the top of the chart over the candles.
//
// The cause is two authorities disagreeing about which panes exist:
//   · `computePaneLayout` runs BEFORE the binder computes anything, so it gives
//     EVERY own-pane host a slot — including one whose column is all-NaN.
//   · `pool.planBindings`' pane-existence test (trap #4) correctly gives an
//     all-NaN host NO series, so the renderer never creates that pane.
// A readout pinned by LAYOUT INDEX therefore labels the next pane down with the
// empty host's name, and every readout after it is one pane off (the last has
// no pane at all and keeps the CSS default: the top of the chart). It reads as
// correct, which is the worst way to be wrong -- a bank's Net Margin captioned
// "Gross Margin".
//
// ⭐ SO THE READOUT ASKS WHERE ITS SERIES ACTUALLY ARE, the rule `volumeBelowPrice`
// already follows: a pane readout belongs to the pane the renderer put a series
// of that pane key into, and a pane key with no drawn series has no readout.
// The layout is untouched -- heights stay its business.

/**
 * The renderer's pane index for a pane key, or:
 *   · `null`      -- the bindings were readable and NOTHING drawn belongs to
 *                    this key, so there is no pane for its readout;
 *   · `undefined` -- the question cannot be answered (no bindings API, no pane
 *                    API), so the caller keeps whatever it did before.
 *
 * @param {string} key                 pane key (host instance id, or VOLUME_PANE)
 * @param {object[]|null} bindings     `binder.bindings()`: `{instanceId, series}`
 * @param {(chip: {instanceId: string}) => string|null} hostOf  `chipPaneHost`
 */
export function rendererPaneIndexOf(key, bindings, hostOf) {
  if (typeof key !== 'string' || !key) return undefined
  if (!Array.isArray(bindings) || typeof hostOf !== 'function') return undefined
  let unanswerable = false
  for (const b of bindings) {
    if (!b || !b.series || typeof b.instanceId !== 'string') continue
    let host
    try { host = hostOf({ instanceId: b.instanceId }) } catch { host = null }
    if (host !== key) continue
    try {
      const idx = b.series.getPane().paneIndex()
      if (Number.isInteger(idx) && idx >= 0) return idx
    } catch { /* fall through */ }
    unanswerable = true
  }
  return unanswerable ? undefined : null
}

/**
 * The instance GROUP every row of one pane readout belongs to, or null.
 *
 * ⭐ A PANE THAT IS ONE LOGICAL INDICATOR IS TITLED BY IT. A COT dataset is three
 * `dataSeries` instances stamped with one `instance.group` (`discoveryCatalog`
 * `createProductSeries`) and drawn in one pane; its readout prints the group's name
 * once above the three participant rows. The answer is null — no title — unless
 * EVERY row is a member of the SAME group, so a member's own study dropped into that
 * pane, or any ordinary pane, reads exactly as before.
 *
 * @param {{instanceId: string}[]} chips  the rows of one pane readout
 * @param {object} cs                     chart settings (for the instances)
 * @returns {{id: string, name: string, note?: string}|null}
 */
export function paneGroupOf(chips, cs) {
  const list = Array.isArray(chips) ? chips : []
  if (!list.length) return null
  const insts = Array.isArray(cs && cs.indicatorInstances) ? cs.indicatorInstances : []
  let group = null
  for (const c of list) {
    const inst = c && insts.find((i) => i && !i.deleted && i.instanceId === c.instanceId)
    const g = inst && inst.group
    if (!g || typeof g.id !== 'string' || typeof g.name !== 'string' || !g.name) return null
    if (group && group.id !== g.id) return null
    group = group || g
  }
  return group
}
