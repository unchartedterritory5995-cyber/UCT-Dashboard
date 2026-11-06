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
/** ⛔ W6-T6 review N1 — a COLLECTION HELD IN A FIELD changed by a mutating member
 *  (`array.push(p.arr, x)`, `p.arr.push(x)`): the call at `toks[i]` changes the list named by a
 *  DOTTED path, and this answers that path, else null. Inside a walk over `p` that is a write
 *  through the element, which no capture shows (W6-F1), so the runtime lane refuses it by name
 *  (`forInHeldListRefusal`). Every mutating member counts, the witnessed three included: the
 *  capture shows them on the walked list, not on a list an element holds. */
export function heldListMutation(toks, i, { isPunct, isDefined }) {
  const tk = toks[i]
  if (!tk || tk.kind !== 'ident' || !isPunct(toks[i + 1], '(')) return null
  const v = String(tk.value)
  if (v.startsWith('array.') && COLLECTION_MUTATORS.has(v.slice(6))) {
    const t = toks[i + 2]
    return t && t.kind === 'ident' && String(t.value).includes('.') ? String(t.value) : null
  }
  const m = splitMethodName(v)
  return m && m.recv.includes('.') && COLLECTION_MUTATORS.has(m.method) && !isDefined(m.method) ? m.recv : null
}

/** The refusal for a list held by the loop element and changed in the body (or by a helper). */
export const forInHeldListRefusal = (elem) => (
  `the body changes a list the element \`${elem}\` holds (a write through the loop variable), not yet captured (W6-F1)`)

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
