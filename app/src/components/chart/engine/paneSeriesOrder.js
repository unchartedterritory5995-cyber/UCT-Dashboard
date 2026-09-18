// app/src/components/chart/engine/paneSeriesOrder.js
//
// ─── THE ONE AUTHORITY FOR *VISUAL* SERIES ORDER **INSIDE** A PANE ──────────
//
// ⭐⭐ THERE ARE THREE ORDERS ON THIS CHART AND THIS IS THE THIRD. The other two
// already have files, and the whole reason this one exists is that neither of
// them could carry it:
//
//   · `sourceRef.orderByDependency` sequences EVALUATION — `MA(QQQ)` cannot be
//     computed before `QQQ`. It is Kahn's algorithm over the source edges and it
//     is not a preference. Nothing here may touch it, and nothing here does:
//     `binder.sync` calls it on its own list (`const { ordered } =
//     orderByDependency(instances, …)`) and walks THAT for the compute pass,
//     while `planBindings(instances, …)` walks the array as stored for the bind
//     pass. The two are already separate reads of the same array, which is what
//     makes "computes after its dependency, draws before it" expressible at all.
//
//   · `paneOrder.js` orders whole PANES, top to bottom. Its own header states the
//     rule this file inherits — a stored order is a PREFERENCE, never a source of
//     truth about what exists — and its shape (one array of keys, one writer, one
//     reader) is deliberately copied here one level down.
//
//   · THIS orders the plotted series WITHIN one pane. Moving a row with the
//     arrows may not change which pane it is in, what it reads, or where any pane
//     sits; those are `Display`, `Source` and Arrange, and each already has its
//     own control.
//
// ⛔⛔ AND IT IS A PREFERENCE, NOT AN INVENTORY. `cs.overlays`,
// `cs.indicatorInstances` and `resolveDisplayTarget` decide what is in a pane;
// this only says what order to prefer for whatever is there. That distinction is
// the entire safety story: a stale id cannot delete a series, a missing id cannot
// hide one, and reading an old blob writes nothing. Every branch below is written
// so that the worst a wrong id can do is be ignored.
//
// ⛔ NO MIGRATION, AND ABSENT MEANS *EXACTLY WHAT THE CHART DOES TODAY*. A blob
// with no `paneSeriesOrder` resolves to the incoming order unchanged — the same
// promise `paneOrder` makes, kept the same way: the default is computed, so an
// old blob and a new one are the same chart.

/** Where the member's arrangement lives on the settings blob. */
export const PANE_SERIES_ORDER_KEY = 'paneSeriesOrder'

const isId = (k) => typeof k === 'string' && k.length > 0

/** Dedupe a list of ids, preserving first-seen order. */
function clean(list) {
  const out = []
  const seen = new Set()
  for (const k of (Array.isArray(list) ? list : [])) {
    if (!isId(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/**
 * The stored arrangement for one pane, cleaned — or `[]` when there is none.
 *
 * ⚠️ IT CAN NAME IDS THAT ARE NOT IN THE PANE RIGHT NOW, and that is deliberate
 * (see `setPaneSeriesOrder`). Callers that need "what is on screen" ask
 * `resolvePaneSeriesOrder`, which filters at READ time.
 */
export function storedPaneSeriesOrder(cs, paneKey) {
  if (!isId(paneKey)) return []
  const map = cs && cs[PANE_SERIES_ORDER_KEY]
  if (!map || typeof map !== 'object' || Array.isArray(map)) return []
  return clean(map[paneKey])
}

/**
 * The visual order of one pane's series, first to last.
 *
 * @param {object}   cs        chart settings
 * @param {string}   paneKey   `'price'`, `'volume'`, or a host instance id
 * @param {string[]} rowIds    the pane's CURRENT members, in canonical order
 * @returns {string[]} the same ids, reordered — never a different set
 *
 * ⭐ THE RETURNED SET IS ALWAYS EXACTLY `rowIds`. Not a superset (a stale
 * preference cannot conjure a row) and not a subset (a member the preference has
 * never heard of cannot vanish). Every test of this function asserts the set
 * before it asserts the order, because a reader that can drop a member is a
 * reader that can delete an indicator from a chart by having an old blob.
 *
 * ⛔ A NEW MEMBER GOES TO THE END, for the reason `resolvePaneOrder` records at
 * length: the canonical order it would otherwise be spliced beside is itself
 * derived from definition rank, so splicing lets rank move a row the member
 * placed. Appending is the least surprising default and cannot disturb any
 * pairwise relation the member established.
 */
export function resolvePaneSeriesOrder(cs, paneKey, rowIds) {
  const live = clean(rowIds)
  const stored = storedPaneSeriesOrder(cs, paneKey)
  if (!stored.length) return live

  const present = new Set(live)
  const out = []
  const placed = new Set()
  // Stored ids that are still members, in the member's order. Anything else in
  // the stored list is stale — a removed indicator, or one that has moved to
  // another pane — and is simply skipped.
  for (const id of stored) {
    if (!present.has(id) || placed.has(id)) continue
    out.push(id)
    placed.add(id)
  }
  for (const id of live) {
    if (placed.has(id)) continue
    out.push(id)
    placed.add(id)
  }
  return out
}

/**
 * `rows` reordered by `resolvePaneSeriesOrder`. The shape every consumer wants.
 *
 * @param {object}   cs
 * @param {string}   paneKey
 * @param {object[]} rows    the pane's rows, in canonical order
 * @param {Function} idOf    `(row) => string` — the row's stable id
 *
 * ⭐⭐ IT ORDERS GROUPS, NOT ELEMENTS, and that is required rather than tidy. A
 * row in `paneSeriesOrder` terms is ONE INDICATOR; a multi-output indicator is
 * several entries sharing one id (MACD's line and its SIG, Bollinger's three
 * bands). Ordering element-by-element would let a member's move split a group in
 * half, and the legend identifies a sibling row by ADJACENCY alone
 * (`secondary={prev.instanceId === c.instanceId}`), so a split group would print
 * as two unrelated studies. Entries sharing an id therefore travel together and
 * keep their own internal order.
 *
 * ⚠️ A ROW WHOSE ID IS EMPTY KEEPS ITS PLACE rather than being dropped — at the
 * end, in its own order. The read model mints an id for everything it lists, but
 * this function is also called by a renderer on a list it did not build, and "I
 * could not identify it" must never mean "it is not drawn".
 */
export function orderPaneRows(cs, paneKey, rows, idOf) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length < 2) return list
  const stored = storedPaneSeriesOrder(cs, paneKey)
  if (!stored.length) return list

  const groups = new Map()
  const anonymous = []
  for (const row of list) {
    const id = idOf ? idOf(row) : null
    if (!isId(id)) { anonymous.push(row); continue }
    const at = groups.get(id)
    if (at) at.push(row)
    else groups.set(id, [row])
  }
  const ordered = []
  for (const id of resolvePaneSeriesOrder(cs, paneKey, [...groups.keys()])) {
    for (const row of groups.get(id)) ordered.push(row)
  }
  return anonymous.length ? [...ordered, ...anonymous] : ordered
}

/**
 * Write one pane's arrangement.
 *
 * ⛔ THE ONE WRITER, exactly as `setPaneOrder` is for panes. Two ways to write an
 * order is how a settings list and a legend end up disagreeing about which line
 * is which.
 *
 * ⚠️ IT KEEPS IDS THAT ARE NOT IN THE PANE RIGHT NOW, at the end — the same
 * courtesy `setPaneOrder` extends to a hidden pane, and the reason a series that
 * leaves for another pane and comes back finds its old slot waiting. The
 * preference lies dormant while it is elsewhere and costs one string; the
 * alternative is cleanup machinery that has to know WHY an id went missing, and
 * "it is a preference, not an inventory" means it never has to ask.
 */
export function setPaneSeriesOrder(cs, paneKey, rowIds) {
  if (!cs || typeof cs !== 'object' || !isId(paneKey)) return cs
  const cleaned = clean(rowIds)
  if (!cleaned.length) return cs
  const seen = new Set(cleaned)
  for (const id of storedPaneSeriesOrder(cs, paneKey)) {
    if (!seen.has(id)) cleaned.push(id)
  }
  const prev = (cs[PANE_SERIES_ORDER_KEY] && typeof cs[PANE_SERIES_ORDER_KEY] === 'object'
    && !Array.isArray(cs[PANE_SERIES_ORDER_KEY])) ? cs[PANE_SERIES_ORDER_KEY] : null
  return {
    ...cs,
    [PANE_SERIES_ORDER_KEY]: { ...(prev || {}), [paneKey]: cleaned },
    preset: 'custom',
  }
}

/**
 * Move one series up (`-1`) or down (`+1`) inside its pane.
 *
 * @param {object}   cs
 * @param {string}   paneKey  the pane the row is CURRENTLY in
 * @param {string[]} rowIds   that pane's current members, in canonical order
 * @param {string}   rowId
 * @param {number}   delta    `-1` or `+1`
 * @returns {object} the next settings blob, or `cs` UNCHANGED
 *
 * ⛔ IT CANNOT CROSS A PANE BOUNDARY, and that is structural rather than
 * checked: the step is taken inside `rowIds`, which is one pane's membership, so
 * there is no index at either end that names anything outside it. A row that is
 * not a member is refused (`from < 0`) rather than added.
 *
 * ⛔ AND IT WRITES ONE KEY. No `Display`, no `targetExplicit`, no `Source`, no
 * `paneOrder`, no instance inputs — a visual order is the only thing the arrows
 * mean, and `canMoveSeries` is what the UI asks so a boundary press never
 * produces a write at all.
 */
export function moveSeriesWithinPane(cs, paneKey, rowIds, rowId, delta) {
  if (!cs || typeof cs !== 'object') return cs
  if (!isId(paneKey) || !isId(rowId)) return cs
  if (delta !== 1 && delta !== -1) return cs
  const order = resolvePaneSeriesOrder(cs, paneKey, rowIds)
  const from = order.indexOf(rowId)
  if (from < 0) return cs
  const to = from + delta
  if (to < 0 || to >= order.length) return cs      // first/last: a no-op, not a wrap
  const next = [...order]
  next.splice(to, 0, next.splice(from, 1)[0])
  return setPaneSeriesOrder(cs, paneKey, next)
}

/**
 * Move one series to sit immediately BEFORE another — the drop half of a drag.
 *
 * @param {object}   cs
 * @param {string}   paneKey   the pane the row is CURRENTLY in
 * @param {string[]} rowIds    that pane's current members, in canonical order
 * @param {string}   rowId     the series being moved
 * @param {?string}  beforeId  a sibling to land in front of, or `null` for last
 * @returns {object} the next settings blob, or `cs` UNCHANGED
 *
 * ⭐ IT IS `movePaneTo`, ONE LEVEL DOWN, and deliberately the same five lines:
 * resolve, remove, find the anchor, splice, write through the one writer. A drag
 * needs an absolute destination where the arrows needed a step, and expressing
 * that as "repeat `moveSeriesWithinPane` until the index matches" would produce a
 * settings write per intermediate position — seven of them to cross a seven-row
 * pane — for an arrangement the member only ever sees the end of.
 *
 * ⛔ SAME BOUNDARY, SAME STRUCTURE. `rowIds` is ONE pane's membership, so both
 * the moved id and the anchor are looked up inside it; an anchor from another
 * pane is simply not found and the row goes last WITHIN ITS OWN PANE rather than
 * anywhere near the pane the pointer was over. Crossing a boundary is `Display`'s
 * job and writes a different key.
 *
 * ⛔ AND IT STILL WRITES ONE KEY, through `setPaneSeriesOrder`. A drop is not a
 * different kind of event from a nudge; it is the same preference, decided with a
 * pointer.
 */
export function moveSeriesTo(cs, paneKey, rowIds, rowId, beforeId) {
  if (!cs || typeof cs !== 'object') return cs
  if (!isId(paneKey) || !isId(rowId)) return cs
  if (rowId === beforeId) return cs
  const order = resolvePaneSeriesOrder(cs, paneKey, rowIds)
  if (order.indexOf(rowId) < 0) return cs
  const without = order.filter((k) => k !== rowId)
  const at = isId(beforeId) ? without.indexOf(beforeId) : -1
  const next = at < 0
    ? [...without, rowId]
    : [...without.slice(0, at), rowId, ...without.slice(at)]
  // ⛔ A DROP THAT CHANGES NOTHING IS NOT A WRITE. Letting go on the row's own
  // slot is the commonest way a drag ends, and it must leave the blob identical
  // — same promise `moveSeriesWithinPane` keeps at a boundary.
  if (next.length === order.length && next.every((k, i) => k === order[i])) return cs
  return setPaneSeriesOrder(cs, paneKey, next)
}

/** Whether the arrows should be live — the same question the writer answers, so
 *  a disabled control and a refused write can never disagree. */
export function canMoveSeries(cs, paneKey, rowIds, rowId, delta) {
  if (!isId(paneKey) || !isId(rowId) || (delta !== 1 && delta !== -1)) return false
  const order = resolvePaneSeriesOrder(cs, paneKey, rowIds)
  const from = order.indexOf(rowId)
  if (from < 0) return false
  const to = from + delta
  return to >= 0 && to < order.length
}
