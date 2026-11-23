// app/src/components/chart/builder/memberPane/memberDoorProtocol.js
//
// ⭐⭐ THE PASTE WORKER — WHAT CROSSES BETWEEN THE PAGE AND THE MEMBER DOOR'S WORKER, a leaf module (it imports
// nothing), so the page can speak the protocol without loading what the worker runs.
//
// The worker (`memberDoorWorker.js`, handler `memberDoorWorkerCore.js`) answers three kinds of job, each over the page's
// state imaged into it (`memberDoorImage.js`):
//   · MEMBER_DOOR_JOB     the chart door's build of a script (`memberPaneDefinition`);
//   · INSPECT_JOB         PasteBox's report of a text (`inspectSource` / `inspectPine`);
//   · INSPECT_LIBRARY_JOB the report of a paste of several scripts (`libraryIntake.inspectLibrary`).
//
// ⛔ AN ANSWER CROSSES FAITHFULLY. A structured clone keeps every own ENUMERABLE field, a Map, a Set and an object
// reached twice as one object; it drops a NON-ENUMERABLE own property, and the translator writes those on purpose (a
// parameter's id on a tree literal, `__uctParamId`; a row's handoffs, `_displaceParams`, ...), read on the page by
// what PasteBox and the sheet build from the report. So the worker sends, beside the answer, every non-enumerable own
// property it holds (`hidden`: the object, the key, the value and its descriptor's flags), and the page puts each one
// back exactly so (`restoreFaithful`) before anyone reads the answer: the same object, field for field, as the
// synchronous call returned. A property the clone cannot carry at all (a function, a symbol key) is counted
// (`lost`), never silently dropped from the count.

/** The message kind of a chart door build. */
export const MEMBER_DOOR_JOB = 'member-door'
/** The message kind of PasteBox's report of one text. */
export const INSPECT_JOB = 'inspect'
/** The message kind of the report of a paste holding several scripts. */
export const INSPECT_LIBRARY_JOB = 'inspect-library'
// ⭐ Besides jobs (each answered by a reply naming its `id`): `{kind: 'peer', role}` with a port (the page's MessageChannel
// between the door's worker and the report's), `{type: 'door-answer', key, version, source, answer, hidden}` (a door
// answer for the report's worker: from the door's worker over the port, or one the page made), and, from the report's
// worker to the page, unasked, `{type: 'status', reportKey, doorKey, doorVersion, answer, hidden, lost}` (the editor
// status panel's status of that report with that door answer, `doorKey` null for the report alone).

/**
 * The page's side of a faithful answer: puts back every non-enumerable own property the worker recorded (each
 * `{node, key, value, writable, configurable}`, `node` being an object INSIDE `value`, which the structured clone kept
 * as the same object), and returns the answer. A record that names no object is skipped.
 * @param {{value: any, hidden?: object[]}} faithful
 */
export function restoreFaithful(faithful) {
  const f = faithful && typeof faithful === 'object' ? faithful : { value: faithful }
  const hidden = Array.isArray(f.hidden) ? f.hidden : []
  for (const h of hidden) {
    if (!h || !h.node || typeof h.node !== 'object' || typeof h.key !== 'string') continue
    Object.defineProperty(h.node, h.key, {
      value: h.value, enumerable: false, writable: h.writable !== false, configurable: h.configurable !== false,
    })
  }
  // ⭐ the table is kept with the answer, so the answer can be handed on to another job as faithfully as it came
  // (`hiddenTableOf`): a structured clone of `{value, hidden}` keeps every `node` inside `value`, without a walk here
  if (hidden.length && f.value && typeof f.value === 'object') TABLES.set(f.value, hidden)
  return f.value
}

const TABLES = new WeakMap()
/** The non-enumerable properties an answer that crossed carried (`restoreFaithful`'s `hidden`), or null. */
export function hiddenTableOf(value) {
  return value && typeof value === 'object' ? (TABLES.get(value) || null) : null
}

// ─── THE COPY THAT CROSSES (the worker makes it; the page hands a door answer it made to the report worker with it) ───
const PASS_THROUGH = (v) => v instanceof Date || v instanceof RegExp || ArrayBuffer.isView(v) || v instanceof ArrayBuffer

/**
 * ⭐ THE DOOR'S ANSWER AS PLAIN DATA, the way it crosses to the page. A structured clone refuses a function and
 * keeps neither a class's prototype nor an error's own fields, and the answer's working object (`translation`,
 * which the editor's status panel reads) holds all three. So, before it is posted: every own ENUMERABLE field
 * whose value is not a function, at every depth; a Map and a Set as a Map and a Set; an error or any other
 * class instance as a plain object of its own enumerable fields (an error keeps its `name` and `message` too);
 * and ONE copy of an object reached twice, so `a === b` in the answer is `a === b` on the page (the status
 * panel finds a row's output by its tree's identity). Exactly what JSON and a structured clone agree an object
 * IS; the census proves the page reads the same document and the same status from it.
 */
export function plainAnswerOf(value, seen = new Map()) {
  return copyOf(value, seen, null)
}

/**
 * ⭐ THE ANSWER AS IT CROSSES, FAITHFULLY (`memberDoorProtocol.js`): `plainAnswerOf`'s copy, plus every NON-ENUMERABLE
 * own property of an object or array in it (`hidden`: the copy it belongs to, its key, its value copied the same way,
 * and its descriptor's `writable` / `configurable`), which the page puts back before anyone reads the answer
 * (`restoreFaithful`). `lost` counts what no clone can carry (a function or an accessor held non-enumerably, a symbol
 * key); a rail holds it at zero for what the door and PasteBox answer. An error is copied as `plainAnswerOf` copies it.
 * @returns {{value: any, hidden: object[], lost: number}}
 */
export function faithfulAnswerOf(value) {
  const acc = { hidden: [], lost: 0 }
  const out = copyOf(value, new Map(), acc)
  return { value: out, hidden: acc.hidden, lost: acc.lost }
}

function copyHidden(value, out, seen, acc) {
  if (!acc || value instanceof Error) return
  acc.lost += Object.getOwnPropertySymbols(value).length
  for (const k of Object.getOwnPropertyNames(value)) {
    if (Object.prototype.propertyIsEnumerable.call(value, k)) continue
    if (Array.isArray(value) && k === 'length') continue
    const d = Object.getOwnPropertyDescriptor(value, k)
    if (!d || !('value' in d) || typeof d.value === 'function') { acc.lost += 1; continue }
    acc.hidden.push({ node: out, key: k, value: copyOf(d.value, seen, acc), writable: d.writable, configurable: d.configurable })
  }
}

function copyOf(value, seen, acc) {
  if (value === null || typeof value !== 'object') return typeof value === 'function' ? undefined : value
  if (seen.has(value)) return seen.get(value)
  if (PASS_THROUGH(value)) return value
  if (Array.isArray(value)) {
    const out = []
    seen.set(value, out)
    for (let i = 0; i < value.length; i += 1) {
      const v = value[i]
      out.push(typeof v === 'function' ? undefined : copyOf(v, seen, acc))
    }
    copyHidden(value, out, seen, acc)
    return out
  }
  if (value instanceof Map) {
    const out = new Map()
    seen.set(value, out)
    for (const [k, v] of value) if (typeof v !== 'function' && typeof k !== 'function') out.set(copyOf(k, seen, acc), copyOf(v, seen, acc))
    return out
  }
  if (value instanceof Set) {
    const out = new Set()
    seen.set(value, out)
    for (const v of value) if (typeof v !== 'function') out.add(copyOf(v, seen, acc))
    return out
  }
  const out = {}
  seen.set(value, out)
  if (value instanceof Error) { out.name = value.name; out.message = value.message }
  for (const k of Object.keys(value)) {
    const v = value[k]
    if (typeof v === 'function') continue
    out[k] = copyOf(v, seen, acc)
  }
  copyHidden(value, out, seen, acc)
  return out
}
