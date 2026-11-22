// app/src/components/chart/engine/ast/barConstant.js
//
// ⭐⭐⭐ COND-TA (coordinator rulings 2026-11-15) — ONE AUTHORITY FOR "THIS CONDITION IS THE SAME
// ON EVERY BAR OF A BINDING".
//
// A `ta.*` call under a condition that holds on every bar or on none runs on every bar or never,
// so its per-call-site history IS the every-bar history: it is DRAWN, on every lane. Peer
// evidence: RS Rating (fred6724) — `if (typMa == 'SMA' and not timeframe.isweekly)` /
// `rsMA := ta.sma(rs, lenMa)` — grades MATCH (RDDT / ALAB / CRWV, maxRel 0).
//
// ⛔ THREE DOORS ASKED THIS, EACH WITH ITS OWN COPY (the "guard repeated is a guard unproved"
// defect), and they disagreed: `objectFnInline.guardIsBarInvariant` (tokens) and the runtime
// lane's `invariantTest` admitted a PURE call over constants (`math.max(len, 5) > 10`), the
// host's `pine.js::bindTimeConstantTree` (canonical trees) did not — so that `?:` arm was stamped
// on the host lane and, since COND-TA, REFUSED on the screener lane, while the runtime lane drew
// it. Now:
//   · `PURE_PINE_CALLS` — the ONE allowlist of Pine calls that are a pure function of their
//     arguments (the token door asks it, `isPurePineCall`);
//   · `barConstantTree` — the ONE canonical-tree rule (the host's `bindTimeConstantTree` and the
//     runtime's `invariantTest` both call it; the pure-call half is the manifest's own
//     `isPointwise`, the canonical twin of the Pine allowlist: a table function with no lookback,
//     no forward read and series arguments only);
//   · `api/services/bar_constant.py::bar_constant_tree` is its Python twin, node for node, held to
//     the same answers by `tests/fixtures/ast/bar_constant_cases.json` (both read it).
// ⛔ FAIL CLOSED: a node kind not named here is NOT constant.
import { TABLE, isPointwise, BIND_TIME_CLOCK } from './parse.js'

/** ⭐ The Pine calls whose value is a pure function of their arguments (C13: measured on
 *  `high-low-open-mid-ranges`). ⛔ Excluded by name: `math.random` (not a function of its
 *  arguments) and `str.format_time` (reads the clock's zone and calendar). `request.*`, `ta.*`,
 *  `array.*` / `map.*` / `matrix.*` are not in it: stateful, or another context. */
export const PURE_PINE_CALLS = Object.freeze({
  names: Object.freeze(['color.new', 'color.rgb', 'color.r', 'color.g', 'color.b', 'color.t',
    'int', 'float', 'bool', 'string', 'nz', 'na']),
  namespaces: Object.freeze(['math', 'str']),
  excluded: Object.freeze(['math.random', 'str.format_time']),
})

/** Is the Pine call `name` a pure function of its arguments (`PURE_PINE_CALLS`)? */
export function isPurePineCall(name) {
  const v = String(name || '')
  if (PURE_PINE_CALLS.excluded.includes(v)) return false
  if (PURE_PINE_CALLS.names.includes(v)) return true
  const dot = v.indexOf('.')
  return dot > 0 && v.indexOf('.', dot + 1) < 0 && PURE_PINE_CALLS.namespaces.includes(v.slice(0, dot))
}

/** ⭐ Is this CANONICAL tree the same value on every bar of one binding?
 *  Literals (`num`, `str`), the chart symbol's own text (`symtext`), a declared input leaf
 *  (`series` with `inputName` or a finite `inputDefault`), the chart's timeframe flags
 *  (`BIND_TIME_CLOCK`, the manifest's own roster), operators (`op`, `textop`) and pointwise table
 *  calls over those. `opts.seedOf(node)` may name the one child of a call that decides it (the
 *  host's `var` recurrence seed). Iterative; ⛔ anything else fails closed. */
export function barConstantTree(tree, opts = {}) {
  const table = opts.table || TABLE
  const seedOf = typeof opts.seedOf === 'function' ? opts.seedOf : null
  const stack = [tree]
  let steps = 0
  while (stack.length) {
    if ((steps += 1) > 100000) return false
    let n = stack.pop()
    if (n && typeof n === 'object' && !n.type && n.value !== undefined) n = n.value   // a `{value}` argument
    if (!n || typeof n !== 'object') return false
    if (n.type === 'num' || n.type === 'str' || n.type === 'symtext') continue
    if (n.type === 'series') {
      if (BIND_TIME_CLOCK.includes(n.name)) continue
      if (typeof n.inputName === 'string') continue
      if (typeof n.inputDefault === 'number' && Number.isFinite(n.inputDefault)) continue
      return false
    }
    if ((n.type === 'op' || n.type === 'textop') && Array.isArray(n.args)) { for (const a of n.args) stack.push(a); continue }
    if (n.type === 'call' && Array.isArray(n.args)) {
      const seed = seedOf ? seedOf(n) : undefined
      if (seed !== undefined) {
        if (seed === null) return false
        stack.push(seed)
        continue
      }
      const spec = table && table.functions ? table.functions[n.name] : null
      if (!spec || !isPointwise(spec)) return false
      for (const a of n.args) stack.push(a)
      continue
    }
    return false
  }
  return true
}
