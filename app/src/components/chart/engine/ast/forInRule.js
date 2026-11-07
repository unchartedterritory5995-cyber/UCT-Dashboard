// app/src/components/chart/engine/ast/forInRule.js
//
// ⭐⭐ W6-T6 — THE `for … in` WALK RULE, ONE TABLE FOR BOTH LANES.
//
// Two lanes walk `for x in <collection>`: the HOST object lane (`pineObjects.js`, C40 / C48)
// and the RUNTIME lane (`pineRuntimeFrontend.js` → `lowerIr.js` STMT.FOR `live`). What a walk
// sees when its body changes the collection is a TradingView rule, witnessed once, and it is
// written HERE ONCE; both lanes import it (W6-BREAKDOWN §3 rule 5). The index walk itself is
// written twice (one per lane) and both are railed against the same capture.
//
// ⭐ THE WITNESS — `vw-forin-collections-rddt-1d-2026-10-01`
// (`tools/visual_conformance/probes/vw-forin-collections.pine`, NYSE:RDDT 1D from the listing):
//   · `for x in <own list>` walks the LIVE list: the length is re-read before every pass and
//     the slot is read when the pass reaches it — F03 (the body shifts: 3 passes over five),
//     F04 (the body pushes ten: 13 passes), F05 (a later slot replaced by `set`: the pass is
//     handed the replacement);
//   · `<family>.all` is a SNAPSHOT taken when it is read — A02 (the held array stays 5 long
//     after a delete), A04 / A05 (`for b in box.all → box.delete(b)`: one pass per box, none
//     left), A06 (positions 0, 1, 2, oldest first).
// ⛔ Every other change of the walked list (`remove`, `pop`, `unshift`, `insert`, `clear`, a
// reassignment, a helper handed the list) is captured (`vw-forin-collections-2-…`, G01-G07)
// but UNGRADED, so both lanes refuse it by name (`forInMutationRefusal`).
import { splitMethodName } from './ufcs.js'

/** `<family>.all` sources a walk takes as a SNAPSHOT (A02-A06 witness `box.all`; the host
 *  lane serves the three families under this one rule). `polyline.all` is not here: no
 *  capture shows it (W6-F1). */
export const FOR_IN_SNAPSHOT_SOURCES = Object.freeze({ 'line.all': 'line', 'box.all': 'box', 'label.all': 'label' })

/** ⭐ C48 — the ways a body may change the list it walks that a capture shows (F03 / F04 /
 *  F05). ⛔ Insertion order is the sentence's order (`forInMutationRefusal`). */
export const FOR_IN_LIVE_WITNESSED = Object.freeze(new Set(['push', 'shift', 'set']))

/** ⭐ C11b — every operator that REASSIGNS an existing name (Pine reference). */
export const REASSIGN_OPS = Object.freeze(new Set([':=', '+=', '-=', '*=', '/=', '%=']))

/** ⭐ C16 — every array method that CHANGES the array (Pine reference). */
export const COLLECTION_MUTATORS = Object.freeze(new Set(['push', 'set', 'remove', 'clear', 'pop', 'shift',
  'unshift', 'insert', 'reverse', 'sort', 'fill', 'concat']))

/** The refusal both lanes give a body that changes its list by anything not witnessed. */
export const forInMutationRefusal = (src) => (
  `the body changes \`${src}\`, the list it walks, by more than ${[...FOR_IN_LIVE_WITNESSED].join(' / ')}`)

/** Does this statement list (at any depth, and through any user function it calls) change
 *  the list `name` — a mutating member, a reassignment, or a user function that is handed
 *  it or names it? `allowed`: mutating members that do not count (the question becomes "by
 *  anything ELSE?"). The lane supplies its own readers:
 *    · `isPunct(tok, v)`;
 *    · `isDefined(name)` — the script defines a function of that name (a defined method
 *      shadows the collection member, `ufcs.js`);
 *    · `fnDefs` — `readFunctionDefs` (`objectFnInline.js`): name → `{ body }`. */
/** The list a collection-mutating call at `toks[i]` changes (`array.push(L, …)`, `L.push(…)`;
 *  every member of `COLLECTION_MUTATORS`), else null. A script's own method of that name
 *  shadows the member (`ufcs.js`), so that is a user call, not a change. */
export function listMutationTarget(toks, i, { isPunct, isDefined }) {
  const tk = toks[i]
  if (!tk || tk.kind !== 'ident' || !isPunct(toks[i + 1], '(')) return null
  const v = String(tk.value)
  if (v.startsWith('array.') && COLLECTION_MUTATORS.has(v.slice(6))) {
    const t = toks[i + 2]
    return t && t.kind === 'ident' ? String(t.value) : null
  }
  const m = splitMethodName(v)
  return m && COLLECTION_MUTATORS.has(m.method) && !isDefined(m.method) ? m.recv : null
}

/** ⛔ W6-T6 review N1 — a COLLECTION HELD IN A FIELD changed by a mutating member
 *  (`array.push(p.arr, x)`, `p.arr.push(x)`): the call at `toks[i]` changes the list named by a
 *  DOTTED path, and this answers that path, else null. Inside a walk over `p` that is a write
 *  through the element, which no capture shows (W6-F1), so the runtime lane refuses it by name
 *  (`forInHeldListRefusal`). Every mutating member counts, the witnessed three included: the
 *  capture shows them on the walked list, not on a list an element holds. */
export function heldListMutation(toks, i, rule) {
  const t = listMutationTarget(toks, i, rule)
  return t !== null && t.includes('.') ? t : null
}

/** The refusal for a list held by the loop element and changed in the body (or by a helper).
 *  `via` (W6-T6 N1b) names an INDIRECT route (an alias, a function handed the list, a list of
 *  a type the element holds); without it the sentence is N1's (a dotted write through `elem`). */
export const forInHeldListRefusal = (elem, via = null) => (via === null
  ? `the body changes a list the element \`${elem}\` holds (a write through the loop variable), not yet captured (W6-F1)`
  : `the body changes a list the element \`${elem}\` may hold (${via}), not yet captured (W6-F1)`)

/** The root of `roots` the name `v` (plain, dotted, or a method token `v.m`) starts at, or null. */
const rootedIn = (v, roots) => {
  for (const r of roots) if (v === r || v.startsWith(`${r}.`)) return r
  return null
}
const mentions = (toks, roots) => toks.some((x) => x && x.kind === 'ident' && rootedIn(String(x.value), roots) !== null)

/** Every binding a statement list makes, at any depth: `[var] [type] n = rhs`, `n := rhs`,
 *  `o.f := rhs`, `[a, b] = rhs` → `{ names, op, rhs }`. */
const bindingsOf = (list, isPunct, out = []) => {
  for (const s2 of list || []) {
    const ts = s2.header || []
    let depth = 0
    let at = -1
    for (let k = 0; k < ts.length; k += 1) {
      const tk = ts[k]
      if (isPunct(tk, '(') || isPunct(tk, '[')) depth += 1
      else if (isPunct(tk, ')') || isPunct(tk, ']')) depth -= 1
      else if (depth === 0 && (isPunct(tk, '=') || isPunct(tk, ':='))) { at = k; break }
    }
    if (at > 0) {
      const names = isPunct(ts[0], '[')
        ? ts.slice(1, at).filter((x) => x && x.kind === 'ident').map((x) => String(x.value))
        : (ts[at - 1] && ts[at - 1].kind === 'ident' ? [String(ts[at - 1].value)] : [])
      out.push({ names, op: ts[at].value, rhs: ts.slice(at + 1) })
    }
    bindingsOf(s2.sub, isPunct, out)
  }
  return out
}

/** A right-hand side (or argument) that is ONE call making a NEW array (`array.new*`,
 *  `array.from`, `array.copy`). ⛔ Not `x.copy()`: on a record that is a SHALLOW copy whose
 *  fields are the same lists. */
const isFreshRhs = (rhs) => {
  const h = rhs[0]
  if (!h || h.kind !== 'ident' || !/^array\.(new(_[a-z]+)?|from|copy)$/.test(String(h.value))) return false
  const open = rhs.findIndex((x) => x && x.kind === 'punct' && x.value === '(')
  return open > 0 && closeOf(rhs, open) === rhs.length - 1
}

/** `seeds` and every name bound (at any depth, through any chain of re-assignments) to an
 *  expression that names one of them, except a NEW array. Conservative: `n = s.arr.size()`
 *  joins too, harmlessly (a number is never a list a mutator changes). */
const aliasClosure = (binds, seeds) => {
  const roots = new Set(seeds)
  for (let grew = true; grew;) {
    grew = false
    for (const b of binds) {
      if (isFreshRhs(b.rhs) || !mentions(b.rhs, roots)) continue
      for (const n of b.names) if (!roots.has(n)) { roots.add(n); grew = true }
    }
  }
  return roots
}

/** The user function a call token names (`f(…)`, `recv.m(…)`) and its arguments, the receiver
 *  first in the method form: `{ fn, args: [{ name, toks }] }`, else null. */
const userCallAt = (toks, i, { isPunct, fnDefs }) => {
  const tk = toks[i]
  if (!tk || tk.kind !== 'ident' || !isPunct(toks[i + 1], '(')) return null
  const v = String(tk.value)
  const m = splitMethodName(v)
  const fn = fnDefs.has(v) ? v : (m && fnDefs.has(m.method) ? m.method : null)
  if (!fn) return null
  const close = closeOf(toks, i + 1)
  const end = close > 0 ? close : toks.length
  const segs = []
  let cur = []
  let depth = 0
  for (let k = i + 2; k < end; k += 1) {
    const x = toks[k]
    if (isPunct(x, '(') || isPunct(x, '[')) depth += 1
    else if (isPunct(x, ')') || isPunct(x, ']')) depth -= 1
    if (depth === 0 && isPunct(x, ',')) { segs.push(cur); cur = []; continue }
    cur.push(x)
  }
  if (cur.length) segs.push(cur)
  const args = segs.map((seg) => (seg[0] && seg[0].kind === 'ident' && isPunct(seg[1], '=')
    ? { name: String(seg[0].value), toks: seg.slice(2) } : { name: null, toks: seg }))
  if (fn !== v) args.unshift({ name: null, toks: [{ kind: 'ident', value: m.recv }] })
  return { fn, args }
}

/** The parameter positions each argument fills: a named one by its name, else by position.
 *  ⛔ An argument this cannot place fills EVERY position. */
const placeArgs = (def, args) => args.map((a, k) => {
  if (a.name === null) return [k]
  const at = def.params.findIndex((p) => p.name === a.name)
  return at >= 0 ? [at] : def.params.map((_, j) => j)
})

/** ⭐ N1b — what a user function (and every user function it calls) may CHANGE: `params`, the
 *  positions of its parameters whose list it changes (directly, through a local alias, by
 *  handing it on to a function that changes it, or by storing it into an outer name with
 *  `:=`); `outer`, the other lists it changes by name (`'?'`: one it cannot name). A list it
 *  binds to a NEW array (and never re-binds) is its own. ⛔ An OVERLOADED name (T9: the body
 *  is picked by type, which this reader cannot see) changes every parameter. */
function fnEffects(fn, rule, memo) {
  if (memo.has(fn)) return memo.get(fn)
  const eff = { params: new Set(), outer: new Set() }
  memo.set(fn, eff)
  const def = rule.fnDefs.get(fn)
  if (!def) return eff
  if (def.overloaded) def.params.forEach((_, k) => eff.params.add(k))
  const binds = bindingsOf(def.body, rule.isPunct)
  const paramRoots = def.params.map((p) => aliasClosure(binds, [p.name]))
  const declared = new Set(binds.filter((b) => b.op === '=').flatMap((b) => b.names))
  for (const b of binds) {
    if (b.op !== ':=' || isFreshRhs(b.rhs)) continue
    if (b.names.some((n) => !declared.has(n.split('.')[0]))) {
      paramRoots.forEach((r, k) => { if (mentions(b.rhs, r)) eff.params.add(k) })
    }
  }
  const own = (t) => {
    const bs = binds.filter((b) => b.names.includes(t))
    return bs.length > 0 && bs.every((b) => isFreshRhs(b.rhs))
  }
  const visit = (items) => {
    for (const s2 of items || []) {
      const ts = s2.header || []
      for (let i = 0; i < ts.length; i += 1) {
        const t = listMutationTarget(ts, i, rule)
        if (t !== null) {
          let hit = false
          paramRoots.forEach((r, k) => { if (rootedIn(t, r) !== null) { eff.params.add(k); hit = true } })
          if (!hit && !own(t)) eff.outer.add(t)
        }
        const call = userCallAt(ts, i, rule)
        if (!call) continue
        const sub = fnEffects(call.fn, rule, memo)
        for (const n of sub.outer) eff.outer.add(n)
        const places = placeArgs(rule.fnDefs.get(call.fn), call.args)
        call.args.forEach((a, k) => {
          if (!places[k].some((j) => sub.params.has(j))) return
          let hit = false
          paramRoots.forEach((r, j) => { if (mentions(a.toks, r)) { eff.params.add(j); hit = true } })
          if (hit || isFreshRhs(a.toks)) return
          const name = a.toks.length === 1 && a.toks[0].kind === 'ident' ? String(a.toks[0].value) : '?'
          if (!own(name)) eff.outer.add(name)
        })
      }
      visit(s2.sub)
    }
  }
  visit(def.body)
  return eff
}

/** ⭐⭐ W6-T6 N1b — THE ONE RULE for "may this walk's body change a list the ELEMENT holds?"
 *  (`for elem in …`). It answers null, or `{ via }` for `forInHeldListRefusal(elem, via)`:
 *    · DIRECT — a mutating member on a path rooted at `elem` (`array.push(q.arr, v)`): `via`
 *      null, N1's sentence;
 *    · AN ALIAS — a mutating member on a name bound, through any chain of re-assignments, to
 *      an expression that names `elem` (`a = q.arr`, `b = a`, `o.f := a`), except a NEW array;
 *    · A FUNCTION HANDED IT — a user function, method or helper of a helper (`fnEffects`) that
 *      changes the parameter an argument naming `elem` or an alias fills, or changes by name
 *      an outer list that is an alias;
 *    · ⛔ A LIST OF A TYPE THE ELEMENT HOLDS — `rule.mayBeHeld(name)`, the lane's own typing
 *      (the element's record type holds a list of that type, or the name cannot be typed). A
 *      list bound BEFORE the walk may be the same array, and no name ties it to `elem`, so
 *      only its type can rule it out. A body-local name is followed through its plain
 *      re-assignment chain to the name it copies; a NEW array is its own.
 *  Every mutating member counts, the witnessed three included (no capture shows any change of
 *  a list an element holds, W6-F1). `rule`: `{ isPunct, isDefined, fnDefs, mayBeHeld }`
 *  (`mayBeHeld` null: the element holds no list, and the type route is off). */
export function heldListReach(list, elem, rule) {
  const { isPunct, mayBeHeld = null } = rule
  const binds = bindingsOf(list, isPunct)
  const roots = aliasClosure(binds, [elem])
  const memo = new Map()
  const seen = new Set()
  // ⛔ conservative: a name is held unless EVERY binding of it in the body is a NEW array or a
  // plain name that is not held; one never bound with `=` keeps its value from before the walk.
  const typedHeld = (t) => {
    if (!mayBeHeld) return false
    if (t === '?') return true
    if (seen.has(t)) return false
    seen.add(t)
    try {
      const bs = binds.filter((b) => b.names.includes(t))
      if (!bs.some((b) => b.op === '=') && mayBeHeld(t)) return true
      return bs.some((b) => {
        if (isFreshRhs(b.rhs)) return false
        if (b.rhs.length === 1 && b.rhs[0].kind === 'ident') return typedHeld(String(b.rhs[0].value))
        return true
      })
    } finally { seen.delete(t) }
  }
  const visit = (items) => {
    for (const s2 of items || []) {
      const ts = s2.header || []
      for (let i = 0; i < ts.length; i += 1) {
        const t = listMutationTarget(ts, i, rule)
        if (t !== null) {
          if (rootedIn(t, [elem]) !== null) return { via: null }
          if (rootedIn(t, roots) !== null) return { via: `through \`${t}\`, an alias of it` }
          if (typedHeld(t)) return { via: `through \`${t}\`, a list of a type it holds` }
        }
        const call = userCallAt(ts, i, rule)
        if (!call) continue
        const eff = fnEffects(call.fn, rule, memo)
        for (const n of eff.outer) {
          if (rootedIn(n, roots) !== null) return { via: `through \`${n}\`, an alias of it \`${call.fn}\` changes` }
          if (typedHeld(n)) return { via: `through \`${n}\`, a list of a type it holds, which \`${call.fn}\` changes` }
        }
        const places = placeArgs(rule.fnDefs.get(call.fn), call.args)
        for (let k = 0; k < call.args.length; k += 1) {
          if (!places[k].some((j) => eff.params.has(j))) continue
          const a = call.args[k].toks
          if (mentions(a, roots)) return { via: `handed to \`${call.fn}\`, which changes it` }
          if (isFreshRhs(a)) continue
          if (typedHeld(a.length === 1 && a[0].kind === 'ident' ? String(a[0].value) : '?')) {
            return { via: `handed to \`${call.fn}\` as a list of a type it holds` }
          }
        }
      }
      const deeper = visit(s2.sub)
      if (deeper) return deeper
    }
    return null
  }
  return visit(list)
}

/** The index closing the bracket opened at `open`, or -1. */
const closeOf = (toks, open) => {
  let depth = 0
  for (let i = open; i < toks.length; i += 1) {
    const tk = toks[i]
    if (tk.kind !== 'punct') continue
    if (tk.value === '(' || tk.value === '[') depth += 1
    else if (tk.value === ')' || tk.value === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

export function bodyMayWriteList(list, name, { allowed = null, isPunct, isDefined, fnDefs }) {
  const seenFns = new Set()
  let scan = null
  const scanToks = (toks) => {
    for (let i = 0; i < toks.length; i += 1) {
      const tk = toks[i]
      if (!tk || tk.kind !== 'ident') continue
      const v = String(tk.value)
      const nx = toks[i + 1]
      if (v === name && nx && nx.kind === 'punct' && (nx.value === '=' || REASSIGN_OPS.has(nx.value))) return true
      if (v.startsWith('array.') && COLLECTION_MUTATORS.has(v.slice(6)) && isPunct(nx, '(')
          && toks[i + 2] && toks[i + 2].kind === 'ident' && String(toks[i + 2].value) === name) {
        if (allowed && allowed.has(v.slice(6))) continue
        return true
      }
      const m = splitMethodName(v)
      if (m && m.recv === name && COLLECTION_MUTATORS.has(m.method) && !isDefined(m.method)) {
        if (allowed && allowed.has(m.method)) continue
        return true
      }
      const fn = fnDefs.has(v) ? v : (m && fnDefs.has(m.method) ? m.method : null)
      if (!fn || !isPunct(nx, '(')) continue
      const close = closeOf(toks, i + 1)
      const args = close > 0 ? toks.slice(i + 2, close) : toks.slice(i + 2)
      if ((m && m.recv === name) || args.some((x) => x.kind === 'ident' && String(x.value).split('.')[0] === name)) return true
      if (!seenFns.has(fn)) {
        seenFns.add(fn)
        if (scan(fnDefs.get(fn).body)) return true
      }
    }
    return false
  }
  scan = (items) => (items || []).some((s2) => scanToks(s2.header || []) || scan(s2.sub))
  return scan(list)
}
