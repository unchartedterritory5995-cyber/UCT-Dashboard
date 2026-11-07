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
 *  `:=`); `outer`, the other lists it changes BY NAME (a global the walk may have made an
 *  alias). ⛔ An OVERLOADED name (T9: the body is picked by type, which this reader cannot
 *  see) changes every parameter. */
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
  const visit = (items) => {
    for (const s2 of items || []) {
      const ts = s2.header || []
      for (let i = 0; i < ts.length; i += 1) {
        const t = listMutationTarget(ts, i, rule)
        if (t !== null) {
          let hit = false
          paramRoots.forEach((r, k) => { if (rootedIn(t, r) !== null) { eff.params.add(k); hit = true } })
          if (!hit) eff.outer.add(t)
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
          if (!hit && a.toks.length === 1 && a.toks[0].kind === 'ident') eff.outer.add(String(a.toks[0].value))
        })
      }
      visit(s2.sub)
    }
  }
  visit(def.body)
  return eff
}

/** Members that hand back an ELEMENT of the list they are called on (a record the walk visits). */
const ELEMENT_READS = new Set(['get', 'first', 'last', 'pop', 'shift', 'remove'])

/** Does `toks` read an element of a list in `lists` (`array.get(L, i)`, `L.first()`, …)? */
const readsElementOf = (toks, lists) => toks.some((tk, i) => {
  if (!tk || tk.kind !== 'ident' || !toks[i + 1] || toks[i + 1].kind !== 'punct' || toks[i + 1].value !== '(') return false
  const v = String(tk.value)
  if (v.startsWith('array.') && ELEMENT_READS.has(v.slice(6))) {
    const t = toks[i + 2]
    return !!t && t.kind === 'ident' && lists.has(String(t.value))
  }
  const m = splitMethodName(v)
  return !!m && ELEMENT_READS.has(m.method) && lists.has(m.recv)
})

/** The names a value STORES when it is written somewhere (an argument of a mutator, the
 *  right-hand side of a field write, a constructor's arguments): a plain name stores itself;
 *  `T.new(…)` stores the plain names among its arguments, at any depth; a call to a user
 *  function stores every name it is handed (⛔ undecidable: its body may keep any of them).
 *  An arithmetic expression stores none (it makes a number). */
const storedNames = (toks, fnDefs) => {
  if (toks.length === 1 && toks[0].kind === 'ident') return [String(toks[0].value)]
  const h = toks[0]
  if (!h || h.kind !== 'ident') return []
  const v = String(h.value)
  const m = splitMethodName(v)
  const ctor = v.endsWith('.new') && !v.startsWith('array.') && !v.startsWith('matrix.') && !v.startsWith('map.')
  if (!ctor && !fnDefs.has(v) && !(m && fnDefs.has(m.method))) return []
  return toks.filter((x, k) => x && x.kind === 'ident' && k > 0
    && !(toks[k + 1] && toks[k + 1].kind === 'punct' && toks[k + 1].value === '(')).map((x) => String(x.value))
}

/** ⭐⭐ W6-T6 N1b r1 — REACH, NOT TYPE. The names in the WHOLE script (`stmts`, any depth) that may
 *  carry a record the walk over `src` visits, or a list such a record holds — so that a change
 *  through one of them is a change through the element. A fixpoint over two sets:
 *    · `lists` — names holding the walked list or a list of its records: `src`; `b = src`,
 *      `array.slice(src, …)`, `array.copy(src)`, `src.copy()` (a copy holds the SAME records); a list the
 *      script stores a carried value into (`array.push(other, q)` makes `other` carry it);
 *    · `reach` — the walk variables over `src` (`for q in src`, every such loop); a name bound
 *      to an element read of a `lists` name (`pre = array.get(src, 0).arr`); a name bound to an
 *      expression naming a `reach` name (forward: `a = q.arr`, `b = a`); and BACKWARD, a name a
 *      carried place stores (`array.push(src, Q.new(1.0, vals))`, `q0 = Q.new(…, vals)` where
 *      `q0` is carried, `q.f := vals`): `vals` is now held by a record, whatever its type.
 *  ⛔ Where reach cannot be decided it is assumed: a user function handed (or naming) a carried
 *  value may return or keep it (`v = mk(q)`, `storedNames`); a list a carried value is pushed
 *  into carries it. A list bound to a NEW array, or to anything that names no carried value,
 *  is NOT reached, whatever its declared or inferred type (the accumulator over records that
 *  hold a float list stays served). `src` itself is never in `reach`: changing the walked list
 *  is the walked-list rule's, not this one's. */
export function walkedElementReach(stmts, src, { isPunct, isDefined, fnDefs }) {
  const lists = new Set([src])
  const reach = new Set()
  // a function definition's body is read per call (`fnEffects`, `fnNamesCarried`); its
  // parameters are not the script's names
  const top = (stmts || []).filter((s2) => !(s2.header || []).some((x) => isPunct(x, '=>')))
  const binds = bindingsOf(top, isPunct)
  const rule = { isPunct, isDefined, fnDefs }
  // every `for q in src` / `for [i, q] in src` in the script seeds `reach` with its element
  const seedWalks = (items) => {
    for (const s2 of items || []) {
      const ts = s2.header || []
      if (ts[0] && ts[0].kind === 'ident' && ts[0].value === 'for') {
        const inAt = ts.findIndex((x) => x && x.kind === 'ident' && x.value === 'in')
        const last = ts[ts.length - 1]
        if (inAt > 1 && inAt === ts.length - 2 && last.kind === 'ident' && String(last.value) === src) {
          const el = isPunct(ts[1], '[') ? ts[inAt - 2] : ts[inAt - 1]
          if (el && el.kind === 'ident') reach.add(String(el.value))
        }
      }
      seedWalks(s2.sub)
    }
  }
  seedWalks(top)
  // the user functions whose body (or a callee's) names a carried value: a call may return it
  const fnNamesCarried = (fn, seen = new Set()) => {
    if (seen.has(fn) || !fnDefs.has(fn)) return false
    seen.add(fn)
    const all = new Set([...lists, ...reach])
    const scan = (items) => (items || []).some((s2) => (s2.header || []).some((tk, i, ts) => {
      if (!tk || tk.kind !== 'ident') return false
      if (rootedIn(String(tk.value), all) !== null) return true
      const call = userCallAt(ts, i, rule)
      return !!call && fnNamesCarried(call.fn, seen)
    }) || scan(s2.sub))
    return scan(fnDefs.get(fn).body)
  }
  const callsCarryingFn = (toks) => toks.some((_, i) => {
    const call = userCallAt(toks, i, rule)
    return !!call && fnNamesCarried(call.fn)
  })
  const add = (set, names) => {
    let grew = false
    for (const n of names) if (n !== src && !set.has(n)) { set.add(n); grew = true }
    return grew
  }
  const visitStores = (items) => {
    let grew = false
    for (const s2 of items || []) {
      const ts = s2.header || []
      for (let i = 0; i < ts.length; i += 1) {
        const t = listMutationTarget(ts, i, rule)
        if (t === null) continue
        const close = closeOf(ts, i + 1)
        const argToks = ts.slice(i + 2, close > 0 ? close : ts.length)
        const segs = []
        let cur = []
        let depth = 0
        for (const x of argToks) {
          if (isPunct(x, '(') || isPunct(x, '[')) depth += 1
          else if (isPunct(x, ')') || isPunct(x, ']')) depth -= 1
          if (depth === 0 && isPunct(x, ',')) { segs.push(cur); cur = []; continue }
          cur.push(x)
        }
        if (cur.length) segs.push(cur)
        // the namespace form's first argument is the target itself
        const values = String(ts[i].value).startsWith('array.') ? segs.slice(1) : segs
        const carriedTarget = rootedIn(t, lists) !== null || rootedIn(t, reach) !== null
        for (const seg of values) {
          // a carried place stores this value: it is held by a walked record now
          if (carriedTarget) grew = add(reach, storedNames(seg, fnDefs)) || grew
          // a carried value stored into another list: that list carries it (through a collection)
          if (!carriedTarget && storedNames(seg, fnDefs).some((n) => rootedIn(n, reach) !== null)) {
            grew = add(lists, [t]) || grew
          }
        }
      }
      grew = visitStores(s2.sub) || grew
    }
    return grew
  }
  // a name bound to the walked list itself, or a slice or copy of one (the SAME records)
  const listAlias = (rhs) => {
    if (rhs.length === 1 && rhs[0].kind === 'ident') return lists.has(String(rhs[0].value))
    const h = rhs[0]
    if (!h || h.kind !== 'ident' || !isPunct(rhs[1], '(')) return false
    const v = String(h.value)
    if (v === 'array.slice' || v === 'array.copy') return !!rhs[2] && rhs[2].kind === 'ident' && lists.has(String(rhs[2].value))
    const m = splitMethodName(v)
    return !!m && (m.method === 'slice' || m.method === 'copy') && lists.has(m.recv)
  }
  for (let grew = true; grew;) {
    grew = false
    for (const b of binds) {
      if (listAlias(b.rhs)) { grew = add(lists, b.names) || grew; continue }
      if (isFreshRhs(b.rhs)) continue
      if (readsElementOf(b.rhs, lists) || mentions(b.rhs, reach) || callsCarryingFn(b.rhs)) {
        grew = add(reach, b.names) || grew
      }
      // BACKWARD: a carried name (or a field of one) stores what it is bound to
      if (b.names.some((n) => rootedIn(n, reach) !== null)) grew = add(reach, storedNames(b.rhs, fnDefs)) || grew
    }
    grew = visitStores(top) || grew
  }
  return reach
}

/** ⭐⭐ W6-T6 N1b — THE ONE RULE for "may this walk's body change a list the ELEMENT holds?"
 *  (`for elem in …`). It answers null, or `{ via }` for `forInHeldListRefusal(elem, via)`:
 *    · DIRECT — a mutating member on a path rooted at `elem` (`array.push(q.arr, v)`): `via`
 *      null, N1's sentence;
 *    · AN ALIAS — a mutating member on a name that can CARRY the held list: bound in the body,
 *      through any chain of re-assignments, to an expression that names `elem` (`a = q.arr`,
 *      `b = a`, `o.f := a`), except a NEW array; or one of `rule.outerReach`
 *      (`walkedElementReach`: a name anywhere in the script that reaches a record of the walked
 *      list, or a list one holds, e.g. `vals` after `array.push(qs, Q.new(1.0, vals))`);
 *    · A FUNCTION HANDED IT — a user function, method or helper of a helper (`fnEffects`) that
 *      changes the parameter an argument naming such a value fills, or changes one by name.
 *  ⛔ r1: REACH, NOT TYPE. A list no carried value can reach serves whatever its type (an
 *  accumulator `array<float>` beside records that hold an `array<float>`, a body-local list
 *  built from an unrelated source). Every mutating member counts, the witnessed three included
 *  (no capture shows any change of a list an element holds, W6-F1).
 *  `rule`: `{ isPunct, isDefined, fnDefs, outerReach }`. */
export function heldListReach(list, elem, rule) {
  const { isPunct, outerReach = [] } = rule
  const binds = bindingsOf(list, isPunct)
  const roots = aliasClosure(binds, [elem, ...outerReach])
  const memo = new Map()
  const visit = (items) => {
    for (const s2 of items || []) {
      const ts = s2.header || []
      for (let i = 0; i < ts.length; i += 1) {
        const t = listMutationTarget(ts, i, rule)
        if (t !== null) {
          if (rootedIn(t, [elem]) !== null) return { via: null }
          if (rootedIn(t, roots) !== null) return { via: `through \`${t}\`, an alias of it` }
        }
        const call = userCallAt(ts, i, rule)
        if (!call) continue
        const eff = fnEffects(call.fn, rule, memo)
        for (const n of eff.outer) {
          if (rootedIn(n, roots) !== null) return { via: `through \`${n}\`, an alias of it \`${call.fn}\` changes` }
        }
        const places = placeArgs(rule.fnDefs.get(call.fn), call.args)
        for (let k = 0; k < call.args.length; k += 1) {
          if (!places[k].some((j) => eff.params.has(j))) continue
          if (mentions(call.args[k].toks, roots)) return { via: `handed to \`${call.fn}\`, which changes it` }
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
