// app/src/components/chart/engine/objectRuntime.js
//
// ─── ⭐⭐ C3B — THE OBJECT STATE EVALUATOR ───────────────────────────────────
//
// One bar at a time, in source order, exactly as Pine executes. Everything hard
// about graphical objects is here: identity that survives bars, a lifetime with
// an end, a resource envelope, and a deterministic answer to "what is on the
// chart right now".
//
// ⛔⛔ NO FUTURE LEAKAGE. Bar *i* sees values at bar *i* and object state built
// by bars 0..i. There is no second pass, no lookahead, and no "settle" step —
// because the one thing a member cannot forgive is a drawing that knew what
// happened next. The runtime therefore never reads a column at an index it has
// not reached, and `evaluateObjects` walks strictly forward.
//
// ⛔⛔ IDENTITY IS A COUNTER, NOT A FINGERPRINT. Every create mints the next
// integer. Two objects with identical geometry are two objects; the same object
// moved twice is still one. This is the rule the whole wave rests on and it is
// enforced by construction — there is no code path that looks at props to
// decide which object something is.
//
// ⭐ DELETION REALLY DELETES. The instance leaves the live map, its slot in the
// per-family counter is returned, and the render state that follows cannot see
// it. `CREATE → DELETE` repeated across thousands of bars must leave the live
// count flat, which is what `objectRuntime.gc.test.js` measures rather than
// assumes.
//
// ⚠️ A MUTATION OF A DELETED OBJECT IS A COUNTED NO-OP, NOT A CRASH. Pine lets a
// reference outlive the object it named; the honest model of that is "the write
// went nowhere", and hiding it would make a real authoring bug invisible, so it
// is tallied in `stats.writesToDeleted` and surfaced.
import {
  OBJECT_FAMILIES, DEFAULT_OBJECT_LIMITS, assertObjectProgram,
} from './ast/objectProgram'

export const OBJECT_STATUS = Object.freeze({
  OK: 'ok',
  LIMIT_EXCEEDED: 'OBJECT_LIMIT_EXCEEDED',
})

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Truthiness for a guard column. ⛔ `NaN` IS FALSE, deliberately: a condition
 *  that has not warmed up yet has not fired, and treating an unknown as a fire
 *  is how an object appears on bar 0 of every chart. */
function truthy(v) {
  if (v === true) return true
  if (v === false || v === null || v === undefined) return false
  return Number.isFinite(v) && v !== 0
}

/**
 * @param {object} program        a validated object program
 * @param {object} ctx
 * @param {number} ctx.barCount
 * @param {(node:number, bar:number)=>*} ctx.readNode   V2 graph node value at a bar
 * @param {(id:string)=>*}               [ctx.readParam] logical parameter value
 * @param {(bar:number)=>number}         [ctx.readTime]  bar timestamp
 * @param {object}                       [ctx.limits]    override the envelope
 * @param {boolean}                      [ctx.trace]     keep a per-bar event log
 */
export function evaluateObjects(program, ctx) {
  assertObjectProgram(program)
  const limits = { ...DEFAULT_OBJECT_LIMITS, ...(program.limits || {}), ...(ctx.limits || {}) }
  const barCount = Math.max(0, ctx.barCount | 0)
  const readNode = ctx.readNode || (() => NaN)
  const readParam = ctx.readParam || (() => undefined)
  const readTime = ctx.readTime || ((i) => i)

  /** instanceId → { family, id, site, createdBar, props } */
  const live = new Map()
  /** table instanceId → Map<"col,row", props> — cells are addressed, not listed */
  const cells = new Map()
  const regs = new Map((program.regs || []).map((r) => [r.id, null]))
  const colls = new Map((program.colls || []).map((c) => [c.id, []]))
  const collCap = new Map((program.colls || []).map((c) => [c.id, c.cap]))
  const counts = Object.fromEntries(OBJECT_FAMILIES.map((f) => [f, 0]))
  const peak = Object.fromEntries(OBJECT_FAMILIES.map((f) => [f, 0]))

  /** site ids whose ONCE create has already fired. ⭐ Pine's `var x = expr`
   *  initialises the first time the path is reached and never again. */
  const firedOnce = new Set()
  let nextId = 1
  let created = 0; let updated = 0; let deleted = 0
  let writesToDeleted = 0; let opsExecuted = 0; let maxOpsInABar = 0
  const events = []
  let status = OBJECT_STATUS.OK
  let reason = null

  const fail = (why) => {
    if (status === OBJECT_STATUS.OK) { status = OBJECT_STATUS.LIMIT_EXCEEDED; reason = why }
  }

  for (let bar = 0; bar < barCount && status === OBJECT_STATUS.OK; bar += 1) {
    /** site id → instanceId created on THIS bar. ⭐ Cleared every bar, which is
     *  the whole meaning of a site reference: `line.new(...)` used inline names
     *  the object made now, never one made yesterday. */
    const siteNow = new Map()
    /** counter id → its value for the iteration being executed RIGHT NOW.
     *  ⛔ PER BAR, and cleared with the bar: a counter that outlived its loop
     *  would let a later op read a stale index and write the wrong row. */
    const loopVars = new Map()
    let opsThisBar = 0

    /**
     * ⭐⭐ PINE'S `str.tostring` FORMAT — `#` AND `0` ARE DIFFERENT CHARACTERS.
     *
     * `#` is an OPTIONAL digit and `0` is a REQUIRED one, which is the whole
     * difference between the two formats the reachable corpus writes:
     *
     *     str.tostring(6.2,  '#.##')  ->  '6.2'      trailing zeros TRIMMED
     *     str.tostring(6.0,  '#.##')  ->  '6'        …and the point goes too
     *     str.tostring(1.007, '0.00') ->  '1.01'     always two decimals
     *     str.tostring(45.5,  '0.00') ->  '45.50'    a zero the author asked for
     *
     * ⚰⚰ THIS READ ONLY THE `#.##` FAMILY, and the `0.00` FAMILY FELL THROUGH
     * TO THE RAW NUMBER. Measured 2026-09-13 on `uncharted-volume-v2.pine`, whose
     * Volume cell is `str.tostring(volMult, '0.00')`: the dashboard drew
     * `Vol : 45.187M (1.0070985212342736x)` where the vendor draws
     * `Vol : 45.51M (1.05x)`. The old regex tested `^#*\.?(#*|0*)$`, which a
     * leading `0` cannot match, so the guard fired and returned `String(n)` —
     * the "honest fallback" doing seventeen significant figures inside a cell
     * eight characters wide. ⛔ A fallback that has never been SEEN is not a
     * fallback, it is an unreached branch, and this one was reached by two of
     * v2's four visible cells.
     *
     * ⛔ STILL NARROW, AND STILL HONEST ABOUT IT. A thousands separator
     * (`'#,###'`) is NOT implemented: ignoring the comma would print the right
     * digits in the wrong grouping, which is a number the author did not ask
     * for, so a format containing one falls back to the plain value exactly as
     * before. Nothing in the reachable 27 writes one.
     */
    const formatNumber = (n, fmt) => {
      if (!Number.isFinite(n)) return 'NaN'
      if (typeof fmt !== 'string' || !fmt) {
        // Pine's default: up to 10 significant digits, trailing zeros trimmed.
        return String(Number(n.toPrecision(10)))
      }
      // ⛔ THE WHOLE STRING MUST BE UNDERSTOOD. Stripping unknown characters and
      // formatting the remainder is how `'#,###'` would silently become `'####'`.
      if (!/^[#0]*(\.[#0]*)?$/.test(fmt)) return String(n)
      const dot = fmt.indexOf('.')
      const frac = dot < 0 ? '' : fmt.slice(dot + 1)
      const intPart = dot < 0 ? fmt : fmt.slice(0, dot)
      const max = Math.max(0, Math.min(10, frac.length))
      // Required decimals are the `0`s; Pine writes them contiguously after the
      // optional `#`s, and counting them is enough for either order.
      const min = Math.min(max, (frac.match(/0/g) || []).length)
      let out = n.toFixed(max)
      if (max > min) {
        // Trim only the OPTIONAL tail, never a digit the author demanded.
        out = out.replace(/0+$/, (z) => z.slice(0, Math.max(0, min - (max - z.length))))
        out = out.replace(/\.$/, '')
      }
      // `'00.0'` asks for a leading zero. Rare, but it is a request like any
      // other, and padding is the only way to answer it.
      const wantInt = (intPart.match(/0/g) || []).length
      if (wantInt > 1) {
        const neg = out.startsWith('-')
        const body = neg ? out.slice(1) : out
        const head = body.split('.')[0]
        if (head.length < wantInt) {
          out = (neg ? '-' : '') + '0'.repeat(wantInt - head.length) + body
        }
      }
      return out
    }

    const textOf = (t) => {
      if (!isObj(t)) return ''
      switch (t.t) {
        case 'lit': return t.s
        case 'num': {
          const n = Number(readNode(t.node, bar, loopVars))
          return formatNumber(n, t.fmt)
        }
        // ⭐⭐ A VALUE THAT IS ALREADY TEXT. ⛔ A non-string answers the EMPTY
        // string, never `String(v)`: an `undefined` row would render the word
        // "undefined" into a dashboard cell, and a member reads that as data.
        case 'str': {
          const v = readNode(t.node, bar, loopVars)
          return typeof v === 'string' ? v : ''
        }
        case 'cat': return (t.args || []).map(textOf).join('')
        case 'if': return truthy(value(t.cond)) ? textOf(t.then) : textOf(t.else)
        default: return ''
      }
    }

    const colorOf = (c) => {
      if (!isObj(c)) return null
      if (c.c === 'lit') return c.hex
      if (c.c === 'if') return truthy(value(c.cond)) ? colorOf(c.then) : colorOf(c.else)
      return null
    }

    const value = (ref) => {
      if (!isObj(ref)) return undefined
      switch (ref.v) {
        case 'const': return ref.value
        // ⭐ `loopVars` RIDES ALONG so a reader can answer a value that depends
        // on the ITERATION, not just the bar. An ordinary reader ignores it.
        case 'graph': return readNode(ref.node, bar, loopVars)
        case 'param': return readParam(ref.id)
        case 'bar': return bar
        // ⭐ THE LOOP COUNTER, supplied by the RUNTIME exactly as `bar` is.
        // ⛔ AN UNBOUND COUNTER IS `undefined`, NOT 0. A body op referencing a
        // loop id nothing declares would otherwise silently read row zero and
        // overwrite one cell N times — a table with one row where the author
        // wrote forty, and nothing anywhere saying so.
        case 'loop': return loopVars.has(ref.id) ? loopVars.get(ref.id) : undefined
        // ⭐⭐ ARITHMETIC OVER ADDRESSES — `table.cell(t, 0, r + 1, …)`, the
        // corpus idiom for a header row at 0 and data from 1.
        //
        // ⛔ A NON-NUMERIC OPERAND ANSWERS `undefined`, NEVER A COERCION.
        // JavaScript would happily give `undefined + 1 === NaN` and `"2" * 3
        // === 6`; both put a cell somewhere plausible and wrong. An address
        // this grammar cannot compute is an address it declines to guess, and
        // the op that reads it is skipped by the same finiteness checks that
        // already guard a coordinate.
        case 'op': {
          const a = value(ref.args[0])
          if (typeof a !== 'number' || !Number.isFinite(a)) return undefined
          if (ref.args.length === 1) return ref.op === '-' ? -a : a
          const b = value(ref.args[1])
          if (typeof b !== 'number' || !Number.isFinite(b)) return undefined
          if (ref.op === '+') return a + b
          if (ref.op === '-') return a - b
          if (ref.op === '*') return a * b
          return undefined
        }
        case 'time': return readTime(bar)
        // ⛔⛔ TEXT AND COLOUR ARE EVALUATED PER BAR LIKE EVERYTHING ELSE. A
        // dashboard whose cells were computed once and reused would show the
        // first bar's numbers forever, which is the exact failure mode a
        // "tables are static chrome" shortcut produces.
        case 'text': return textOf(ref.node)
        case 'color': return colorOf(ref.node)
        default: return undefined
      }
    }

    const resolveRef = (r) => {
      if (!isObj(r)) return null
      switch (r.r) {
        case 'reg': return regs.get(r.id) ?? null
        case 'site': return siteNow.get(r.id) ?? null
        case 'coll': {
          const arr = colls.get(r.id)
          if (!arr) return null
          const i = Number(value(r.index))
          if (!Number.isInteger(i) || i < 0 || i >= arr.length) return null
          return arr[i]
        }
        default: return null
      }
    }

    const resolveProps = (props, out) => {
      for (const [k, v] of Object.entries(props || {})) {
        if (isObj(v) && v.r) {
          const inst = resolveRef(v)
          out[k] = inst === null ? null : { __ref: inst }
        } else {
          out[k] = value(v)
        }
      }
      return out
    }

    /** Execute a list of ops in order. Answers FALSE when the bar's envelope is
     *  spent, so a loop stops the whole bar rather than its own body only.
     *
     *  ⭐⭐ RE-ENTRANT BECAUSE A LOOP CONTAINS OPS. This was a flat `for` over
     *  `program.ops`, which is why a loop could not be an operation at all. */
    const runOps = (list) => {
    for (const op of list) {
      // ⭐⭐ `barstate.islast` LIVES HERE, AS A FLAG, NOT AS A GRAPH NODE.
      // Pine's own idiom for a dashboard is "draw it once, on the newest bar",
      // and an object program is a picture of the chart as it stands — so this
      // is exactly answerable. It is a flag rather than a value so that it can
      // never leak into a tree, a hash or a screener column, where "the last
      // bar" would depend on how many bars the caller asked for.
      if (op.lastBarOnly && bar !== barCount - 1) continue
      // ⭐⭐ `var x = <expr>` RUNS ONCE. Without this a `var table t =
      // table.new(…)` mints a new table on every bar — 300 bars, 300 tables,
      // the envelope exceeded, the whole indicator refused. It is the
      // commonest object initialiser in the corpus.
      if (op.once && firedOnce.has(op.site)) continue
      // ⭐ `not na(l)` / `na(l)` are LIVENESS tests on a handle, answered here
      // because only the runtime holds the registers. They are flags rather
      // than values so that object state can never leak into the pure graph.
      if (op.requiresLive && regs.get(op.requiresLive) === null) continue
      if (op.requiresEmpty && regs.get(op.requiresEmpty) !== null) continue
      if (op.when != null && !truthy(value(op.when))) continue
      opsThisBar += 1
      opsExecuted += 1
      if (opsThisBar > limits.opsPerBar) {
        fail(`more than ${limits.opsPerBar} object operations on bar ${bar}`)
        return false
      }

      switch (op.k) {
        // ⭐⭐ THE LOOP. Pine's `for i = from to to` is INCLUSIVE at both ends
        // and counts DOWN when `to < from`, which is why the step is derived
        // rather than assumed — `for i = n to 0` is a real and common idiom and
        // an ascending-only reader draws nothing for it, silently.
        case 'loop': {
          const from = Number(value(op.from))
          const to = Number(value(op.to))
          // ⛔ A BOUND THAT IS NOT A NUMBER RUNS ZERO TIMES, NEVER "from 0".
          // `array.size(syms) - 1` on a bar before the array is filled is `na`,
          // and treating that as 0 would draw a row of blanks that looks like
          // data. Drawing nothing is the honest answer for a list that is empty.
          if (!Number.isFinite(from) || !Number.isFinite(to)) break
          const step = to >= from ? 1 : -1
          const had = loopVars.has(op.id)
          const prev = loopVars.get(op.id)
          let ok = true
          for (let n = from; step > 0 ? n <= to : n >= to; n += step) {
            loopVars.set(op.id, n)
            if (!runOps(op.body)) { ok = false; break }
          }
          // ⛔ RESTORED, NOT DELETED. Nested loops over the same id are
          // pathological but legal, and clearing unconditionally would leave an
          // outer counter unbound for the rest of its own body.
          if (had) loopVars.set(op.id, prev); else loopVars.delete(op.id)
          if (!ok) return false
          break
        }
        case 'create': {
          if (counts[op.family] >= limits[op.family]) {
            fail(`more than ${limits[op.family]} live ${op.family} objects (bar ${bar})`)
            break
          }
          const id = nextId
          nextId += 1
          const inst = {
            family: op.family, id, site: op.site, createdBar: bar, props: resolveProps(op.props, {}),
          }
          live.set(id, inst)
          counts[op.family] += 1
          if (counts[op.family] > peak[op.family]) peak[op.family] = counts[op.family]
          siteNow.set(op.site, id)
          if (op.once) firedOnce.add(op.site)
          if (op.into) regs.set(op.into, id)
          created += 1
          if (ctx.trace) events.push({ bar, k: 'create', family: op.family, id, site: op.site })
          break
        }
        case 'update': {
          const target = resolveRef(op.target)
          const inst = target === null ? null : live.get(target)
          if (!inst) { writesToDeleted += 1; break }
          resolveProps(op.props, inst.props)
          updated += 1
          if (ctx.trace) events.push({ bar, k: 'update', id: inst.id })
          break
        }
        case 'cell': {
          const target = resolveRef(op.target)
          const inst = target === null ? null : live.get(target)
          if (!inst) { writesToDeleted += 1; break }
          const col = Number(value(op.col))
          const row = Number(value(op.row))
          if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) break
          let map = cells.get(inst.id)
          if (!map) { map = new Map(); cells.set(inst.id, map) }
          const key = `${col},${row}`
          const cur = map.get(key) || {}
          map.set(key, resolveProps(op.props, cur))
          updated += 1
          if (ctx.trace) events.push({ bar, k: 'cell', id: inst.id, col, row })
          break
        }
        case 'delete': {
          const target = resolveRef(op.target)
          const inst = target === null ? null : live.get(target)
          if (!inst) { writesToDeleted += 1; break }
          live.delete(inst.id)
          cells.delete(inst.id)
          counts[inst.family] -= 1
          deleted += 1
          // ⭐ A DELETED OBJECT LEAVES EVERY CONTAINER THAT NAMED IT. Otherwise a
          // register or collection keeps a handle to nothing and the next write
          // silently lands nowhere — the "why did my update stop working" bug.
          for (const [rid, held] of regs) if (held === inst.id) regs.set(rid, null)
          for (const [cid, arr] of colls) {
            const at = arr.indexOf(inst.id)
            if (at >= 0) arr.splice(at, 1)
          }
          if (ctx.trace) events.push({ bar, k: 'delete', id: inst.id })
          break
        }
        case 'setreg': {
          regs.set(op.reg, op.value === null ? null : resolveRef(op.value))
          break
        }
        case 'push': {
          const arr = colls.get(op.coll)
          const inst = resolveRef(op.value)
          if (!arr || inst === null) break
          if (arr.length >= collCap.get(op.coll)) {
            fail(`collection ${op.coll} exceeded its cap of ${collCap.get(op.coll)} (bar ${bar})`)
            break
          }
          arr.push(inst)
          break
        }
        case 'collset': {
          const arr = colls.get(op.coll)
          const i = Number(value(op.index))
          const inst = resolveRef(op.value)
          if (arr && Number.isInteger(i) && i >= 0 && i < arr.length && inst !== null) arr[i] = inst
          break
        }
        case 'collremove': {
          const arr = colls.get(op.coll)
          const i = Number(value(op.index))
          if (arr && Number.isInteger(i) && i >= 0 && i < arr.length) arr.splice(i, 1)
          break
        }
        case 'collclear': {
          const arr = colls.get(op.coll)
          if (arr) arr.length = 0
          break
        }
        default:
          break
      }
    }
    return true
    }
    runOps(program.ops)
    if (opsThisBar > maxOpsInABar) maxOpsInABar = opsThisBar
  }

  // ⭐ CREATION ORDER IS RENDER ORDER, and it is the object id because the id IS
  // a creation counter. Sorting by anything else (price, family) would put a
  // later object under an earlier one and quietly change what the author drew.
  const ordered = [...live.values()].sort((a, b) => a.id - b.id)

  return {
    status,
    reason,
    live: ordered.map((o) => ({
      family: o.family,
      id: o.id,
      site: o.site,
      createdBar: o.createdBar,
      props: { ...o.props },
      ...(o.family === 'table' ? { cells: cellsOf(cells.get(o.id)) } : {}),
    })),
    counts: { ...counts },
    stats: {
      created, updated, deleted, writesToDeleted, opsExecuted, maxOpsInABar,
      peakLive: { ...peak },
      liveTotal: ordered.length,
      nextId,
    },
    ...(ctx.trace ? { events } : {}),
  }
}

function cellsOf(map) {
  if (!map) return []
  return [...map.entries()]
    .map(([key, props]) => {
      const [col, row] = key.split(',').map(Number)
      return { col, row, props: { ...props } }
    })
    .sort((a, b) => (a.row - b.row) || (a.col - b.col))
}
