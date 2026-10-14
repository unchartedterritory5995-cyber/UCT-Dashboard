// app/src/components/chart/engine/settingsRecord.js
//
// ⭐ THE CHANGE RECORD — what a settings writer changed, path by path, and the exact,
// never-partial revert of it. Indicators-owned; pure (no React, no persistence).
//
// Moved verbatim out of `builder/agentMutations.js` (A1.0), so the Agent's Undo and the
// Indicators undo stack (A1.2) share ONE implementation instead of two that can drift.
// `builder/agentMutations.js` keeps every export it had; `settingsRecordParity.test.js`
// holds this module byte-identical to the frozen pre-move copy over the Agent fixtures.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

// ─── canonical JSON ───────────────────────────────────────────────────────────

export const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : isObj(v) ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v === undefined ? null : v))
export const same = (a, b) => canon(a) === canon(b)
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

// ─── the change record: what a writer changed, path by path ───────────────────
//
// Arrays of objects with a unique string `instanceId` are KEYED (a path names the
// instance, not its index), so an edit to ANOTHER indicator never conflicts with
// this one. Any other array — or a keyed array whose ids or order changed — is one
// leaf, compared whole: coarser, never inexact.

const keyedIds = (arr) => {
  if (!Array.isArray(arr) || !arr.length) return null
  const ids = arr.map((e) => (isObj(e) && typeof e.instanceId === 'string' ? e.instanceId : null))
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null
}

function diffInto(a, b, path, out) {
  if (same(a, b)) return
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) diffInto(a[k], b[k], [...path, k], out)
    return
  }
  const ka = keyedIds(a); const kb = keyedIds(b)
  if (ka && kb && ka.length === kb.length && same([...ka].sort(), [...kb].sort())) {
    // same instances: compare each BY ID, and the order as its own entry (a removal's
    // tombstone re-sorts to the end — that must not make every later edit a conflict)
    for (const id of ka) diffInto(a.find((e) => e.instanceId === id), b.find((e) => e.instanceId === id), [...path, { instanceId: id }], out)
    if (!same(ka, kb)) out.push({ path, order: { before: ka, after: kb } })
    return
  }
  out.push({ path, before: clone(a), after: clone(b) })
}

/** The recorded ids' order as they appear NOW in the keyed array at `path`. */
const orderAt = (root, entry) => {
  const arr = getAt(root, entry.path)
  const want = new Set(entry.order.after)
  return Array.isArray(arr) ? arr.map((e) => (isObj(e) ? e.instanceId : null)).filter((id) => want.has(id)) : null
}
/** Put the recorded ids back in `order` relative order; anything added since keeps its
 *  relative place after them (deterministic). */
function reorderAt(root, entry, order) {
  const arr = getAt(root, entry.path)
  const byId = new Map(arr.map((e) => [e.instanceId, e]))
  const recorded = new Set(order)
  const extras = arr.filter((e) => !recorded.has(e.instanceId))
  return setAt(root, entry.path, [...order.filter((id) => byId.has(id)).map((id) => byId.get(id)), ...extras])
}
export const holds = (root, entry) => (entry.order ? same(orderAt(root, entry), entry.order.after) : same(getAt(root, entry.path), entry.after))

/** `{ paths: [{path, before, after}] }` — every leaf `next` differs from `prev` on. */
export function changeRecord(prev, next) {
  const paths = []
  diffInto(prev, next, [], paths)
  return { paths }
}

const step = (node, seg) => {
  if (node === undefined || node === null) return undefined
  if (isObj(seg)) return Array.isArray(node) ? node.find((e) => isObj(e) && e.instanceId === seg.instanceId) : undefined
  return isObj(node) ? node[seg] : undefined
}
export const getAt = (root, path) => path.reduce(step, root)

export function setAt(root, path, value) {
  if (!path.length) return clone(value)
  const [seg, ...rest] = path
  if (isObj(seg)) {
    const arr = Array.isArray(root) ? root : []
    const i = arr.findIndex((e) => isObj(e) && e.instanceId === seg.instanceId)
    if (i < 0) throw new Error('missing keyed element')
    const copy = arr.slice()
    copy[i] = setAt(arr[i], rest, value)
    return copy
  }
  const obj = isObj(root) ? { ...root } : {}
  const v = setAt(obj[seg], rest, value)
  if (v === undefined) delete obj[seg]; else obj[seg] = v
  return obj
}

/**
 * Apply `before` at every recorded path, only if every path still holds `after`.
 * `{ok:true, cs}` | `{ok:false, path}` (`path: null` when a keyed element is gone).
 * Never partial: a refusal writes nothing.
 */
export function revertRecord(cs, record) {
  // ⭐ A1.2: an ELEMENT record (the Indicators undo stack's) takes its own path. A record
  // without `granularity` — every Agent record — runs the code below, unchanged.
  if (record && record.granularity === ELEMENT) return revertElementRecord(cs, record)
  for (const p of record.paths) {
    if (!holds(cs, p)) return { ok: false, path: p.path }
  }
  let next = cs
  try {
    for (const p of record.paths) if (!p.order) next = setAt(next, p.path, p.before)
    for (const p of record.paths) if (p.order) next = reorderAt(next, p, p.order.before)
  } catch {
    return { ok: false, path: null }
  }
  return { ok: true, cs: next }
}

// ─── A1.2 · ELEMENT granularity (opt-in; Agent records never carry it) ────────
//
// The Indicators undo stack records `indicatorInstances` ONE WHOLE ELEMENT per path
// (`['indicatorInstances', {instanceId}]`), so reverting writes the stored element back
// verbatim — byte-identical after the persisted read, where a leaf `setAt` would rebuild
// the element's key order. An element may be ABSENT on either side: `before: undefined`
// is an add (undo splices it out), `after: undefined` a removal (undo puts it back, in
// its recorded place). Every other changed top-level key is one whole-value path.
// Exactness is the leaf mode's: every path must still hold its `after`, compared
// canonically, or nothing is written.

export const ELEMENT = 'element'
const LIST_KEY = 'indicatorInstances'

const idList = (arr) => {
  if (arr === undefined) return []
  if (!Array.isArray(arr)) return null
  const ids = arr.map((e) => (isObj(e) && typeof e.instanceId === 'string' ? e.instanceId : null))
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null
}

/** `{granularity:'element', paths}` — what `next` changed relative to `prev`, element-wise
 *  for the instance list, whole-value for every other top-level key. */
export function elementRecord(prev, next) {
  const a = isObj(prev) ? prev : {}
  const b = isObj(next) ? next : {}
  const paths = []
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (same(a[k], b[k])) continue
    const ka = k === LIST_KEY ? idList(a[k]) : null
    const kb = k === LIST_KEY ? idList(b[k]) : null
    if (ka && kb) {
      const ea = new Map((a[k] || []).map((e) => [e.instanceId, e]))
      const eb = new Map((b[k] || []).map((e) => [e.instanceId, e]))
      for (const id of [...new Set([...ka, ...kb])].sort()) {
        if (!same(ea.get(id), eb.get(id))) paths.push({ path: [k, { instanceId: id }], before: clone(ea.get(id)), after: clone(eb.get(id)) })
      }
      if (!same(ka, kb)) paths.push({ path: [k], order: { before: ka, after: kb } })
      continue
    }
    paths.push({ path: [k], before: clone(a[k]), after: clone(b[k]) })
  }
  return { granularity: ELEMENT, paths }
}

/** The same record, the other way round (Redo is the Undo of the inverse). */
export function invertRecord(record) {
  return {
    ...record,
    paths: record.paths.map((p) => (p.order
      ? { path: p.path, order: { before: p.order.after, after: p.order.before } }
      : { path: p.path, before: p.after, after: p.before })),
  }
}

/** The recorded order's ids as they sit NOW (absent ones dropped). */
const elementOrderNow = (root, entry) => {
  const arr = getAt(root, entry.path)
  const want = new Set(entry.order.after)
  return Array.isArray(arr) ? arr.map((e) => (isObj(e) ? e.instanceId : null)).filter((id) => want.has(id)) : []
}
// ⭐ ORDER NEVER REFUSES. A chart's VIEW of its list can be ordered differently from the
// blob it wrote (an override surface merges the base list first), so an order entry that no
// longer matches is drift, not a conflict: the elements are what Undo must get exactly
// right. The recorded order is restored when it still holds, and otherwise left as it is.
const orderHolds = (root, entry) => same(elementOrderNow(root, entry),
  entry.order.after.filter((id) => getAt(root, [...entry.path, { instanceId: id }]) !== undefined))
const elementHolds = (root, entry) => (entry.order ? true : same(getAt(root, entry.path), entry.after))

function putElement(root, path, value) {
  const [k, seg] = path
  const arr = Array.isArray(root[k]) ? root[k] : []
  const i = arr.findIndex((e) => isObj(e) && e.instanceId === seg.instanceId)
  const copy = arr.slice()
  if (value === undefined) { if (i >= 0) copy.splice(i, 1) } else if (i >= 0) copy[i] = clone(value); else copy.push(clone(value))
  return { ...root, [k]: copy }
}

function revertElementRecord(cs, record) {
  if (!isObj(cs) || !Array.isArray(record.paths)) return { ok: false, path: null }
  for (const p of record.paths) {
    if (!elementHolds(cs, p)) return { ok: false, path: p.path }
  }
  const orderOk = new Set(record.paths.filter((p) => p.order && orderHolds(cs, p)))
  let next = { ...cs }
  for (const p of record.paths) {
    if (p.order) continue
    if (p.path.length === 2 && isObj(p.path[1])) next = putElement(next, p.path, p.before)
    else if (p.before === undefined) { const { [p.path[0]]: _gone, ...rest } = next; next = rest } else next = { ...next, [p.path[0]]: clone(p.before) }
  }
  for (const p of record.paths) {
    if (!p.order || !orderOk.has(p)) continue
    const arr = Array.isArray(next[p.path[0]]) ? next[p.path[0]] : []
    const byId = new Map(arr.map((e) => [e.instanceId, e]))
    const recorded = new Set(p.order.before)
    next = { ...next, [p.path[0]]: [...p.order.before.filter((id) => byId.has(id)).map((id) => byId.get(id)), ...arr.filter((e) => !recorded.has(e.instanceId))] }
  }
  return { ok: true, cs: next }
}
