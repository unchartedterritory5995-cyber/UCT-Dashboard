// app/src/components/chart/engine/runtime/objectStore.js
//
// ─── ⭐⭐ RT5 — THE RUNTIME LANE'S OWN DRAWINGS ────────────────────────────────
//
// Until RT5 the per-bar lane drew nothing: `handles.js` gave it an OPAQUE handle
// for a drawing the HOST object program owned, and a script whose only output is
// drawings ended at `runtime:nothing-drawn`. O1 measured why that ceiling holds
// 39 corpus scripts: their drawings live in collections, UDTs, methods, loop
// values and a function's own state — exactly what a per-bar VM executes and a
// columnar translator cannot.
//
// So this store is what `line.new` / `label.new` / `box.new` / `table.new` /
// `linefill.new` DO when the VM runs them, bar by bar, in source order: it mints
// an object, holds its properties, answers its getters, and at the end hands back
// the LIVE set in the same shape `objectRuntime.finish().live` has always had —
// `{family, id, site, createdBar, props, cells?}` — so `objectRenderState
// .toRenderState` draws it unchanged. ONE renderer, two producers.
//
// ⛔⛔ THE MEASURED RULES ARE IMPORTED, NEVER RESTATED. Pine's capacity table and
// the batched collector (`objectPool.POOL_LIMITS`, `resolveCapacity`,
// `collectsAbove`, C7 — measured id for id on eight captures) and the
// transparent colour of `na` are the host lane's, by import. Where the host lane
// has a MEASURED rule this store follows it; where it has none this store
// WITHHOLDS by name (`withhold`) instead of inventing one.
//
// ⛔ A WITHHELD FAMILY IS NOT DRAWN AT ALL, and the reason rides out with the run.
// Correctness over coverage: a drawing that may be wrong is worse than none.
import { POOL_LIMITS, resolveCapacity, collectsAbove } from '../objectPool.js'
import { packedToObjectHex } from './colours.js'
import { objectHandle, isDrawingHandle } from './handles.js'

/** Pine's absent colour (`color = na`): fully transparent — the host lane's
 *  `NA_OBJECT_COLOUR` (`pine.js`). */
const NA_COLOUR = '#00000000'

/** The families this store mints. ⛔ `polyline` is NOT one: the chart's render
 *  state has no polyline, so a `polyline.new` is refused at the front end by name
 *  (`OBJECT_REFUSED`) rather than drawn as nothing. */
export const RUN_FAMILIES = Object.freeze(['line', 'label', 'box', 'table', 'linefill'])

// ── THE SIGNATURES ───────────────────────────────────────────────────────────
//
// Pine v5/v6 parameter order, per call. ⭐ The front end maps named and
// positional arguments to these positions ONCE, at build time; the VM hands the
// store a positional array with `undefined` where the script passed nothing (the
// default applies) — which is a different fact from `na` (NaN), passed.
//
// ⚠️ `table.cell`'s order is the vendor's: `text_size` comes BEFORE `bgcolor`.
// (`pineObjects.js::CELL_POSITIONAL` lists `bgcolor, tooltip, text_size` after
// `text_valign`; that host table is not this lane's to change, and a positional
// call reaching both lanes with ten or more arguments is the case it decides.)
const LINE_NEW = ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width', 'force_overlay']
const LABEL_NEW = ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign',
  'tooltip', 'text_font_family', 'force_overlay', 'text_formatting']
const BOX_NEW = ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style',
  'extend', 'xloc', 'bgcolor', 'text', 'text_size', 'text_color', 'text_halign', 'text_valign',
  'text_wrap', 'text_font_family', 'force_overlay', 'text_formatting']
const TABLE_NEW = ['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width',
  'border_color', 'border_width', 'force_overlay']
const CELL_ARGS = ['table_id', 'column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign',
  'text_valign', 'text_size', 'bgcolor', 'tooltip', 'text_font_family', 'text_formatting']
const RECT_ARGS = ['table_id', 'start_column', 'start_row', 'end_column', 'end_row']

/** What KIND of value each property is — the one place a raw VM value becomes a
 *  drawing property. */
const PROP_KIND = Object.freeze({
  x1: 'x', x2: 'x', x: 'x', left: 'x', right: 'x',
  y1: 'y', y2: 'y', y: 'y', top: 'y', bottom: 'y',
  color: 'colour', textcolor: 'colour', border_color: 'colour', bgcolor: 'colour', text_color: 'colour',
  frame_color: 'colour',
  width: 'num', border_width: 'num', frame_width: 'num', height: 'num', columns: 'num', rows: 'num',
  text: 'text', tooltip: 'text',
  xloc: 'enum', yloc: 'enum', extend: 'enum', style: 'enum', border_style: 'enum', size: 'enum',
  textalign: 'enum', text_size: 'enum', text_halign: 'enum', text_valign: 'enum', text_wrap: 'enum',
  text_font_family: 'enum', text_formatting: 'enum', position: 'enum',
  force_overlay: 'bool',
  line1: 'ref', line2: 'ref',
})

/** Properties the chart cannot draw a NON-DEFAULT value of. A script that sets
 *  one is drawn, and the property is NAMED in the run's disclosures — the host
 *  lane's own treatment of a property its vocabulary does not hold. */
const UNDRAWN_PROPS = Object.freeze({
  text_font_family: 'default', text_halign: 'center', text_valign: 'center', text_wrap: 'none',
  text_formatting: 'none',
})

/** The setter table — a setter name → the properties it writes, in argument
 *  order after the handle. ⭐ Built per family from Pine's reference. */
const SETTERS = Object.freeze({
  line: {
    set_x1: ['x1'], set_y1: ['y1'], set_x2: ['x2'], set_y2: ['y2'],
    set_xy1: ['x1', 'y1'], set_xy2: ['x2', 'y2'], set_xloc: ['x1', 'x2', 'xloc'],
    set_color: ['color'], set_width: ['width'], set_style: ['style'], set_extend: ['extend'],
  },
  label: {
    set_x: ['x'], set_y: ['y'], set_xy: ['x', 'y'], set_xloc: ['x', 'xloc'], set_text: ['text'],
    set_color: ['color'], set_textcolor: ['textcolor'], set_style: ['style'], set_size: ['size'],
    set_textalign: ['textalign'], set_tooltip: ['tooltip'], set_yloc: ['yloc'],
    set_text_font_family: ['text_font_family'], set_text_formatting: ['text_formatting'],
  },
  box: {
    set_left: ['left'], set_top: ['top'], set_right: ['right'], set_bottom: ['bottom'],
    set_lefttop: ['left', 'top'], set_rightbottom: ['right', 'bottom'],
    set_xloc: ['left', 'right', 'xloc'],
    set_bgcolor: ['bgcolor'], set_border_color: ['border_color'], set_border_width: ['border_width'],
    set_border_style: ['border_style'], set_extend: ['extend'], set_text: ['text'],
    set_text_color: ['text_color'], set_text_size: ['text_size'], set_text_halign: ['text_halign'],
    set_text_valign: ['text_valign'], set_text_wrap: ['text_wrap'],
    set_text_font_family: ['text_font_family'], set_text_formatting: ['text_formatting'],
  },
  table: {
    set_position: ['position'], set_bgcolor: ['bgcolor'], set_frame_color: ['frame_color'],
    set_frame_width: ['frame_width'], set_border_color: ['border_color'],
    set_border_width: ['border_width'],
  },
  linefill: { set_color: ['color'] },
})

/** `table.cell_set_<prop>` → the cell property it writes. */
const CELL_SETTERS = Object.freeze({
  cell_set_text: 'text', cell_set_text_color: 'text_color', cell_set_bgcolor: 'bgcolor',
  cell_set_text_size: 'text_size', cell_set_text_halign: 'text_halign',
  cell_set_text_valign: 'text_valign', cell_set_text_formatting: 'text_formatting',
  cell_set_tooltip: 'tooltip', cell_set_width: 'width', cell_set_height: 'height',
  cell_set_text_font_family: 'text_font_family',
})

/** Getters — what each answers, from the object's own properties. */
const GETTERS = Object.freeze({
  line: { get_x1: 'x1', get_y1: 'y1', get_x2: 'x2', get_y2: 'y2' },
  label: { get_x: 'x', get_y: 'y', get_text: 'text' },
  box: { get_left: 'left', get_top: 'top', get_right: 'right', get_bottom: 'bottom' },
  linefill: { get_line1: 'line1', get_line2: 'line2' },
})

/**
 * ⭐⭐ THE OP TABLE — every call this store executes, by its canonical name.
 *
 * `kind`: create | set | get | price | delete | copy | all | cell | cellset |
 * clear | merge. `params`: the canonical argument order the front end maps named
 * arguments onto. `returns`: 'handle' | 'number' | 'string' | 'array' | 'void'.
 *
 * ⛔ A METHOD WHOSE FAMILY THE FRONT END CANNOT NAME (`x.delete()` on a value it
 * did not type) is lowered as `any.<method>` and dispatched here on the HANDLE's
 * family — `anyOp` below — and refused at run time if that family has no such
 * method.
 */
function buildOps() {
  const ops = {}
  const add = (name, spec) => { ops[name] = Object.freeze({ ...spec, params: Object.freeze(spec.params) }) }
  add('line.new', { family: 'line', kind: 'create', params: LINE_NEW, returns: 'handle' })
  add('label.new', { family: 'label', kind: 'create', params: LABEL_NEW, returns: 'handle' })
  add('box.new', { family: 'box', kind: 'create', params: BOX_NEW, returns: 'handle' })
  add('table.new', { family: 'table', kind: 'create', params: TABLE_NEW, returns: 'handle' })
  add('linefill.new', { family: 'linefill', kind: 'create', params: ['line1', 'line2', 'color'], returns: 'handle' })
  for (const fam of RUN_FAMILIES) {
    add(`${fam}.delete`, { family: fam, kind: 'delete', params: ['id'], returns: 'void' })
    add(`${fam}.all`, { family: fam, kind: 'all', params: [], returns: 'array' })
    for (const [m, props] of Object.entries(SETTERS[fam] || {})) {
      add(`${fam}.${m}`, { family: fam, kind: 'set', params: ['id', ...props], props, returns: 'void' })
    }
    for (const [m, prop] of Object.entries(GETTERS[fam] || {})) {
      add(`${fam}.${m}`, {
        family: fam,
        kind: 'get',
        params: ['id'],
        prop,
        returns: prop === 'text' ? 'string' : (prop === 'line1' || prop === 'line2') ? 'handle' : 'number',
      })
    }
  }
  for (const fam of ['line', 'label', 'box']) {
    add(`${fam}.copy`, { family: fam, kind: 'copy', params: ['id'], returns: 'handle' })
  }
  add('line.get_price', { family: 'line', kind: 'price', params: ['id', 'x'], returns: 'number' })
  add('table.cell', { family: 'table', kind: 'cell', params: CELL_ARGS, returns: 'void' })
  for (const [m, prop] of Object.entries(CELL_SETTERS)) {
    add(`table.${m}`, { family: 'table', kind: 'cellset', params: ['table_id', 'column', 'row', prop], prop, returns: 'void' })
  }
  add('table.clear', { family: 'table', kind: 'clear', params: RECT_ARGS, returns: 'void' })
  add('table.merge_cells', { family: 'table', kind: 'merge', params: RECT_ARGS, returns: 'void' })
  return Object.freeze(ops)
}
export const OBJECT_OPS = buildOps()

/** The method names a receiver of an UNKNOWN family may call, with the families
 *  that define each — the run-time dispatch table for `any.<method>`. */
export const ANY_METHODS = Object.freeze((() => {
  const out = {}
  for (const name of Object.keys(OBJECT_OPS)) {
    const dot = name.indexOf('.')
    const fam = name.slice(0, dot)
    const m = name.slice(dot + 1)
    if (m === 'new' || m === 'all') continue
    const spec = OBJECT_OPS[name]
    // A method callable on a receiver: its first parameter is the object itself.
    if (spec.params[0] !== 'id' && spec.params[0] !== 'table_id') continue
    ;(out[m] = out[m] || []).push(fam)
  }
  return out
})())

/** The canonical spec for `any.<method>` given the receiver's family, or null. */
export function opFor(name, family) {
  if (Object.hasOwn(OBJECT_OPS, name)) return OBJECT_OPS[name]
  if (name.startsWith('any.') && family) {
    const real = `${family}.${name.slice(4)}`
    return Object.hasOwn(OBJECT_OPS, real) ? OBJECT_OPS[real] : null
  }
  return null
}

/** The parameter list the front end maps named arguments onto for `any.<m>`:
 *  only answerable when every family defining `m` agrees on it. */
export function paramsOfAny(method) {
  const fams = ANY_METHODS[method] || []
  let params = null
  for (const f of fams) {
    const p = OBJECT_OPS[`${f}.${method}`].params
    const norm = p.map((x) => (x === 'table_id' ? 'id' : x))
    if (params === null) params = norm
    else if (params.length !== norm.length || params.some((x, i) => x !== norm[i])) return null
  }
  return params
}

/** The declared `max_*_count` of a source — comments and strings stripped first,
 *  the host lane's own scan (`pine.js`, `strippedForScan`), passed in by the
 *  caller so this module needs no parser. */
export function declaredCapsOf(stripped) {
  const caps = {}
  for (const m of String(stripped || '').matchAll(/max_([a-z]+)_count\s*=\s*(\d+)/g)) {
    const fam = { lines: 'line', labels: 'label', boxes: 'box', polylines: 'polyline' }[m[1]]
    if (fam) caps[fam] = Number(m[2])
  }
  return caps
}

/** The declared `calc_bars_count` of a source (same stripped scan), or null. */
export function declaredCalcBarsOf(stripped) {
  const m = /calc_bars_count\s*=\s*(\d+)/.exec(String(stripped || ''))
  return m ? Number(m[1]) : null
}

export class ObjectRunError extends Error {
  constructor(message) { super(message); this.name = 'ObjectRunError' }
}

const isNum = (v) => typeof v === 'number'
const isNa = (v) => v === undefined || (typeof v === 'number' && Number.isNaN(v))

/**
 * One run's drawings.
 *
 * @param {object} o
 * @param {number} [o.pineVersion]  the script's `//@version` (capacity table)
 * @param {Record<string,number>} [o.caps]  declared `max_*_count`s (`declaredCapsOf`)
 * @param {number} [o.tableCap]     house envelope for tables (no Pine rule)
 * @param {number} [o.fillCap]      house envelope for linefills (no Pine rule)
 */
export function makeObjectStore({ pineVersion = 6, caps = {}, tableCap = 40, fillCap = 500 } = {}) {
  const limits = {}
  for (const fam of Object.keys(POOL_LIMITS)) {
    if (pineVersion < POOL_LIMITS[fam].since) continue
    limits[fam] = resolveCapacity(fam, caps[fam] === undefined ? null : caps[fam], pineVersion).capacity
  }
  /** id → instance. ⭐ Insertion order IS creation order (ids are a counter). */
  const live = new Map()
  /** handle object → id, and id → handle, so a handle is one identity for life. */
  const handles = new Map()
  const counts = { line: 0, label: 0, box: 0, table: 0, linefill: 0 }
  let nextId = 1
  /** family → reason it is withheld (not drawn) */
  const withheldFams = new Map()
  /** A run-stopping reason (every family withheld): Pine's own runtime error, or
   *  a step whose answer no capture settles. */
  let stopped = null
  const undrawn = new Map()   // prop → count of objects carrying a non-default value
  const stats = { created: 0, updated: 0, deleted: 0, collected: 0, writesToDead: 0, replaced: 0 }
  /** line id → set of fill ids that span it */
  const fillsOfLine = new Map()
  /** ids of objects that WERE live and are not any more (deleted or collected) */
  const dead = new Set()

  const withhold = (fam, why) => { if (!withheldFams.has(fam)) withheldFams.set(fam, why) }
  const stop = (why) => { if (!stopped) stopped = why }

  const idOf = (h) => (isDrawingHandle(h) && Number.isInteger(h.id) ? h.id : null)
  const instOf = (h) => {
    const id = idOf(h)
    return id === null ? null : (live.get(id) || null)
  }

  function reap(inst) {
    live.delete(inst.id)
    dead.add(inst.id)
    counts[inst.family] -= 1
    if (inst.family === 'linefill') {
      for (const ref of [inst.props.line1, inst.props.line2]) {
        const lid = idOf(ref)
        const set = lid === null ? null : fillsOfLine.get(lid)
        if (set) set.delete(inst.id)
      }
      return
    }
    const fills = fillsOfLine.get(inst.id)
    if (!fills) return
    fillsOfLine.delete(inst.id)
    for (const fid of [...fills]) {
      const f = live.get(fid)
      if (f) reap(f)
    }
  }

  // ── property values ───────────────────────────────────────────────────────
  /** A raw VM value → the property's drawing value, or throws by name. */
  function propValue(name, prop, raw) {
    const kind = PROP_KIND[prop]
    switch (kind) {
      case 'x': {
        if (isNa(raw)) return NaN
        if (!isNum(raw)) throw new ObjectRunError(`\`${name}\`: \`${prop}\` takes a number`)
        // ⭐ C48 — a bar coordinate is a whole number, its fraction dropped toward
        // zero (`vw-int-array-avg-neg`), the host lane's `resolveProps` rule.
        return Number.isFinite(raw) && !Number.isInteger(raw) ? Math.trunc(raw) + 0 : raw
      }
      case 'y': case 'num': {
        if (isNa(raw)) return NaN
        if (!isNum(raw)) throw new ObjectRunError(`\`${name}\`: \`${prop}\` takes a number`)
        return raw
      }
      case 'colour': {
        if (isNa(raw)) return NA_COLOUR
        if (!isNum(raw)) throw new ObjectRunError(`\`${name}\`: \`${prop}\` takes a colour`)
        const hex = packedToObjectHex(raw)
        if (hex === null) throw new ObjectRunError(`\`${name}\`: \`${prop}\` is not a colour this engine reads`)
        return hex
      }
      case 'text': {
        if (isNa(raw)) return ''
        if (typeof raw === 'string') return raw
        throw new ObjectRunError(`\`${name}\`: \`${prop}\` takes text`)
      }
      case 'enum': {
        if (isNa(raw)) return undefined
        if (typeof raw !== 'string') throw new ObjectRunError(`\`${name}\`: \`${prop}\` takes a constant`)
        return raw.replace(/^(position|xloc|yloc|extend|size|text)\./, '')
      }
      case 'bool': return undefined
      case 'ref': return raw
      default:
        throw new ObjectRunError(`\`${name}\`: no property \`${prop}\``)
    }
  }

  function noteUndrawn(prop, value) {
    if (!Object.hasOwn(UNDRAWN_PROPS, prop) || value === undefined) return
    if (value === UNDRAWN_PROPS[prop]) return
    undrawn.set(prop, (undrawn.get(prop) || 0) + 1)
  }

  /** Apply `props` (canonical names) with `values` onto `out`. */
  function assign(name, out, props, values) {
    for (let i = 0; i < props.length; i += 1) {
      const prop = props[i]
      if (values[i] === undefined) continue      // not passed — the default stands
      if (prop === 'force_overlay') continue
      const v = propValue(name, prop, values[i])
      if (v === undefined) { delete out[prop]; continue }
      out[prop] = v
      noteUndrawn(prop, v)
    }
    return out
  }

  /** ⭐⭐ C7 — Pine's batched collector, the host lane's measured rule:
   *  a create that takes a family past `cap + 5` deletes the OLDEST until `cap`
   *  remain, sparing objects made on the running bar and objects a drawing
   *  VARIABLE holds right now. ⛔ An object held only in an ARRAY or a UDT FIELD
   *  is the case no capture separates (C7: "one held only in an array is
   *  unmeasured"): when the collector would reach one, the family is WITHHELD. */
  function collect(fam, bar, heldNow) {
    const cap = limits[fam]
    if (!Number.isFinite(cap) || counts[fam] <= collectsAbove(cap)) return
    const held = heldNow()
    for (const inst of [...live.values()]) {
      if (counts[fam] <= cap) break
      if (inst.family !== fam || inst.createdBar === bar || held.vars.has(inst.id)) continue
      if (held.containers.has(inst.id)) {
        withhold(fam, `TradingView's collector deletes the oldest ${fam}s past ${cap + 5}; one it reaches `
          + 'here is held in an array or a user type, and no capture shows whether such an object is spared')
      }
      reap(inst)
      stats.collected += 1
    }
  }

  function tablePos(props) {
    const p = props && props.position
    return typeof p === 'string' && p ? p : null
  }

  function create(name, spec, args, bar, heldNow) {
    const fam = spec.family
    if (fam === 'linefill') {
      const a = instOf(args[0])
      const b = instOf(args[1])
      if (!a || !b || a.family !== 'line' || b.family !== 'line' || a.id === b.id) return NaN
      // ⭐ one fill per pair of lines (Pine's manual; measured on liquidity-pools)
      for (const fid of [...(fillsOfLine.get(a.id) || [])]) {
        const f = live.get(fid)
        if (!f) continue
        const ids = [idOf(f.props.line1), idOf(f.props.line2)]
        if ((ids[0] === a.id && ids[1] === b.id) || (ids[0] === b.id && ids[1] === a.id)) {
          reap(f)
          stats.replaced += 1
        }
      }
      if (counts.linefill >= fillCap) {
        withhold('linefill', `more than ${fillCap} live linefills; Pine publishes no rule for which one goes`)
      }
    }
    const props = assign(name, {}, spec.params, args)
    if (fam === 'table') {
      const pos = tablePos(props)
      if (!pos) {
        withhold('table', 'a table was made at a position this run could not read')
      } else {
        // ⭐ one table per position, the newest wins (measured, `objectRuntime`'s
        // `replaceTableAt`: heat-map-seasons, ict-ipda-look-back, artemis).
        for (const inst of [...live.values()]) {
          if (inst.family === 'table' && tablePos(inst.props) === pos) { reap(inst); stats.replaced += 1; break }
        }
      }
      if (counts.table >= tableCap) withhold('table', `more than ${tableCap} live tables`)
    }
    const id = nextId
    nextId += 1
    const handle = objectHandle(fam, id)
    const inst = { family: fam, id, createdBar: bar, props, handle }
    if (fam === 'table') inst.cells = new Map()
    live.set(id, inst)
    handles.set(id, handle)
    counts[fam] += 1
    stats.created += 1
    if (fam === 'linefill') {
      for (const ref of [props.line1, props.line2]) {
        const lid = idOf(ref)
        if (!fillsOfLine.has(lid)) fillsOfLine.set(lid, new Set())
        fillsOfLine.get(lid).add(id)
      }
    }
    if (Object.hasOwn(limits, fam)) collect(fam, bar, heldNow)
    return handle
  }

  function cellAddr(name, inst, col, row) {
    if (!isNum(col) || !isNum(row) || !Number.isInteger(col) || !Number.isInteger(row)) return null
    const cols = inst.props.columns
    const rows = inst.props.rows
    if (col < 0 || row < 0 || (isNum(cols) && col >= cols) || (isNum(rows) && row >= rows)) {
      // ⛔ Pine stops the script on a cell outside the table; which drawings it
      // then shows is not captured, so the run stops by name (nothing drawn).
      stop(`\`${name}\` addresses cell (${col}, ${row}) outside a ${cols} x ${rows} table`)
      return null
    }
    return `${col},${row}`
  }

  /**
   * Execute one call. `args` is positional on `spec.params` (undefined = not
   * passed). Returns the call's value (a handle, a number, text, an array, or
   * `undefined` for a void call).
   */
  function call(name, args, bar, heldNow) {
    let spec = OBJECT_OPS[name] || null
    if (!spec && name.startsWith('any.')) {
      const recv = args[0]
      const fam = isDrawingHandle(recv) ? recv.family : null
      if (fam === null) {
        // `na` receiver: a setter / delete is a no-op, a getter answers na.
        if (isNa(recv)) {
          const m = name.slice(4)
          if (/^get_/.test(m)) return m === 'get_text' ? '' : NaN
          stats.writesToDead += 1
          return undefined
        }
        throw new ObjectRunError(`\`${name.slice(4)}\` was called on a value that is not a drawing`)
      }
      spec = opFor(name, fam)
      if (!spec) throw new ObjectRunError(`a ${fam} has no method \`${name.slice(4)}\``)
    }
    if (!spec) throw new ObjectRunError(`no drawing operation \`${name}\``)
    switch (spec.kind) {
      case 'create': return create(name, spec, args, bar, heldNow)
      case 'all': {
        const out = []
        for (const inst of live.values()) if (inst.family === spec.family) out.push(inst.handle)
        return out
      }
      case 'delete': {
        const inst = instOf(args[0])
        if (!inst) { if (!isNa(args[0]) && !isDrawingHandle(args[0])) throw new ObjectRunError(`\`${name}\` takes a drawing`); stats.writesToDead += 1; return undefined }
        if (inst.family !== spec.family) throw new ObjectRunError(`\`${name}\` was handed a ${inst.family}`)
        reap(inst)
        stats.deleted += 1
        return undefined
      }
      case 'copy': {
        const inst = instOf(args[0])
        if (!inst) return NaN
        const values = spec.family === 'line' ? LINE_NEW : spec.family === 'label' ? LABEL_NEW : BOX_NEW
        const fresh = create(`${spec.family}.new`, OBJECT_OPS[`${spec.family}.new`],
          values.map(() => undefined), bar, heldNow)
        live.get(fresh.id).props = { ...inst.props }
        return fresh
      }
      case 'set': {
        const inst = instOf(args[0])
        if (!inst) { stats.writesToDead += 1; return undefined }
        if (inst.family !== spec.family) throw new ObjectRunError(`\`${name}\` was handed a ${inst.family}`)
        assign(name, inst.props, spec.props, args.slice(1))
        stats.updated += 1
        return undefined
      }
      case 'get': {
        const inst = instOf(args[0])
        if (!inst) return spec.returns === 'string' ? '' : NaN
        const v = inst.props[spec.prop]
        if (spec.returns === 'handle') return v === undefined ? NaN : v
        if (spec.returns === 'string') return typeof v === 'string' ? v : ''
        return isNum(v) ? v : NaN
      }
      case 'price': {
        const inst = instOf(args[0])
        if (!inst) return NaN
        const { x1, y1, x2, y2 } = inst.props
        const x = args[1]
        if (![x1, y1, x2, y2, x].every((v) => isNum(v) && Number.isFinite(v))) return NaN
        if (x1 === x2) {
          stop('`line.get_price` of a vertical line: what TradingView answers is not captured')
          return NaN
        }
        return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1)
      }
      case 'cell': case 'cellset': {
        const inst = instOf(args[0])
        if (!inst) { stats.writesToDead += 1; return undefined }
        if (inst.family !== 'table') throw new ObjectRunError(`\`${name}\` was handed a ${inst.family}`)
        const key = cellAddr(name, inst, args[1], args[2])
        if (key === null) return undefined
        if (spec.kind === 'cell') {
          // ⭐ a whole `table.cell` REPLACES the cell (unpassed properties take
          // their defaults again); a `cell_set_*` patches one property.
          inst.cells.set(key, assign(name, {}, spec.params.slice(3), args.slice(3)))
        } else {
          const cur = inst.cells.get(key) || {}
          inst.cells.set(key, assign(name, cur, [spec.prop], [args[3]]))
        }
        stats.updated += 1
        return undefined
      }
      case 'clear': case 'merge': {
        const inst = instOf(args[0])
        if (!inst) { stats.writesToDead += 1; return undefined }
        const c0 = args[1]
        const r0 = args[2]
        const c1 = args[3] === undefined ? c0 : args[3]
        const r1 = args[4] === undefined ? r0 : args[4]
        if (![c0, r0, c1, r1].every((n) => isNum(n) && Number.isInteger(n) && n >= 0)) return undefined
        if (spec.kind === 'clear') {
          for (const key of [...inst.cells.keys()]) {
            const [c, r] = key.split(',').map(Number)
            if (c >= c0 && c <= c1 && r >= r0 && r <= r1) inst.cells.delete(key)
          }
        } else {
          if (c1 < c0 || r1 < r0 || (c1 === c0 && r1 === r0)) return undefined
          if (cellAddr(name, inst, c1, r1) === null) return undefined
          for (let r = r0; r <= r1; r += 1) {
            for (let c = c0; c <= c1; c += 1) if (!inst.cells.has(`${c},${r}`)) inst.cells.set(`${c},${r}`, {})
          }
          const head = `${c0},${r0}`
          inst.cells.set(head, { ...inst.cells.get(head), colspan: c1 - c0 + 1, rowspan: r1 - r0 + 1 })
        }
        stats.updated += 1
        return undefined
      }
      default:
        throw new ObjectRunError(`no drawing operation \`${name}\``)
    }
  }

  /** `na(h)` of a drawing: a live handle is not `na`. ⛔ A handle whose object
   *  was deleted or collected is the case no capture settles — the run stops by
   *  name rather than pick an answer that decides which branch runs. */
  function naOf(h) {
    if (!isDrawingHandle(h)) return null
    if (live.has(h.id)) return 0
    if (dead.has(h.id)) {
      stop('the script tests `na()` of a drawing that was deleted or collected; whether TradingView '
        + 'answers true there is not captured')
    }
    return 0
  }

  /** The LIVE set at the last bar, in `objectRuntime.finish().live`'s shape. */
  function finish() {
    const withheld = {}
    const ordered = []
    if (!stopped) {
      for (const inst of live.values()) {
        if (withheldFams.has(inst.family) || (inst.family === 'linefill' && withheldFams.has('line'))) {
          withheld[inst.family] = (withheld[inst.family] || 0) + 1
          continue
        }
        const rec = {
          family: inst.family,
          id: inst.id,
          site: null,
          createdBar: inst.createdBar,
          props: {},
        }
        for (const [k, v] of Object.entries(inst.props)) {
          // ⭐ a linefill's two lines are written as the render state's own
          // `{__ref: id}` form (`toRenderState`), never as a handle object.
          rec.props[k] = (k === 'line1' || k === 'line2') ? { __ref: idOf(v) } : v
        }
        if (inst.family === 'table') {
          rec.cells = [...inst.cells.entries()].map(([key, props]) => {
            const [col, row] = key.split(',').map(Number)
            return { col, row, props: { ...props } }
          }).sort((a, b) => (a.row - b.row) || (a.col - b.col))
        }
        ordered.push(rec)
      }
    }
    return {
      status: stopped ? 'OBJECT_UNWITNESSED' : 'ok',
      reason: stopped,
      live: ordered,
      withheld: Object.fromEntries([...withheldFams.entries()]),
      withheldCounts: withheld,
      undrawnProps: Object.fromEntries(undrawn.entries()),
      counts: { ...counts },
      stats: { ...stats, nextId },
    }
  }

  return { call, naOf, finish, limits }
}
