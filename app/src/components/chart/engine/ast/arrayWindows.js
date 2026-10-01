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
// a second push site, `set`, `insert`, `clear`, a cap the caller cannot settle
// before the chart runs, a write inside a loop, a function that reads a
// parameter's history from a conditional call — is refused with a reason, and
// the array keeps the refusal it always had.
//
// ⭐⭐ C22 — AND WHERE EACH READ STANDS (trend-duration-forecast-chartprime):
//
//     if trend != trend[1]
//         if trend
//             bearishCount.push(TrendCount)
//             TrendUP := label.new(…, bullishCount.avg() …)   ← reads the OTHER one
//         else
//             bullishCount.push(TrendCount)
//             TrendDN := label.new(…, bearishCount.avg() …)
//     …
//     if bullishCount.size() > samples                       ← an input cap
//         bullishCount.shift()
//
//   * an add may sit in any arm of an `if … else if … else` chain: its guard
//     is the arm's condition beside the negation of every earlier arm's;
//   * a statement that only READS the array inside a writing statement is
//     recorded where it stands (`readsInWriters`). The caller serves a read
//     in an arm that EXCLUDES the add's arm — it runs only on bars without an
//     add, where the window is last bar's, which is this model — and a read
//     AFTER the last writing statement; every other read is refused where it
//     stands, by name (`pine.js::windowReadVerdict`), never the whole window;
//   * the cap may be a name the caller settles before the chart (`h.capOf`).
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
/** A window wider than this is refused: its reads are unrolled per slot.
 *  ⭐⭐ C32 — except its LENGTH, which is one `valuewhen` (the cap-th most
 *  recent add exists) and unrolls nothing: such a window is modelled
 *  `sizeOnly`, every other read of it refused by name. The cap is unchanged. */
export const MAX_WINDOW_CAP = 64

const text = (toks) => toks.map((t) => String(t.value)).join(' ')
const headOf = (v) => String(v).split('.')[0]
const mentionsToks = (toks, name) => (toks || []).some((t) => t.kind === 'ident'
  && (String(t.value) === name || headOf(t.value) === name))
const mentions = (st, name) => mentionsToks(st.header, name) || mentionsToks(st.body, name)
  || (st.sub || []).some((s) => mentions(s, name))

/** `X.size() > K` / `array.size(X) > K` / `K < X.size()` → `{of, k}` or null.
 *
 *  ⭐⭐ C22 — `K` may also be a NAME the caller settles before the chart runs
 *  (`h.capOf`: an input the member door gives no knob, read at the value the
 *  member's chart runs — trend-duration's `samples`), answered `{of, k,
 *  capInput}`; a name the caller cannot settle answers `{of, refused}`. */
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
  const named = (side) => (side.length === 1 && side[0].kind === 'ident' && h.capOf ? h.capOf(side[0]) : null)
  const settle = (of, got) => (!got ? null
    : got.refused ? { of, refused: got.refused }
      : { of, k: got.k, capInput: got.name })
  if (op === '>' && sizeOf(left)) return settle(sizeOf(left), named(right))
  if (op === '<' && sizeOf(right)) return settle(sizeOf(right), named(left))
  return null
}

/** `[from, to]` — the first and last token index a statement (its header, its
 *  body, every nested statement) covers. */
export function spanOf(st) {
  let from = Infinity
  let to = -Infinity
  const visit = (s) => {
    for (const t of [...(s.header || []), ...(s.body || [])]) {
      if (t && Number.isFinite(t.index)) { if (t.index < from) from = t.index; if (t.index > to) to = t.index }
    }
    for (const c of s.sub || []) visit(c)
  }
  visit(st)
  return { from, to }
}

/** The names a statement's header assigns (`x = …`, `x := …`, `x += …`,
 *  `var x = …`, `[a, b] = …`). */
function assignedBy(t, h) {
  const out = []
  const at = (i) => t[i] && t[i].kind === 'ident' ? String(t[i].value) : null
  let i = 0
  while (at(i) === 'var' || at(i) === 'varip' || (i < 2 && at(i) && t[i + 1] && t[i + 1].kind === 'ident'
      && !(t[i + 1].value === 'if'))) {
    // `var`, `varip` and a leading type word (`float x = …`, `var float x = …`)
    if (at(i) === 'var' || at(i) === 'varip' || (t[i + 1] && t[i + 1].kind === 'ident')) i += 1
    else break
  }
  const name = at(i)
  const next = t[i + 1]
  if (name && next && next.kind === 'punct' && ['=', ':=', '+=', '-=', '*=', '/=', '%='].includes(next.value)) out.push(name)
  if (t[0] && h.isPunct(t[0], '[')) {
    const close = t.findIndex((x) => h.isPunct(x, ']'))
    if (close > 0 && t[close + 1] && h.isPunct(t[close + 1], '=')) {
      for (const x of t.slice(1, close)) if (x.kind === 'ident') out.push(String(x.value))
    }
  }
  return out
}

/** A condition Pine's `if` takes the `else` of — `na` included — as a guard:
 *  `((na(c) ? 0 : (c)) ? 0 : 1)`, built on the `else` token's own position. */
function negatedGuard(cond, at) {
  const T = (kind, value) => ({ kind, value, line: at.line, column: at.column, index: at.index })
  const P = (v) => T('punct', v)
  return [P('('), P('('), T('ident', 'na'), P('('), ...cond, P(')'), P('?'), T('number', 0), P(':'),
    P('('), ...cond, P(')'), P(')'), P('?'), T('number', 0), P(':'), T('number', 1), P(')')]
}

/** Does a statement WRITE `name` anywhere — a mutating member, a reassignment,
 *  or a user function/method it is handed (which may write it)? */
const MUTATING = new Set(['push', 'unshift', 'pop', 'shift', 'set', 'insert', 'remove', 'clear', 'fill',
  'sort', 'reverse', 'concat'])
function writesName(st, name, fnDefs, h) {
  const toks = [...(st.header || []), ...(st.body || [])]
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]
    if (t.kind !== 'ident') continue
    const v = String(t.value)
    const m = splitMethodName(v)
    if (m && m.recv === name && (MUTATING.has(m.method) || fnDefs.has(m.method))) return true
    if (v.startsWith('array.') && MUTATING.has(v.slice(6)) && h.isPunct(toks[i + 1], '(')
        && toks[i + 2] && toks[i + 2].kind === 'ident' && String(toks[i + 2].value) === name) return true
    if (v === name && toks[i + 1] && toks[i + 1].kind === 'punct' && [':=', '='].includes(toks[i + 1].value)) return true
    // handed to a user function: `f(name)` / `f(…, name, …)`
    if (fnDefs.has(v) && h.isPunct(toks[i + 1], '(')) {
      const close = closeOf(toks, i + 1, h)
      if (toks.slice(i + 2, close).some((x) => x.kind === 'ident' && String(x.value) === name)) return true
    }
  }
  return (st.sub || []).some((s) => writesName(s, name, fnDefs, h))
}

/** ⭐ C22 — the statements of `stmts` that write `name` (a mutating member, a
 *  reassignment, or a helper defined in `defStmts` it is handed to). The
 *  caller's writer set for a window declared inside a drawing function's body,
 *  where the top level's `arrayWritesByName` never looked. */
export function windowWriterStatements(stmts, name, defStmts, h) {
  const fnDefs = readFunctionDefs(defStmts || stmts, h)
  // its own `var name = array.new_…()` declaration is the creation, not a write
  const isDecl = (t) => t[0] && t[0].kind === 'ident' && (t[0].value === 'var' || t[0].value === 'varip')
    && t.some((x, i) => x.kind === 'ident' && String(x.value) === name && h.isPunct(t[i + 1], '='))
  return (stmts || []).filter((st) => !definitionHeader(st.header || [], h) && !isDecl(st.header || [])
    && writesName(st, name, fnDefs, h))
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
export function seriesWindowOf({ stmts, name, writerStmts, n0, h, creationSizeOf, defStmts = null }) {
  // ⭐ C22 — a window declared INSIDE a drawing function (`defStmts`: the
  // script's top level, where the helpers it hands the array to are defined).
  const fnDefs = readFunctionDefs(defStmts || stmts, h)
  const ops = []            // every add/evict, on ANY array, in program order
  let refused = null
  let seq = 0
  /** ⭐ C22 — program order over every add, removal AND read (`seq` counts
   *  writes only: the fixed window's "removal right after the add" reads it). */
  let ord = 0
  let inlineSeq = 0
  const refuse = (why) => { if (!refused) refused = why; return false }
  /** ⭐ C22 — the statements that only READ `name` inside a statement that
   *  writes it: `{from, to, line, path}` (see `path` below). */
  const readSites = []
  /** Names the writer statement has assigned so far, in program order — a
   *  nested condition or an added value that reads one would be resolved at
   *  the statement's START (`w.env`), before the write it follows. */
  const written = new Set()
  let chainSeq = 0
  /** ⭐ C22 — a condition that reads `name` is a READ, placed where it runs:
   *  after every earlier arm's condition and before its own arm's body
   *  (`path` ends `{chain, arm, cond: true}`, see `excludes`). One that writes
   *  it, or reads a name its own statement changed above it, refuses. */
  const conditionOk = (cond, condPath) => {
    if (mentionsToks(cond, name)) {
      if (writesName({ header: cond, body: [], sub: [] }, name, fnDefs, h)) {
        return refuse(`\`${name}\` is changed inside a condition (\`${text(cond)}\`)`)
      }
      const idx = cond.map((x) => x.index).filter(Number.isFinite)
      readSites.push({ from: Math.min(...idx), to: Math.max(...idx), line: cond[0] && cond[0].line, path: condPath, ord: ord++ })
    }
    return true
  }

  /** One statement list, under `guards` (token lists), at call depth `depth`.
   *  ⭐ C22 — `path` is the list of if-chain arms the list sits in
   *  (`{chain, arm}`), so a read can be proved to sit in an arm the add's arm
   *  EXCLUDES: two arms of one chain never run on the same bar. */
  const collect = (list, guards, depth, callGuarded, path = []) => {
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
        // An eviction guard: a length check whose body ONLY evicts. ⭐ C22 — a
        // length check whose body does something else is an ordinary `if` (a
        // drawing guarded by another window's `size() > 0`), read below.
        // ⭐ C22 — `array.pop(zzP), array.pop(zzL)` on one line is two removals.
        const evictBody = splitCommaStatements(st.sub || [], h)
        if (sg && evictBody.length && evictBody.every((s2) => evictOf(s2.header || []))) {
          if (sg.refused) return refuse(sg.refused)
          for (const s2 of evictBody) {
            const e = evictOf(s2.header || [])
            ops.push({ kind: 'evict', arr: e.arr, member: e.member, guards, size: sg, seq: seq++, ord: ord++, callGuarded, path })
          }
          const next = items[i + 1]
          if (next && next.header && next.header[0] && next.header[0].value === 'else') {
            return refuse('an eviction guard with an `else`')
          }
          continue
        }
        if (sg && evictBody.some((s2) => evictOf(s2.header || []))) {
          return refuse(`the block under \`${text(cond)}\` does more than evict`)
        }
        const chain = (chainSeq += 1)
        if (!conditionOk(cond, [...path, { chain, arm: 0, cond: true }])) return false
        // ⭐⭐ C22 — THE WHOLE `if … else if … else` CHAIN. Each arm runs under its
        // own condition beside the NEGATION of every earlier arm's (an `if` whose
        // condition is `na` takes the `else`, as Pine reads it: `negatedGuard`).
        // ⚰️ An `else` that touched the array used to refuse the whole window —
        // trend-duration adds to `bullishCount` in the `else` of `if trend`.
        // ⭐ C22 — a condition that reads a name its own statement changed above
        // it would be read at the statement's START (`w.env`), before that
        // change: refused — but only where it GUARDS an add or a removal. A
        // condition over nothing this window keeps (vdubus's `if isHS →
        // shouldDraw := true`) changes nothing the model reads.
        const readsWritten = (c) => [...written].some((w) => mentionsToks(c, w))
        const guardedWrite = (c, from) => {
          if (ops.length > from) return refuse(`a condition (\`${text(c)}\`) reads a name its own statement changed above it`)
          return true
        }
        const prior = [cond]
        const priorW = [readsWritten(cond)]
        let opsFrom = ops.length
        collect(st.sub || [], [...guards, cond], depth, callGuarded, [...path, { chain, arm: 0 }])
        if (priorW[0] && !guardedWrite(cond, opsFrom)) return false
        let arm = 0
        while (!refused && items[i + 1] && items[i + 1].header && items[i + 1].header[0]
            && items[i + 1].header[0].kind === 'ident' && items[i + 1].header[0].value === 'else') {
          i += 1
          arm += 1
          const et = items[i].header
          const negs = prior.map((c) => negatedGuard(c, et[0]))
          if (et[1] && et[1].kind === 'ident' && et[1].value === 'if') {
            const c2 = et.slice(2)
            if (sizeGuardOf(c2, h) && (items[i].sub || []).some((s2) => evictOf(s2.header || []))) {
              return refuse('an eviction guard inside an `else`')
            }
            if (!conditionOk(c2, [...path, { chain, arm, cond: true }])) return false
            const c2W = readsWritten(c2)
            opsFrom = ops.length
            collect(items[i].sub || [], [...guards, ...negs, c2], depth, callGuarded, [...path, { chain, arm }])
            if ((c2W || priorW.some(Boolean)) && !guardedWrite(c2W ? c2 : prior[priorW.indexOf(true)], opsFrom)) return false
            prior.push(c2)
            priorW.push(c2W)
          } else {
            opsFrom = ops.length
            collect(items[i].sub || [], [...guards, ...negs], depth, callGuarded, [...path, { chain, arm }])
            if (priorW.some(Boolean) && !guardedWrite(prior[priorW.indexOf(true)], opsFrom)) return false
            break
          }
        }
        continue
      }
      if (word === 'else') return refuse('an `else` with no `if` this reader followed')
      // ⭐⭐ C40 — THE CAP WRITTEN AS A `while`: `while a.size() > K` whose body
      // ONLY evicts. It is the eviction guard above, repeated until the length
      // fits — and this model adds at most one element on a bar it serves (a
      // bar two adds may run on is the ambiguous `doubles` bar, withheld), so
      // the loop runs at most one pass there: the same window, the same cap.
      // Each eviction is then held to the `if` form's own rules below (its
      // guard must measure the array it shortens; one eviction per add).
      // ⛔ Anything else inside a `while` keeps the refusal below.
      if (word === 'while') {
        const cond = t.slice(1)
        const sg = sizeGuardOf(cond, h)
        const evictBody = splitCommaStatements(st.sub || [], h)
        const evs = evictBody.map((s2) => ((s2.sub || []).length ? null : evictOf(s2.header || [])))
        if (sg && evs.length && evs.every(Boolean)) {
          if (sg.refused) return refuse(sg.refused)
          for (const e of evs) {
            ops.push({ kind: 'evict', arr: e.arr, member: e.member, guards, size: sg, seq: seq++, ord: ord++, callGuarded, path })
          }
          continue
        }
      }
      if (word === 'for' || word === 'while' || word === 'switch') {
        if (touches) return refuse(`\`${name}\` is written inside \`${word}\``)
        continue
      }
      // ⭐⭐ C22 — A STATEMENT THAT ONLY READS the array inside a statement that
      // writes it is recorded where it stands (its tokens and its arm path), and
      // served only where that proves exact (`readVerdict`) — never refused
      // wholesale for existing.
      const callStmt = !!word && h.isPunct(t[1], '(') && closeOf(t, 1, h) === t.length - 1
      if (touches && !(callStmt && directOp(t, h)) && !writesName(st, name, fnDefs, h)) {
        const sp = spanOf(st)
        readSites.push({ from: sp.from, to: sp.to, line: t[0].line, path, ord: ord++ })
        for (const w of assignedBy(t, h)) written.add(w)
        continue
      }
      for (const w of assignedBy(t, h)) written.add(w)
      if (word && h.isPunct(t[1], '(')) {
        const close = closeOf(t, 1, h)
        if (close === t.length - 1) {
          const op = directOp(t, h)
          if (op) {
            if (ADD.has(op.member)) {
              if (op.arr === name && [...written].some((w) => mentionsToks(op.args[0] || [], w))) {
                return refuse(`the value added (\`${text(op.args[0] || []).slice(0, 40)}\`) reads a name its own statement changed above it`)
              }
              ops.push({ kind: 'add', arr: op.arr, member: op.member, value: op.args[0], guards, seq: seq++, ord: ord++, callGuarded, path })
              if (op.args.length !== 1) return refuse(`\`${op.member}\` with ${op.args.length} arguments`)
            } else if (EVICT.has(op.member)) {
              ops.push({ kind: 'evict', arr: op.arr, member: op.member, guards, seq: seq++, ord: ord++, callGuarded, path })
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
            collect(rw.stmts, guards, depth + 1, guarded, path)
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
  let addSpan = null
  /** ⭐ C22 — every top-level statement group holding an add, its head index. */
  const addSpans = []
  let firstAddHead = -1
  // ⭐ C22 — a top-level `if … else if … else` chain is several statements in
  // `stmts`, one per arm; it is ONE statement of Pine's, read whole from its
  // `if` (an arm's guard is the negation of the arms above it).
  const isElse = (s) => !!(s && s.header && s.header[0] && s.header[0].kind === 'ident' && s.header[0].value === 'else')
  const done = new Set()
  for (let i = 0; i < stmts.length && !refused; i += 1) {
    const st = stmts[i]
    if (!writerStmts.has(st) || definitionHeader(st.header || [], h)) continue
    let head = i
    while (head > 0 && isElse(stmts[head])) head -= 1
    let tail = head
    while (isElse(stmts[tail + 1])) tail += 1
    if (done.has(head)) continue
    done.add(head)
    const group = stmts.slice(head, tail + 1)
    if (firstWriter < 0) firstWriter = head
    lastWriter = tail
    const before = ops.length
    const readsBefore = readSites.length
    written.clear()
    collect(group, [], 0, false)
    for (const o of ops.slice(before)) o.head = head
    if (ops.slice(before).some((o) => o.kind === 'add' && o.arr === name)) {
      const spans = group.map(spanOf)
      const sp = { from: Math.min(...spans.map((x) => x.from)), to: Math.max(...spans.map((x) => x.to)) }
      addSpans.push(sp)
      // the FIRST add group's start is where the model's scope is taken
      if (firstAddHead < 0) { firstAddHead = head; addStmt = stmts[head]; addSpan = sp }
    }
    for (const r of readSites.slice(readsBefore)) r.stmt = stmts[head]
  }
  if (refused) return { refused }
  const mine = ops.filter((o) => o.arr === name)
  const adds = mine.filter((o) => o.kind === 'add')
  const evicts = mine.filter((o) => o.kind === 'evict')
  // ⭐⭐ C22 — SEVERAL ADD SITES, or a removal that sits in its add's own arm
  // (`if not na(ph) → unshift; if size() > 10 → pop`), take the general model.
  if (adds.length > 1 || (adds.length === 1 && evicts.length === 1 && evicts[0].size
      && (evicts[0].guards.length || evicts[0].callGuarded))) {
    return multiSiteWindow({ name, n0, adds, evicts, ops, readSites, addStmt, addSpan, addSpans,
      firstWriter, lastWriter, firstAddHead, stmts, h, creationSizeOf })
  }
  if (adds.length !== 1) return { refused: `\`${name}\` is added to at ${adds.length} places` }
  if (evicts.length !== 1) return { refused: `\`${name}\` is shortened at ${evicts.length} places` }
  const add = adds[0]
  const ev = evicts[0]
  if (add.guards.some((g) => mentionsToks(g, name))) {
    return { refused: `\`${name}\` is added to under a condition that reads it` }
  }
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
  if (!(cap >= 1)) return { refused: `a window of ${cap} slots` }
  // ⭐⭐ C22 — WHERE A READ INSIDE A WRITING STATEMENT MAY BE SERVED. The model
  // above is the window as the BAR leaves it. A read in an arm of an if-chain
  // that EXCLUDES the add's arm runs only on bars where the add did not, so
  // the window there is last bar's — which is exactly this model on a bar
  // without an add (and the removal that follows cannot fire: nothing grew).
  // Any other read inside a writing statement is refused where it stands.
  // Two arms of one chain never run on the same bar — except that a later
  // arm's CONDITION runs on every bar an earlier arm did not, so a condition
  // read (`cond`) excludes only an add in an EARLIER arm.
  const inWriters = readSites.map((r) => ({
    from: r.from, to: r.to, line: r.line,
    exclusive: r.stmt === addStmt && excludes(r.path, add.path || []),
  }))
  return {
    model: {
      name, order, cap, fixed, n0,
      guards: add.guards,
      value: add.value,
      addStmt,
      addSpan,
      firstWriter,
      lastWriter,
      readsInWriters: inWriters,
      capInput: (ev.size && ev.size.capInput) || null,
      sizeOnly: cap > MAX_WINDOW_CAP,
    },
  }
}

/** ⭐ C22 — can the statement at arm path `a` never run on a bar the one at
 *  `b` runs? Two arms of one chain never run together — except that a later
 *  arm's CONDITION runs on every bar an earlier arm did not, so a condition
 *  read (`cond`) excludes only something in an EARLIER arm. */
function excludes(a, b) {
  for (let k = 0; k < Math.min(a.length, b.length); k += 1) {
    if (a[k].chain !== b[k].chain) return false
    if (a[k].arm !== b[k].arm) return a[k].cond ? a[k].arm > b[k].arm : true
    if (a[k].cond) return false
  }
  return false
}

/**
 * ⭐⭐ C22 — A WINDOW ADDED TO AT SEVERAL PLACES, OR SHORTENED IN ITS ADD'S OWN
 * ARM (vdubus-pattern-gen's zigzag, one per `f_runEngine` call):
 *
 *     if not na(ph)
 *         array.unshift(zzP, ph)
 *         if array.size(zzP) > 10
 *             array.pop(zzP), array.pop(zzL)
 *         if array.size(zzP) >= 5 …   ← reads the window its own arm just wrote
 *     if not na(pl)
 *         array.unshift(zzP, pl)
 *         …
 *
 * Pine runs the statements in order, so on a bar both conditions hold the
 * window gains TWO elements, the second newer. The model stays a one-element-
 * per-bar series: slot j is `ta.valuewhen(c₁ or c₂, c₂ ? v₂ : v₁, j)` — exact
 * on every bar at most one add runs. A bar two may run on is AMBIGUOUS
 * (`doubles`): every read is registered with the ambiguity "one of the last
 * `cap` events was a double" and the steps it reaches are withheld there, never
 * drawn off one element short.
 *
 * ⛔ Each add owns a length check right after it, under the same conditions,
 * with one cap — or one shared check after every add, on every bar. Anything
 * else refuses by name. A read inside a writing statement is exact where every
 * add that may run on its bar has run, with its removal, before it — or cannot
 * run on the bar it does (`served`).
 */
function multiSiteWindow({ name, n0, adds, evicts, ops, readSites, addStmt, addSpan, addSpans,
  firstWriter, lastWriter, firstAddHead, stmts, h, creationSizeOf }) {
  if (adds.some((a) => a.guards.some((g) => mentionsToks(g, name)))) {
    return { refused: `\`${name}\` is added to under a condition that reads it` }
  }
  const order = adds[0].member
  if (adds.some((a) => a.member !== order)) {
    return { refused: `\`${name}\` is added to with both \`push\` and \`unshift\`` }
  }
  if (n0 !== 0) return { refused: `\`${name}\` starts with ${n0} slots and is added to at ${adds.length} places` }
  const evictOf = new Map()
  const shared = evicts.length === 1 && !evicts[0].guards.length && !evicts[0].callGuarded ? evicts[0] : null
  if (shared) {
    if (!shared.size) return { refused: `\`${name}\`'s removal is not a length check` }
    if (adds.some((a) => a.ord > shared.ord)) return { refused: `\`${name}\` is added to after it is shortened` }
    for (const a of adds) evictOf.set(a, shared)
  } else {
    if (evicts.length !== adds.length) {
      return { refused: `\`${name}\` is added to at ${adds.length} places and shortened at ${evicts.length}` }
    }
    const mine = [...adds, ...evicts].sort((x, y) => x.ord - y.ord)
    for (let k = 0; k < mine.length; k += 1) {
      const a = mine[k]
      if (a.kind !== 'add') continue
      const e = mine[k + 1]
      if (!e || e.kind !== 'evict' || !e.size || e.callGuarded !== a.callGuarded
          || text(e.guards.flat()) !== text(a.guards.flat())) {
        return { refused: `\`${name}\`'s length check is not the step after each add, under the same conditions` }
      }
      evictOf.set(a, e)
    }
  }
  for (const [a, e] of evictOf) {
    if ((a.member === 'push') !== (e.member === 'shift')) {
      return { refused: `\`${name}\` adds with \`${a.member}\` and removes with \`${e.member}\` — not the oldest` }
    }
  }
  const caps = new Set([...evictOf.values()].map((e) => e.size.k))
  if (caps.size !== 1) return { refused: `\`${name}\` is kept to different lengths at different places` }
  const cap = [...caps][0]
  if (!(cap >= 1)) return { refused: `a window of ${cap} slots` }
  for (const e of new Set(evictOf.values())) {
    if (e.size.of === name) continue
    // A twin: another array added to at the same places, in step, from the same size.
    const twin = ops.filter((o) => o.arr === e.size.of && o.kind === 'add')
    const inStep = twin.length === adds.length && adds.every((a) => twin.some((t) => t.head === a.head
      && text(t.guards.flat()) === text(a.guards.flat()) && t.ord < evictOf.get(a).ord))
    if (!inStep || creationSizeOf(e.size.of) !== n0) {
      return { refused: `\`${name}\` is shortened by the length of \`${e.size.of}\`, which is not added to in step with it` }
    }
  }
  // Every add's condition and value are read in the scope the FIRST add's
  // statement started in (the caller's `addStmt`): a later statement's add
  // must not read a name a statement between the two changes.
  const assignedIn = (list, out) => {
    for (const st of list || []) { for (const w of assignedBy(st.header || [], h)) out.add(w); assignedIn(st.sub, out) }
    return out
  }
  for (const a of adds) {
    if (a.head === firstAddHead) continue
    const between = assignedIn(stmts.slice(firstAddHead, a.head), new Set())
    const hit = [...between].find((w) => mentionsToks([...a.guards.flat(), ...(a.value || [])], w))
    if (hit) {
      return { refused: `\`${name}\` is added to under \`${hit}\`, which a statement between its add sites changes` }
    }
  }
  let doubles = false
  for (let i = 0; i < adds.length; i += 1) {
    for (let j = i + 1; j < adds.length; j += 1) {
      if (!excludes(adds[i].path || [], adds[j].path || []) && !excludes(adds[j].path || [], adds[i].path || [])) doubles = true
    }
  }
  // A read nested in an add's own block, after that add and its removal, runs
  // only on bars that add ran: any LATER add that runs with it makes the bar a
  // double (ambiguous, withheld), so on every other bar it sees the model.
  const within = (r, a) => {
    const ap = a.path || []
    const rp = r.path || []
    return ap.length <= rp.length && ap.every((x, k) => rp[k].chain === x.chain && rp[k].arm === x.arm && !rp[k].cond)
  }
  const done = (a, r) => a.ord < r.ord && evictOf.get(a).ord < r.ord
  const served = (r) => {
    const anchored = doubles && adds.some((a) => done(a, r) && within(r, a))
    return adds.every((a) => excludes(r.path || [], a.path || []) || done(a, r) || anchored)
  }
  const capE = [...evictOf.values()].find((e) => e.size.capInput)
  return {
    model: {
      name, order, cap, fixed: false, n0,
      guards: adds[0].guards,
      value: adds[0].value,
      sites: adds.map((a) => ({ guards: a.guards, value: a.value })),
      doubles,
      addStmt,
      addSpan,
      addSpans,
      firstWriter,
      lastWriter,
      readsInWriters: readSites.map((r) => ({ from: r.from, to: r.to, line: r.line, exclusive: false, served: served(r) })),
      capInput: capE ? capE.size.capInput : null,
      sizeOnly: cap > MAX_WINDOW_CAP,
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
