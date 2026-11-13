// app/src/components/chart/engine/runHalfObjectRail.js
//
// ─── ⭐⭐ ENGINE 54 — THE RUN HALF'S OBJECT RAIL ─────────────────────────────────────────
//
// Engine 53 drew a run half's drawings when the run's PLOTS equalled the host's (the column
// rail). For a drawing-only partial script that rail compares nothing: no plot is mapped, and
// the upper-bound reach served 2 of its 4 run halves on the gates alone (auto-trendlines-by-
// pivots with 68 objects, volume-profile). A wrong drawing is never acceptable, so the run's
// DRAWINGS are now held to the host's own, call site by call site:
//
//   For every create site of the host object program whose family the host draws on this
//   chart, the run's objects made at the SAME SOURCE CALL (`objectProgram.js::objectSiteKey`,
//   which both lanes stamp: the host per site, the run per object) must be the host's objects:
//     · the same number at each site, in the same creation order across the compared sites;
//     · each made on the same bar;
//     · each DRAWN the same (`objectRenderState.toRenderState`, the one renderer both lanes
//       feed): anchors to the price tolerance policy (`tools/vendor_harness/compare.mjs`,
//       REL 1e-9, the 1e-12 floor of an unknown price scale), text, style, colours, size,
//       extend, a table's cells, a fill's two lines (by which compared line they are).
//
// Codes (each refuses: the member reads a plain sentence and the host picture stays):
//   run-half:object-rail             a compared object differs, the run makes more at a
//                                    compared site, a host object has no site the run half
//                                    maps, or the host program stopped / disagrees with itself
//   run-half:host-object-withheld    the run does not make an object the host draws (at a
//                                    compared site the host has more), whatever the reason:
//                                    a warm-up, a collector, a branch the run did not take
//   run-half:uncompared-site         the run draws an object at a site the rail did not compare (a
//                                    call the host program lost, a family the host draws none of):
//                                    every drawing served must have been held to the host's; only
//                                    the Part 2 evidence hook admits such a run
//   run-half:no-comparable-objects   nothing to compare: the host draws none of the run's
//                                    sites (the verdict `removes`, a family the host withholds
//                                    whole), or the compared sites hold no object on either
//                                    side. The Part 2 hook (`runHalfRailSeam.runHalfEvidenceAdmits`)
//                                    may admit such a script on recorded objects-v2 evidence;
//                                    with none, refused.
//
// The host program is evaluated here exactly as the binder draws it (`hostObjectRun`, which
// the binder now calls too: one evaluation path, never two).
import { objectReaderFor } from './objectColumns'
import { evaluateObjects, OBJECT_STATUS } from './objectRuntime'
import { toRenderState } from './objectRenderState'
import { registerRunHalfObjectRail, runHalfEvidenceAdmits } from './runHalfRailSeam.js'
import { runtimeSourceHash } from './runtimeKill'

export const RUN_HALF_OBJECT_RAIL = 'run-half:object-rail'
export const RUN_HALF_HOST_OBJECT_WITHHELD = 'run-half:host-object-withheld'
export const RUN_HALF_NO_COMPARABLE_OBJECTS = 'run-half:no-comparable-objects'
/** ⭐⭐ ENGINE 54 (review) — the run draws an object at a site the rail did not compare: a call the
 *  host program lost, or a family the host draws none of. Nothing held it to anything. */
export const RUN_HALF_UNCOMPARED_SITE = 'run-half:uncompared-site'

/** The price tolerance policy at an unknown price scale (`compare.mjs`: `REL_TOL`,
 *  `ABS_FLOOR_UNKNOWN_SCALE`). A bind does not know the symbol's tick. */
const REL = 1e-9
const ABS = 1e-12

/** The object reader's options for a chart binding, from the bind's `ctx` and the instance's
 *  inputs — exactly what the binder hands it. */
export function hostObjectReaderOpts(ctx, inputs) {
  const c = ctx || {}
  return {
    inputs,
    tf: c.tf,
    symbol: c.symbol,
    newestBarIsForming: c.newestBarIsForming ?? null,
    secondary: c.secondary && typeof c.secondary.get === 'function' ? c.secondary : null,
    exchangeOf: c.exchangeOf,
    lowerTf: c.lowerTf && typeof c.lowerTf.get === 'function' ? c.lowerTf : null,
    ...(c.historyFromListing === true ? { historyFromListing: true } : {}),
    ...(c.barIndexFromFirstBar === true ? { barIndexFromFirstBar: true } : {}),
  }
}

/** ⭐ THE host object program over these bars: `{reader, run}`, or null when there is nothing
 *  to read. The binder draws `run.live`; the object rail compares it. */
export function hostObjectRun(def, bars, readerOpts) {
  const reader = objectReaderFor(def, bars, readerOpts)
  if (!reader) return null
  const run = evaluateObjects(reader.program, {
    barCount: bars.length,
    readNode: reader.readNode,
    readTime: reader.readTime,
    readUnknown: reader.readUnknown,
    readUnknownOther: reader.readUnknownOther,
    offListing: reader.historyFromListing !== true,
  })
  return { reader, run }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A colour as one comparable spelling (`#rrggbbaa`), anything else unchanged. */
function colourKey(s) {
  const t = s.trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(t)
  if (m) return `#${m[1].split('').map((x) => x + x).join('')}ff`
  m = /^#([0-9a-f]{6})$/.exec(t)
  if (m) return `#${m[1]}ff`
  if (/^#[0-9a-f]{8}$/.test(t)) return t
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(t)
  if (m) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0')
    return `#${h(m[1])}${h(m[2])}${h(m[3])}${h(m[4] === undefined ? 255 : Number(m[4]) * 255)}`
  }
  return s
}

/** Two drawn values agree: numbers to the price tolerance policy (`na` with `na`), strings as
 *  one colour spelling or exactly, arrays and objects member by member. */
function sameValue(a, b, depth = 0) {
  if (Object.is(a, b)) return true
  if (depth > 8) return false
  const an = typeof a === 'number'
  const bn = typeof b === 'number'
  if (an || bn) {
    if (!(an && bn)) return false
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isNaN(a) && Number.isNaN(b)
    const d = Math.abs(a - b)
    return d <= ABS || d <= REL * Math.max(Math.abs(a), Math.abs(b))
  }
  if (typeof a === 'string' && typeof b === 'string') return colourKey(a) === colourKey(b)
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => sameValue(x, b[i], depth + 1))
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined)
    const kb = Object.keys(b).filter((k) => b[k] !== undefined)
    if (ka.length !== kb.length) return false
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k], depth + 1))
  }
  return false
}

const ROWS = { line: 'lines', label: 'labels', box: 'boxes', table: 'tables', linefill: 'fills' }

/** Each object's drawn row, by id (`undefined`: drawn as nothing — an `na` coordinate). */
function rowsById(state) {
  const out = new Map()
  for (const k of Object.values(ROWS)) for (const r of (state && state[k]) || []) out.set(r.id, r)
  return out
}

/** The host program's create sites: `[{site, family}]` (loop bodies included). */
function hostCreateSites(program) {
  const out = []
  const walk = (ops) => {
    for (const op of ops || []) {
      if (!op) continue
      if (op.k === 'create' && typeof op.site === 'string') out.push({ site: op.site, family: op.family })
      if (Array.isArray(op.body)) walk(op.body)
    }
  }
  walk(program && program.ops)
  return out
}

/**
 * ⭐⭐ THE OBJECT RAIL, as a pure comparison (exported for its rails).
 * @param {object} a
 * @param {object} a.program   the host object program (`definition.objects`), or null
 * @param {object|null} a.hostRun  `evaluateObjects(...)` of it on these bars, or null (nothing read)
 * @param {object} a.sites     `compute.runtimeObjects.sites`: host site id -> source call
 * @param {object} a.payload   the run's drawings (`objectStore.finish()` + `pineVersion`)
 * @param {Array}  a.bars
 * @param {string} [a.tf]
 * @param {string} [a.sourceSha256]  the script's identity, for the Part 2 evidence hook
 * @returns {{ok: true, compared: number} | {ok: false, code: string, why: string}}
 */
export function runHalfObjectVerdict({ program, hostRun, sites, payload, bars, tf, sourceSha256 }) {
  const refuse = (code, why) => ({ ok: false, code, why })
  const nothing = (why) => (runHalfEvidenceAdmits(sourceSha256)
    ? { ok: true, compared: 0, admittedBy: 'evidence' } : refuse(RUN_HALF_NO_COMPARABLE_OBJECTS, why))
  const map = isObj(sites) ? sites : {}
  if (hostRun && hostRun.status !== OBJECT_STATUS.OK) {
    return refuse(RUN_HALF_OBJECT_RAIL, `the host object program stopped (${hostRun.status})`)
  }
  const hostLive = hostRun && Array.isArray(hostRun.live) ? hostRun.live : []
  const withheld = (hostRun && isObj(hostRun.withheld)) ? hostRun.withheld : {}
  const drawnFams = new Set(hostLive.map((o) => o.family))
  // the families the host withholds: whole (nothing drawn: not comparable) or in part (it
  // disagrees with itself about that family: nothing of it can be held to it)
  const wholeOut = new Set()
  for (const [fam, n] of Object.entries(withheld)) {
    if (!(n > 0)) continue
    if (drawnFams.has(fam)) return refuse(RUN_HALF_OBJECT_RAIL, `the host withholds some of its ${fam}s and draws others`)
    wholeOut.add(fam)
  }
  const keys = new Set()
  for (const { site, family } of hostCreateSites(program)) {
    const key = Object.prototype.hasOwnProperty.call(map, site) ? map[site] : null
    if (typeof key !== 'string') return refuse(RUN_HALF_OBJECT_RAIL, `host site ${site} has no source call in the run half`)
    if (!wholeOut.has(family)) keys.add(key)
  }
  if (!keys.size) return nothing('the host draws none of the run\'s drawing sites')
  const keyOf = (o) => (Object.prototype.hasOwnProperty.call(map, o.site) ? map[o.site] : null)
  const host = []
  for (const o of hostLive) {
    const k = keyOf(o)
    if (typeof k !== 'string') return refuse(RUN_HALF_OBJECT_RAIL, `a host ${o.family} was made at a site the run half does not map`)
    if (keys.has(k)) host.push({ o, k })
  }
  const run = (payload.live || []).filter((o) => typeof o.site === 'string' && keys.has(o.site))
    .map((o) => ({ o, k: o.site }))
  if (!host.length && !run.length) return nothing('the compared sites hold no drawing on either side')
  host.sort((x, y) => x.o.id - y.o.id)
  run.sort((x, y) => x.o.id - y.o.id)
  // ⛔ per site first, so the code says which way it differs
  const count = (list) => { const m = new Map(); for (const { k } of list) m.set(k, (m.get(k) || 0) + 1); return m }
  const hc = count(host)
  const rc = count(run)
  for (const [k, n] of hc) {
    if ((rc.get(k) || 0) < n) {
      return refuse(RUN_HALF_HOST_OBJECT_WITHHELD, `the run makes ${rc.get(k) || 0} of the host's ${n} drawings at line ${k.split(':')[0]}`)
    }
  }
  for (const [k, n] of rc) {
    if ((hc.get(k) || 0) < n) return refuse(RUN_HALF_OBJECT_RAIL, `the run makes ${n} drawings at line ${k.split(':')[0]}, the host ${hc.get(k) || 0}`)
  }
  // ⛔ then pair by creation order across every compared site, and compare what is drawn
  const opts = { bars, tf }
  const hRows = rowsById(toRenderState(host.map((x) => x.o), { ...opts, pineVersion: program && program.pineVersion }))
  const rRows = rowsById(toRenderState(run.map((x) => x.o), { ...opts, pineVersion: payload.pineVersion }))
  const hPos = new Map(host.map((x, i) => [x.o.id, i]))
  const rPos = new Map(run.map((x, i) => [x.o.id, i]))
  for (let i = 0; i < host.length; i += 1) {
    const h = host[i]
    const r = run[i]
    const at = `drawing ${i + 1} (a ${h.o.family} at line ${h.k.split(':')[0]})`
    if (h.k !== r.k || h.o.family !== r.o.family) return refuse(RUN_HALF_OBJECT_RAIL, `${at}: the run's is made at another call`)
    if (h.o.createdBar !== r.o.createdBar) return refuse(RUN_HALF_OBJECT_RAIL, `${at}: made on bar ${h.o.createdBar} by the host, ${r.o.createdBar} by the run`)
    const hr = hRows.get(h.o.id)
    const rr = rRows.get(r.o.id)
    if (!hr || !rr) {
      if (hr || rr) return refuse(RUN_HALF_OBJECT_RAIL, `${at}: drawn by one lane and not the other`)
      continue
    }
    const { id: _hi, ...hRest } = hr
    const { id: _ri, ...rRest } = rr
    if (h.o.family === 'linefill') {
      // a fill's two lines, by which compared drawing they are
      for (const side of ['a', 'b']) {
        if (hPos.get(hRest[side]) === undefined || hPos.get(hRest[side]) !== rPos.get(rRest[side])) {
          return refuse(RUN_HALF_OBJECT_RAIL, `${at}: it fills between other lines`)
        }
        delete hRest[side]; delete rRest[side]
      }
    }
    if (!sameValue(hRest, rRest)) {
      const diff = Object.keys({ ...hRest, ...rRest }).find((k) => !sameValue(hRest[k], rRest[k])) || 'a property'
      return refuse(RUN_HALF_OBJECT_RAIL, `${at}: its \`${diff}\` differs`)
    }
  }
  // ⛔⛔ EVERY OBJECT THE RUN DRAWS MUST COME FROM A SITE THIS RAIL COMPARED. A drawing made at a
  // call the host program lost, or in a family the host draws none of, was held to nothing: it is
  // the vacuous-rail class this rail exists to close (auto-trendlines-by-pivots: 52 labels compared
  // and equal, 16 lines from a lost call). Only recorded evidence (the Part 2 hook, the same rule as
  // nothing comparable) admits such a run.
  const uncompared = (payload.live || []).filter((o) => !(typeof o.site === 'string' && keys.has(o.site)))
  if (uncompared.length && !runHalfEvidenceAdmits(sourceSha256)) {
    const o = uncompared[0]
    return refuse(RUN_HALF_UNCOMPARED_SITE, `${uncompared.length} of the run's drawings come from a call the rail `
      + `did not compare (the first, a ${o.family}${typeof o.site === 'string' ? ` at line ${o.site.split(':')[0]}` : ''})`)
  }
  return { ok: true, compared: host.length, ...(uncompared.length ? { admittedBy: 'evidence' } : {}) }
}

/** The registered rail (`runHalfRailSeam.js`): the host program evaluated as the binder draws
 *  it, compared with the run's drawings. */
export function runHalfObjectRail({ def, bars, inputs, ctx, payload }) {
  let built = null
  try {
    built = hostObjectRun(def, bars, hostObjectReaderOpts(ctx, inputs))
  } catch (err) {
    return { ok: false, code: RUN_HALF_OBJECT_RAIL, why: `the host object program could not be read: ${String((err && err.message) || err)}` }
  }
  const ro = def.compute.runtimeObjects
  return runHalfObjectVerdict({
    program: def.objects || null,
    hostRun: built ? built.run : null,
    sites: ro && ro.sites,
    payload,
    bars,
    tf: ctx && ctx.tf,
    sourceSha256: ro && typeof ro.source === 'string' ? runtimeSourceHash(ro.source) : null,
  })
}

registerRunHalfObjectRail(runHalfObjectRail)
