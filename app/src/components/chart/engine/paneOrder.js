// app/src/components/chart/engine/paneOrder.js
//
// ─── THE ONE AUTHORITY FOR *VISUAL* PANE ORDER ──────────────────────────────
//
// ⭐⭐ VISUAL ORDER IS NOT COMPUTATION ORDER, AND THIS FILE EXISTS TO KEEP THEM
// APART. The engine already has two other orderings and neither of them is this:
//
//   · `orderByDependency` (sourceRef) sequences EVALUATION — `MA(QQQ)` cannot be
//     computed before `QQQ`. Moving a pane must never touch it, or dragging a
//     rectangle in a settings panel would change what a formula reads.
//   · `FROZEN_SHIPPED_STACK_ORDER` (instances.js) is the DEFAULT arrangement a v1
//     blob is seeded into, and the sort `withInstances` re-applies so a list
//     built from different charts still comes back in one predictable shape.
//
// Neither can carry a user's arrangement: the first is a dependency graph, and
// the second is keyed by DEFINITION, so it cannot tell two RSIs apart and has no
// way to say anything about Price or Volume at all. So the user's order is its
// own fact, stored in its own place, read by exactly one function.
//
// ⛔ AND IT IS A LIST OF PANE KEYS, NOT A RANK ON EACH INSTANCE. A per-instance
// `order` field would be three separate problems: `withInstances` re-sorts the
// array on every canonical write and would fight it; Price and Volume are not
// instances and could not hold one; and two writers (a rank and an array
// position) can disagree. One array, one writer, one reader.
//
// ⚠️ ABSENT MEANS "EXACTLY WHAT THE CHART DOES TODAY". A blob with no
// `paneOrder` resolves to Price, then a separate Volume pane if there is one,
// then the own-panes in stack order — which is the arrangement every saved chart
// already renders. There is no migration and nothing to write on load; the
// default is computed, so an old blob and a new one are the same chart.

/** The two panes that are not hosted by an instance. */
export const PRICE_PANE = 'price'
export const VOLUME_PANE = 'volume'

/** Where the user's arrangement lives on the settings blob. */
export const PANE_ORDER_KEY = 'paneOrder'

const isKey = (k) => typeof k === 'string' && k.length > 0

/** The stored arrangement, cleaned — or `[]` when there is none. */
export function storedPaneOrder(cs) {
  const raw = cs && cs[PANE_ORDER_KEY]
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const k of raw) {
    if (!isKey(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/**
 * The visual pane stack, top to bottom.
 *
 * @param {object}   cs         chart settings
 * @param {string[]} paneKeys   the own-pane instance keys, in DEFAULT order —
 *                              i.e. `computePaneLayout`'s `orderedPaneKeys`
 * @param {object}   [opts]
 * @param {boolean}  [opts.volumePane]  a SEPARATE volume pane exists
 * @returns {string[]} keys including `'price'` and, when it has one, `'volume'`
 *
 * ⭐ THE DEFAULT IS THE PRODUCT'S CURRENT LAYOUT, WRITTEN ONCE. Price first,
 * then the volume pane if it is separate, then the oscillator stack — which is
 * `firstPaneIndex = 1 + (volSeparatePane ? 1 : 0)` restated as a list. Keeping
 * the two in step is the whole reason this returns the default rather than
 * leaving each caller to assemble one.
 *
 * ⛔ A STORED ORDER IS A PREFERENCE, NEVER A SOURCE OF TRUTH ABOUT WHAT EXISTS.
 * Keys that are no longer on the chart are dropped, and panes the stored list
 * has never heard of are APPENDED — see the note at the splice for why they used
 * to be inserted beside a default neighbour and why that let definition rank
 * move panes the member had arranged.
 */
export function resolvePaneOrder(cs, paneKeys, opts) {
  const keys = Array.isArray(paneKeys) ? paneKeys.filter(isKey) : []
  const hasVolumePane = !!(opts && opts.volumePane)

  const dflt = [PRICE_PANE, ...(hasVolumePane ? [VOLUME_PANE] : []), ...keys]
  const live = new Set(dflt)

  const stored = storedPaneOrder(cs).filter((k) => live.has(k))
  if (!stored.length) return dflt

  // ⚰️⚰️ A NEW PANE GOES TO THE BOTTOM. IT USED TO GO BESIDE ITS *DEFAULT*
  // NEIGHBOUR, AND THAT LET DEFINITION RANK REACH THE SCREEN.
  //
  // The rule here was: splice each unknown key in beside the nearest key it sits
  // next to in `dflt`. `dflt` is ordered by the instance array, which
  // `withInstances` re-sorts by DEFINITION RANK on every canonical write — so
  // the arrangement of panes the member had never touched decided where a new
  // one landed, and it could land anywhere.
  //
  // ⛔ MEASURED, and it is the owner's "adding a series moved my panes". Stored
  // `["inst:rsi:1", "price"]` — RSI arranged above Price — then add QQQ:
  //
  //     was   ["rsi", "dataSeries", "price", "volume"]   ← above Price!
  //     now   ["rsi", "price", "volume", "dataSeries"]
  //
  // QQQ's default predecessor is RSI, and RSI happens to sit at the top in this
  // member's arrangement, so the new pane teleported to the top. Nothing about
  // adding QQQ says anything about where it belongs relative to a pane the
  // member deliberately moved.
  //
  // ⭐ ONCE AN ARRANGEMENT EXISTS IT IS AUTHORITATIVE. The stored list is
  // preserved EXACTLY — every pairwise relation the member established survives
  // — and anything new is appended. Appending is the least surprising default
  // and, unlike the splice, it cannot move a pane the member placed.
  //
  // ⚠️ THIS IS THE `stored.length` BRANCH ONLY. A chart with NO arrangement
  // still takes `dflt` wholesale above, which is the shipped layout and the
  // whole backward-compatibility story; deriving the FIRST stack from definition
  // rank is legitimate, letting it re-derive later is not.
  const out = [...stored]
  const placed = new Set(stored)
  for (const k of dflt) {
    if (placed.has(k)) continue
    out.push(k)
    placed.add(k)
  }
  return out
}

/**
 * Write a new arrangement.
 *
 * ⛔ THE ONE WRITER. Chart Data's drag and its Move up / Move down call this,
 * and so would anything else that ever reorders panes; the renderer reads
 * `resolvePaneOrder` and nothing else. Two ways to write an order is how a UI
 * list and a chart end up disagreeing about which pane is on top.
 *
 * ⚠️ IT STORES THE WHOLE ARRANGEMENT, INCLUDING KEYS THAT ARE HIDDEN RIGHT NOW.
 * A hidden host draws nothing and gets no pane (`paneOwnKeys` skips it), but the
 * member still put it somewhere, and un-hiding it should not send it to the
 * bottom. `resolvePaneOrder` filters to what is live at READ time, so a latent
 * key costs nothing and remembers everything.
 */
export function setPaneOrder(cs, keys) {
  if (!cs || typeof cs !== 'object') return cs
  const cleaned = []
  const seen = new Set()
  for (const k of (Array.isArray(keys) ? keys : [])) {
    if (!isKey(k) || seen.has(k)) continue
    seen.add(k)
    cleaned.push(k)
  }
  if (!cleaned.length) return cs
  // Keys the member has arranged before but which are not on the chart right now
  // are carried through, at the end, so hiding and showing is not destructive.
  for (const k of storedPaneOrder(cs)) if (!seen.has(k)) cleaned.push(k)
  return { ...cs, [PANE_ORDER_KEY]: cleaned, preset: 'custom' }
}

/**
 * Move one pane up (`-1`) or down (`+1`) in the visible stack.
 *
 * ⛔ IT MOVES WITHIN THE RESOLVED ORDER, NOT WITHIN THE STORED ONE. The stored
 * list can carry hidden keys; stepping over one of those would look like the
 * control did nothing. So the step is taken against what is on screen and the
 * result is handed back to `setPaneOrder`, which re-attaches the latent keys.
 *
 * @returns {object} the next settings blob, or `cs` UNCHANGED at the boundary
 */
export function movePane(cs, paneKeys, key, delta, opts) {
  if (!isKey(key) || (delta !== 1 && delta !== -1)) return cs
  const order = resolvePaneOrder(cs, paneKeys, opts)
  const from = order.indexOf(key)
  if (from < 0) return cs
  const to = from + delta
  if (to < 0 || to >= order.length) return cs      // top/bottom: a no-op, not a wrap
  const next = [...order]
  next.splice(to, 0, next.splice(from, 1)[0])
  return setPaneOrder(cs, next)
}

/**
 * Move `key` so it lands immediately BEFORE `beforeKey` (or last, when null).
 * The drag's writer — the same one `movePane` uses, reached a different way.
 */
export function movePaneTo(cs, paneKeys, key, beforeKey, opts) {
  if (!isKey(key)) return cs
  const order = resolvePaneOrder(cs, paneKeys, opts)
  if (order.indexOf(key) < 0) return cs
  if (key === beforeKey) return cs
  const without = order.filter((k) => k !== key)
  const at = isKey(beforeKey) ? without.indexOf(beforeKey) : -1
  const next = at < 0 ? [...without, key] : [...without.slice(0, at), key, ...without.slice(at)]
  return setPaneOrder(cs, next)
}
