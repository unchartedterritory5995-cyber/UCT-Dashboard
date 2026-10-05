// app/src/components/chart/builder/memberPane/knobReach.js
//
// ─── ⭐⭐ H10 — A KNOB REACHES EVERY USE OF ITS INPUT, OR IT IS NOT OFFERED ────
//
// A parameter knob (`compute.paramManifest`) is a set of LOCATORS: the literals
// `pine.js::resolveInput` tagged and that survived, tag intact, into a saved tree.
// `applyParamEdit` rewrites exactly those. Every use of the input whose literal
// did NOT survive keeps the author's default when the knob moves:
//   * a length folded with other numbers (`lb + rb + 1` -> `11`, `foldWindow`),
//   * a history offset (`high[lb]`, an `offset` node's number),
//   * a tree a later pass rebuilt without the non-enumerable tag,
//   * a drawing program (`objects`), which no locator addresses at all.
// Measured H10 (member door, 266 committed scripts): of 127 offered knobs, 79
// moved part of the formula or the drawings and left the rest at the default
// (`knobReach.measure.test.js`). pivot-high-low-points' `lb` is H9's example: the
// knob moved the `== -lb` comparator and the displacement, not `high[lb]` nor
// `highestbars(lb + rb + 1)`.
//
// ⭐ THE AUTHORITY IS THE TRANSLATOR ITSELF, NOT A LIST OF FOLD SITES. The same
// script translated with the member's value AS THE INPUT'S VALUE (`inputValues`,
// what a moved `input.*` is on TradingView) is what the indicator draws with that
// value. A knob whose literal edit does not reproduce that translation is not
// offered: it stays at the script's default, with a named reason. A list of the
// folds that drop a tag would be a second authority that rots the day a fold is
// added; this asks the one that decides.
//
// ⭐ COST: ONE extra translation per script with knobs. Every knob is moved at
// once, each to a value no other knob uses (`distinctProbes`), so a mismatched
// literal names its knob by its (default, probe) pair. Only a mismatch no pair
// explains (a folded number, a changed shape) falls back to one translation per
// knob still unproven.

/** A value a member could type that differs from the default and that the
 *  author's own bounds admit, or `null` when there is none. `skip` holds the
 *  `default:value` pairs already taken, so two knobs never share one. */
export function knobReachProbeValue(entry, skip = null) {
  if (!entry) return null
  const d = entry.default
  if (typeof d !== 'number' || !Number.isFinite(d)) return null
  const ok = (v) => (entry.min == null || v >= entry.min) && (entry.max == null || v <= entry.max)
    && (!Array.isArray(entry.options) || entry.options.includes(v))
  const free = (v) => !skip || !skip.has(`${d}:${v}`)
  if (entry.type === 'bool') {
    const v = d === 0 ? 1 : 0
    return free(v) ? v : null
  }
  const step = entry.type === 'int' ? 1
    : (typeof entry.step === 'number' && entry.step > 0 ? entry.step : 1)
  for (let m = 1; m <= 8; m += 1) {
    for (const v of [d + m * step, d - m * step]) {
      const r = entry.type === 'int' ? v : Number(v.toFixed(10))
      if (r !== d && ok(r) && free(r)) return r
    }
  }
  return null
}

/** One probe per parameter, no two sharing a `(default, probe)` pair. */
export function distinctProbes(params) {
  const taken = new Set()
  const out = new Map()
  for (const p of params) {
    // a pair already taken (two `bool`s) is still a probe: its mismatches name no
    // single knob, and `unreachedKnobs` then asks each knob on its own
    let v = knobReachProbeValue(p, taken)
    if (v === null) v = knobReachProbeValue(p)
    if (v === null) continue
    taken.add(`${p.default}:${v}`)
    out.set(p.id, v)
  }
  return out
}

/** The parts of a saved document that say WHAT IS DRAWN, without the knob
 *  roster (which names the edit, not its result). Used by the measurement. */
export function comparableDocument(definition) {
  if (!definition) return null
  const compute = { ...(definition.compute || {}) }
  delete compute.paramManifest
  // `fn` is `astHash` of the scan tree, which is compared itself; `applyParamEdit`
  // leaves it for the save door to restamp, so it names no drawn difference.
  delete compute.fn
  const meta = { ...(definition.meta || {}) }
  // prose written from the trees at build time; see `H10` in the triage doc
  delete meta.description
  delete meta.disclosures
  const out = { ...definition, compute, meta }
  if (out.objectsRun) out.objectsRun = { ...out.objectsRun, trees: null }
  return out
}

/** Why a knob is not offered — each the CLAUSE of `knobLockedNote`'s sentence. */
export const REACH = Object.freeze({
  fold: 'it also sets a length or a history offset the formula folded into a number, which a new value here cannot move',
  colour: 'it also sets a colour rule, which a new value here cannot move',
  drawings: 'it also sets its drawings (lines, labels, boxes, tables), which a new value here cannot move',
  noProbe: 'no other value its own bounds allow could be checked',
  sameName: 'another input is bound to the same name',
  unbuilt: 'the script could not be built at another value to check it',
})

const isObj = (v) => v !== null && typeof v === 'object'

/** `node` with every literal a moved parameter tagged rewritten to its probe —
 *  exactly what `applyParamEdit` writes at the locators `collectParamLocators`
 *  finds (a tagged `offset` node's number is its `value`). */
function withEdits(node, moved) {
  if (Array.isArray(node)) return node.map((n) => withEdits(n, moved))
  if (!isObj(node)) return node
  const out = {}
  for (const k of Object.keys(node)) out[k] = withEdits(node[k], moved)
  const id = node.__uctParamId
  if (id !== undefined && moved.has(id) && (node.type === 'num' || node.type === 'offset')) {
    out.value = moved.get(id)
  }
  return out
}

/** Every literal at which `a` and `b` differ; `shape` when they differ any other way. */
function leafDiffs(a, b, out) {
  if (out.shape) return out
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Object.is(a, b) && !(Number.isNaN(a) && Number.isNaN(b))) out.nums.push([a, b])
    return out
  }
  if (Array.isArray(a) !== Array.isArray(b) || isObj(a) !== isObj(b)) { out.shape = true; return out }
  if (Array.isArray(a)) {
    if (a.length !== b.length) { out.shape = true; return out }
    for (let i = 0; i < a.length; i += 1) leafDiffs(a[i], b[i], out)
    return out
  }
  if (isObj(a)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length || ka.some((k) => !Object.prototype.hasOwnProperty.call(b, k))) {
      out.shape = true
      return out
    }
    for (const k of ka) leafDiffs(a[k], b[k], out)
    return out
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a !== b) (out.strs || (out.strs = [])).push([a, b])
    return out
  }
  if (a !== b) out.shape = true
  return out
}

/** Does moving ONE knob's number explain this text difference (a label's
 *  `"14 bars"` that reads `"15 bars"` at the probe)? */
const textNamesPair = (a, b, d, v) => a.includes(String(d)) && a.split(String(d)).join(String(v)) === b

/** What a translation DRAWS, per output, with the parameter edits applied where
 *  an edit can reach (the output trees and a tracked displacement) and nowhere
 *  else (the drawing program). */
function drawn(t, moved, counts) {
  const rows = (t.outputs || []).map((o, i) => {
    if (!o || !counts(i)) return null
    let displace = Number.isInteger(o.displace) ? o.displace : 0
    const f = o._displaceFrom
    if (moved && f && moved.has(f.param)) displace = f.scale * moved.get(f.param) + f.add
    return {
      refused: !!o.refusal,
      ast: o.ast ? (moved ? withEdits(o.ast, moved) : o.ast) : null,
      displace,
    }
  })
  // ⛔ THE COLOUR CONDITIONS TOO (a plot's, a fill's, a paint's `ast`): each is
  // a derived column no locator addresses, so an edit never moves it either.
  const conditions = []
  ;(t.outputs || []).forEach((o, i) => { if (o && counts(i)) astsUnder(o.presentation, conditions) })
  astsUnder(t.presentation, conditions)
  return { rows, conditions }
}

/** Every tree held under an `ast` key inside `node`, in walk order. */
function astsUnder(node, out, depth = 0) {
  if (!isObj(node) || depth > 12) return out
  if (Array.isArray(node)) { node.forEach((n) => astsUnder(n, out, depth + 1)); return out }
  for (const k of Object.keys(node)) {
    if (k === 'ast' && isObj(node[k])) out.push(node[k])
    else astsUnder(node[k], out, depth + 1)
  }
  return out
}

/**
 * The parameters of `translation` whose knob would NOT reproduce what the
 * script draws at the knob's new value — each with the place it misses.
 *
 * @param {object} arg
 * @param {Function} arg.retranslate `(inputValues) => translation` — the SAME
 *        translation the caller made, with these input values. A throw or a
 *        refusal is "cannot verify".
 * @param {object} arg.translation the caller's translation (`inputParams` +
 *        tagged output trees).
 * @param {Set<string>} [arg.offered] the parameter ids the caller would offer
 *        (default: every `inputParams` id).
 * @param {(index: number) => boolean} [arg.drawsOutput] which outputs (by index
 *        in `translation.outputs`) the caller's document draws; an output it does
 *        not draw cannot show a missed use (default: all).
 * @param {boolean} [arg.drawsObjects] whether the document carries the drawing
 *        program (default: true).
 * @returns {Map<string, string>} id -> where the knob misses
 */
export function unreachedKnobs({
  retranslate, translation, offered = null, drawsOutput = null, drawsObjects = true,
}) {
  const counts = typeof drawsOutput === 'function' ? drawsOutput : () => true
  const locked = new Map()
  const params = ((translation && translation.inputParams) || [])
    .filter((p) => p && (!offered || offered.has(p.id)))
  if (!params.length) return locked
  const byName = new Map()
  for (const p of params) byName.set(p.sourceName, (byName.get(p.sourceName) || 0) + 1)
  const probes = distinctProbes(params)
  for (const p of params) {
    if (!probes.has(p.id)) locked.set(p.id, REACH.noProbe)
    else if (byName.get(p.sourceName) > 1) locked.set(p.id, REACH.sameName)
  }
  const candidates = params.filter((p) => !locked.has(p.id))
  if (!candidates.length) return locked

  // `null`: the probe could not be built or could not be compared by literal;
  // otherwise the ids each mismatched literal names (by its pair), and whether
  // some mismatch named none.
  const check = (moving) => {
    const values = {}
    const moved = new Map()
    for (const p of moving) {
      values[p.sourceName] = probes.get(p.id)
      moved.set(p.id, probes.get(p.id))
    }
    let t2 = null
    try { t2 = retranslate(values) } catch { t2 = null }
    if (!t2 || !Array.isArray(t2.outputs)) return null
    const a = drawn(translation, moved, counts)
    const b = drawn(t2, null, counts)
    const diff = { nums: [], shape: false }
    leafDiffs(a.rows.map((r) => r && r.refused), b.rows.map((r) => r && r.refused), diff)
    if (diff.shape || diff.nums.length) return null
    // ⛔ THE DRAWING PROGRAM HAS NO LOCATORS: an edit never moves it, so it is
    // compared as the caller's translation holds it.
    const objDiff = drawsObjects
      ? leafDiffs(translation.objects || null, t2.objects || null, { nums: [], shape: false })
      : { nums: [], shape: false }
    const astDiff = { nums: [], shape: false }
    a.rows.forEach((r, i) => {
      if (!r || !r.ast) return
      leafDiffs(r.ast, b.rows[i] && b.rows[i].ast, astDiff)
      leafDiffs(r.displace, b.rows[i] && b.rows[i].displace, astDiff)
    })
    const condDiff = leafDiffs(a.conditions, b.conditions, { nums: [], shape: false })
    // ⭐ A SECTION THAT CHANGED SHAPE NAMES NO KNOB (its literals may not line up),
    // but the others still do: only the knobs none of them names are asked alone.
    const hits = new Map()
    let loose = objDiff.shape || astDiff.shape || condDiff.shape
    const shapeWhere = astDiff.shape ? REACH.fold : condDiff.shape ? REACH.colour
      : objDiff.shape ? REACH.drawings : null
    if (astDiff.shape) astDiff.nums = []
    if (condDiff.shape) condDiff.nums = []
    if (objDiff.shape) objDiff.nums = []
    for (const d of [astDiff, condDiff, objDiff]) if (d.shape) d.strs = []
    const name = (pair, where) => {
      const owners = moving.filter((p) => p.default === pair[0] && probes.get(p.id) === pair[1])
      if (owners.length !== 1) { loose = true; return }
      if (!hits.has(owners[0].id)) hits.set(owners[0].id, where)
    }
    for (const pair of astDiff.nums) name(pair, REACH.fold)
    for (const pair of condDiff.nums) name(pair, REACH.colour)
    for (const [x, y] of [...(astDiff.strs || []), ...(condDiff.strs || []), ...(objDiff.strs || [])]) {
      const owners = moving.filter((p) => textNamesPair(x, y, p.default, probes.get(p.id)))
      if (owners.length !== 1) { loose = true; continue }
      if (!hits.has(owners[0].id)) {
        hits.set(owners[0].id, (objDiff.strs || []).some((q) => q[0] === x && q[1] === y) ? REACH.drawings
          : (condDiff.strs || []).some((q) => q[0] === x && q[1] === y) ? REACH.colour : REACH.fold)
      }
    }
    for (const pair of objDiff.nums) name(pair, REACH.drawings)
    return { shape: false, hits, loose, shapeWhere }
  }

  const all = check(candidates)
  if (all && !all.loose) {
    for (const [id, where] of all.hits) locked.set(id, where)
    return locked
  }
  if (all) for (const [id, where] of all.hits) locked.set(id, where)
  for (const p of candidates) {
    if (locked.has(p.id)) continue
    const one = check([p])
    if (!one) locked.set(p.id, REACH.unbuilt)
    else if (one.shape || one.loose || one.hits.size) {
      locked.set(p.id, one.hits.get(p.id) || one.shapeWhere || REACH.fold)
    }
  }
  return locked
}

/** The member-facing sentence for one locked knob. */
export function knobLockedNote(param, why) {
  const name = (param && (param.title || param.sourceName)) || 'this setting'
  return {
    name,
    note: `\`${name}\` is not offered as an adjustable setting here: ${why}. It stays at the `
      + `script's value (${param && param.default}), which is what TradingView draws until it is `
      + 'changed. Change it in the script and paste it again.',
  }
}
