// app/src/components/chart/engine/ast/arrayWindows.js
//
// ─── ⭐⭐ C11b — A `var` NUMERIC ARRAY THAT IS A BOUNDED WINDOW IS A SERIES ────
//
// The plan-time vector (`arrayVectors.js`) folds an array whose every write is
// known before the chart runs. The corpus's other idiom is an array written BAR
// BY BAR under a condition and kept to a fixed length:
//
//     var ph = array.new_float()                    htf-liquidity-dashboard's
//     if open != open[1]                             `update_arrays`
//         ph.unshift(high[1])                        (newest in FRONT)
//     if ph.size() > 1
//         ph.pop()                                   (oldest out the BACK)
//
//     var top = array.new_float(3)                  pro-trading-art's
//     if not na(pivot)                               `maintainPivot`
//         top.push(pivot)                            (newest at the END,
//         top.shift()                                 oldest out the FRONT)
//
// Such an array is never state this reader has to hold: slot j (newest first)
// is the value pushed at the j-th most recent bar the condition held —
// `ta.valuewhen(cond, value, j)` — and its length counts how many of those have
// happened, capped. Both are ordinary series, so a drawing that reads the array
// reads a column: deterministic, per bar, slots (and `na` pre-fill) preserved.
//
// ⛔ EXACTLY THAT SHAPE, AND NOTHING NEAR IT. This module returns a model only
// when the ARRAY'S EVERY WRITE is one of the two shapes above; anything else —
// a second push site, `set`, `insert`, `clear`, a write inside an `else`, a cap
// that is not a literal, a write inside a loop, a function that reads a
// parameter's history from a conditional call — is refused with a reason, and
// the array keeps the refusal it always had. And the caller also requires every
// READ of the array to sit in a top-level statement AFTER its last write, so a
// read always sees the window as the bar left it.
//
// ⭐ THE WRITE MAY SIT INSIDE A USER FUNCTION OR METHOD the array is handed to
// (`update_arrays(o, s9d_highs, …)`, `top.maintainPivot(ph)`): the body is
// rewritten for that call by the object reader's own inliner (`rewriteBody`), so
// a parameter reads its argument exactly as it does for a drawing.
import { readFunctionDefs, bindArgs, splitArgs, rewriteBody, bodyNames, splitCommaStatements, definitionHeader } from './objectFnInline.js'
import { splitMethodName } from './ufcs.js'

const ADD = new Set(['push', 'unshift'])
const EVICT = new Set(['pop', 'shift'])
/** The reads a window answers. Everything else under `array.` keeps its refusal. */
export const WINDOW_READ_MEMBERS = Object.freeze(new Set(['size', 'get', 'first', 'last', 'max', 'min', 'sum', 'avg', 'indexof']))
/** A window wider than this is refused: its reads are unrolled per slot. */
export const MAX_WINDOW_CAP = 64

const text = (toks) => toks.map((t) => String(t.value)).join(' ')
const headOf = (v) => String(v).split('.')[0]
const mentionsToks = (toks, name) => (toks || []).some((t) => t.kind === 'ident'
  && (String(t.value) === name || headOf(t.value) === name))
const mentions = (st, name) => mentionsToks(st.header, name) || mentionsToks(st.body, name)
  || (st.sub || []).some((s) => mentions(s, name))

/** `X.size() > K` / `array.size(X) > K` / `K < X.size()` → `{of, k}` or null. */
function sizeGuardOf(toks, h) {
  const gt = toks.findIndex((t) => t.kind === 'punct' && (t.value === '>' || t.value === '<'))
  if (gt <= 0) return null
  const left = toks.slice(0, gt)
  const right = toks.slice(gt + 1)
  const sizeOf = (side) => {
    if (side.length === 3 && side[0].kind === 'ident' && h.isPunct(side[1], '(') && h.isPunct(side[2], ')')) {
      const m = splitMethodName(String(side[0].value))
      if (m && m.method === 'size') return m.recv
    }
    if (side.length === 4 && side[0].kind === 'ident' && String(side[0].value) === 'array.size'
        && h.isPunct(side[1], '(') && side[2].kind === 'ident' && h.isPunct(side[3], ')')) return String(side[2].value)
    return null
  }
  const lit = (side) => (side.length === 1 && side[0].kind === 'number' && Number.isInteger(side[0].value)
    ? side[0].value : null)
  const op = toks[gt].value
  if (op === '>' && sizeOf(left) && lit(right) !== null) return { of: sizeOf(left), k: lit(right) }
  if (op === '<' && lit(left) !== null && sizeOf(right)) return { of: sizeOf(right), k: lit(left) }
  return null
}

/**
 * The window model of the `var` array `name`, or `{refused}`.
 *
 * @param {object} p
 * @param {object[]} p.stmts        the top-level statements
 * @param {string}   p.name         the array
 * @param {Set}      p.writerStmts  the top-level statements that write it
 * @param {number}   p.n0           its creation size (0 for `array.new_float()`)
 * @param {object}   p.h            the reader helpers (`isPunct`, `findTop`, `boundName`)
 * @param {(n: string) => number|null} p.creationSizeOf  another array's creation size
 */
export function seriesWindowOf({ stmts, name, writerStmts, n0, h, creationSizeOf }) {
  const fnDefs = readFunctionDefs(stmts, h)
  const ops = []            // every add/evict, on ANY array, in program order
  let refused = null
  let seq = 0
  let inlineSeq = 0
  const refuse = (why) => { if (!refused) refused = why; return false }

  /** One statement list, under `guards` (token lists), at call depth `depth`. */
  const collect = (list, guards, depth, callGuarded) => {
    const items = splitCommaStatements(list, h)
    for (let i = 0; i < items.length && !refused; i += 1) {
      const st = items[i]
      const t = st.header || []
      if (!t.length) continue
      const touches = mentions(st, name)
      const word = t[0].kind === 'ident' ? String(t[0].value) : null
      if (word === 'if') {
        const cond = t.slice(1)
        const sg = sizeGuardOf(cond, h)
        if (sg) {
          // An eviction guard: its body may only evict.
          for (const s2 of st.sub || []) {
            const e = evictOf(s2.header || [])
            if (!e) return refuse(`the block under \`${text(cond)}\` does more than evict`)
            ops.push({ kind: 'evict', arr: e.arr, member: e.member, guards, size: sg, seq: seq++, callGuarded })
          }
          const next = items[i + 1]
          if (next && next.header && next.header[0] && next.header[0].value === 'else') {
            return refuse('an eviction guard with an `else`')
          }
          continue
        }
        if (mentionsToks(cond, name)) return refuse(`\`${name}\` is read in a condition (\`${text(cond)}\`)`)
        collect(st.sub || [], [...guards, cond], depth, callGuarded)
        continue
      }
      if (word === 'else' || word === 'for' || word === 'while' || word === 'switch') {
        if (touches) return refuse(`\`${name}\` is written inside \`${word}\``)
        continue
      }
      if (word && h.isPunct(t[1], '(')) {
        const close = closeOf(t, 1, h)
        if (close === t.length - 1) {
          const op = directOp(t, h)
          if (op) {
            if (ADD.has(op.member)) {
              ops.push({ kind: 'add', arr: op.arr, member: op.member, value: op.args[0], guards, seq: seq++, callGuarded })
              if (op.args.length !== 1) return refuse(`\`${op.member}\` with ${op.args.length} arguments`)
            } else if (EVICT.has(op.member)) {
              ops.push({ kind: 'evict', arr: op.arr, member: op.member, guards, seq: seq++, callGuarded })
            } else if (op.arr === name) {
              return refuse(`\`${name}\` is changed by \`${op.member}\``)
            }
            continue
          }
          // A user function or method the array is handed to.
          const m = splitMethodName(word)
          const def = m && fnDefs.has(m.method) && fnDefs.get(m.method).isMethod ? fnDefs.get(m.method)
            : (fnDefs.has(word) && !fnDefs.get(word).isMethod ? fnDefs.get(word) : null)
          if (def && touches) {
            if (depth > 4) return refuse('user functions nested more than four deep')
            if (def.overloaded) return refuse(`\`${def.name}\` is overloaded`)
            const raw = splitArgs(t, 1, h.isPunct) || []
            const args = def.isMethod ? [{ name: null, toks: [{ ...t[0], value: m.recv }] }, ...raw] : raw
            const b = bindArgs(def, args)
            if (b.error) return refuse(`\`${def.name}\`'s arguments (${b.error})`)
            // ⛔ A PARAMETER'S HISTORY IS ITS OWN CALL'S HISTORY. Read unconditionally
            // every bar it equals the argument's; from a guarded call it does not.
            const guarded = callGuarded || guards.length > 0
            if (guarded && readsParamHistory(def, h)) {
              return refuse(`\`${def.name}\` reads a parameter's history and is called under a condition`)
            }
            const { locals } = bodyNames(def, h)
            inlineSeq += 1
            const rw = rewriteBody(def, b.bind, locals, `__uctwin${inlineSeq}`, h, null)
            if (rw.error) return refuse(`\`${def.name}\` is handed \`${name}\` in a form it cannot follow (${rw.error})`)
            collect(rw.stmts, guards, depth + 1, guarded)
            continue
          }
        }
      }
      if (touches) return refuse(`\`${name}\` is used by a statement this reader does not follow (\`${text(t).slice(0, 60)}\`)`)
    }
    return true
  }

  /** `X.m(args)` / `array.m(X, args)` with m an array member → {arr, member, args}. */
  const directOp = (t, hh) => {
    const word = String(t[0].value)
    const raw = splitArgs(t, 1, hh.isPunct) || []
    if (raw.some((a) => a.name !== null)) return null
    if (word.startsWith('array.')) {
      const member = word.slice(6)
      const first = raw[0] && raw[0].toks
      if (!first || first.length !== 1 || first[0].kind !== 'ident') return null
      return { arr: String(first[0].value), member, args: raw.slice(1).map((a) => a.toks) }
    }
    const m = splitMethodName(word)
    if (!m || fnDefs.has(m.method)) return null
    if (!ADD.has(m.method) && !EVICT.has(m.method) && !['set', 'insert', 'remove', 'clear', 'fill',
      'sort', 'reverse', 'concat'].includes(m.method)) return null
    return { arr: m.recv, member: m.method, args: raw.map((a) => a.toks) }
  }
  const evictOf = (t) => {
    if (!t.length || t[0].kind !== 'ident' || !h.isPunct(t[1], '(') || closeOf(t, 1, h) !== t.length - 1) return null
    const op = directOp(t, h)
    return op && EVICT.has(op.member) && !op.args.length ? op : null
  }

  // ── every write, in program order ───────────────────────────────────────
  let firstWriter = -1
  let lastWriter = -1
  let addStmt = null
  for (let i = 0; i < stmts.length && !refused; i += 1) {
    const st = stmts[i]
    if (!writerStmts.has(st) || definitionHeader(st.header || [], h)) continue
    if (firstWriter < 0) firstWriter = i
    lastWriter = i
    const before = ops.length
    collect([st], [], 0, false)
    if (ops.slice(before).some((o) => o.kind === 'add' && o.arr === name)) addStmt = st
  }
  if (refused) return { refused }
  const mine = ops.filter((o) => o.arr === name)
  const adds = mine.filter((o) => o.kind === 'add')
  const evicts = mine.filter((o) => o.kind === 'evict')
  if (adds.length !== 1) return { refused: `\`${name}\` is added to at ${adds.length} places` }
  if (evicts.length !== 1) return { refused: `\`${name}\` is shortened at ${evicts.length} places` }
  const add = adds[0]
  const ev = evicts[0]
  const order = add.member
  if ((order === 'push') !== (ev.member === 'shift')) {
    return { refused: `\`${name}\` adds with \`${add.member}\` and removes with \`${ev.member}\` — not the oldest` }
  }
  if (ev.seq < add.seq) return { refused: `\`${name}\` is shortened before it is added to` }
  let cap = null
  let fixed = false
  if (!ev.size) {
    // (i) the fixed-length window: the removal follows the add under the same conditions.
    if (ev.seq !== add.seq + 1 || text(ev.guards.flat()) !== text(add.guards.flat())) {
      return { refused: `\`${name}\`'s removal is not the step right after its add` }
    }
    if (!(n0 >= 1)) return { refused: `\`${name}\` has no initial length to keep` }
    cap = n0
    fixed = true
  } else {
    // (ii) the bounded window: `if size > K` evicts, on EVERY bar.
    if (ev.guards.length || ev.callGuarded) return { refused: `\`${name}\`'s length check runs only under a condition` }
    if (n0 !== 0) return { refused: `\`${name}\` starts with ${n0} slots and is bounded by its length` }
    if (ev.size.of !== name) {
      // A twin: another array added to under the SAME conditions, from the same size.
      const twinAdds = ops.filter((o) => o.arr === ev.size.of && o.kind === 'add')
      if (twinAdds.length !== 1 || text(twinAdds[0].guards.flat()) !== text(add.guards.flat())
          || twinAdds[0].seq > ev.seq || creationSizeOf(ev.size.of) !== n0) {
        return { refused: `\`${name}\` is shortened by the length of \`${ev.size.of}\`, which is not added to in step with it` }
      }
    }
    cap = ev.size.k
  }
  if (!(cap >= 1) || cap > MAX_WINDOW_CAP) return { refused: `a window of ${cap} slots` }
  return {
    model: {
      name, order, cap, fixed, n0,
      guards: add.guards,
      value: add.value,
      addStmt,
      firstWriter,
      lastWriter,
    },
  }
}

function closeOf(toks, open, h) {
  let depth = 0
  for (let i = open; i < toks.length; i += 1) {
    if (h.isPunct(toks[i], '(') || h.isPunct(toks[i], '[')) depth += 1
    else if (h.isPunct(toks[i], ')') || h.isPunct(toks[i], ']')) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Does the body read `p[n]` of a parameter `p`? */
function readsParamHistory(def, h) {
  const params = new Set(def.params.map((p) => p.name))
  const scan = (list) => (list || []).some((st) => {
    const t = st.header || []
    for (let i = 0; i + 1 < t.length; i += 1) {
      if (t[i].kind === 'ident' && params.has(String(t[i].value)) && h.isPunct(t[i + 1], '[')) return true
    }
    return scan(st.sub)
  })
  return scan(def.body)
}
