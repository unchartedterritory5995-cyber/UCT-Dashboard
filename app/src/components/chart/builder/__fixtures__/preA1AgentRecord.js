// app/src/components/chart/builder/__fixtures__/preA1AgentRecord.js
//
// ⛔ FROZEN — NEVER EDIT. A verbatim copy of the change-record helpers as they stood in
// `builder/agentMutations.js` at master `fdba4c997d`, before A1.0 moved them into
// `engine/settingsRecord.js`. `settingsRecordParity.test.js` runs this copy and the live
// module side by side over the Agent's own fixtures and asserts byte-identical records and
// Undo results. If this file changes, the parity proof means nothing.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const refuse = (reason, detail) => (detail === undefined ? { ok: false, reason } : { ok: false, reason, detail })
const REASONS = { RESTORE_CONFLICT: 'restore-conflict' }
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : isObj(v) ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v === undefined ? null : v))
const same = (a, b) => canon(a) === canon(b)
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
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
const holds = (root, entry) => (entry.order ? same(orderAt(root, entry), entry.order.after) : same(getAt(root, entry.path), entry.after))

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
const getAt = (root, path) => path.reduce(step, root)

function setAt(root, path, value) {
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

/** Apply `before` at every recorded path, only if every path still holds `after`. */
function revert(cs, record) {
  for (const p of record.paths) {
    if (!holds(cs, p)) return refuse(REASONS.RESTORE_CONFLICT, { path: p.path })
  }
  let next = cs
  try {
    for (const p of record.paths) if (!p.order) next = setAt(next, p.path, p.before)
    for (const p of record.paths) if (p.order) next = reorderAt(next, p, p.order.before)
  } catch {
    return refuse(REASONS.RESTORE_CONFLICT, { path: null })
  }
  return { ok: true, cs: next }
}

export { canon, same, clone, holds, getAt, setAt, revert }
