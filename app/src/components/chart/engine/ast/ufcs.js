// app/src/components/chart/engine/ast/ufcs.js
//
// ─── ⭐⭐ THE METHOD FORM — `coll.get(i)` IS `array.get(coll, i)` ────────────
//
// Pine allows every namespaced call to be written with its first argument moved
// in front of the dot, and since v5 that spelling is the one most authors use:
//
//     a.size()                 ==  array.size(a)
//     a.get(i)                 ==  array.get(a, i)
//     lines.push(line.new(…))  ==  array.push(lines, line.new(…))
//     b.set_bgcolor(c)         ==  box.set_bgcolor(b, c)
//     t.cell(0, 0, txt)        ==  table.cell(t, 0, 0, txt)
//
// MEASURED over `corpus/committed` (266 scripts): 2,570 method-form sites on a
// DECLARED collection across 37 scripts, and 211 on a DECLARED drawing handle
// across 19 more. It is not an edge spelling; it is the main one.
//
// ⛔⛔ THIS MODULE DECIDES *NOTHING* ABOUT LEGALITY, AND THAT IS THE DESIGN.
// It performs Pine's own definition — move the receiver into argument 0 and
// glue the namespace onto the method — and hands the result to the caller's
// EXISTING roster. `array.get` is then admitted or refused by the same table
// that admits or refuses a hand-written `array.get`, with that table's own
// sentence. A roster here would be a second opinion about which members exist,
// and it would drift from the three that already hold one
// (`lesson_a_second_authority_over_one_value`).
//
// ⛔⛔ AND IT YIELDS TO A USER DEFINITION, WHICH IS NOT OPTIONAL. Pine 6 lets a
// script declare its own methods, and 19 of the 266 committed scripts do:
//
//     method maintainPivot(array<float> srcArray, float value) => …
//     top.maintainPivot(ph)          ← `top` IS a declared array
//
// Rewriting that to `array.maintainPivot(top, ph)` would refuse while naming a
// built-in nobody wrote, sending the member to look for a Pine member that does
// not exist instead of at their own method. Worse in the other direction: a
// script declaring `method get(array<float> this, int i) =>` would have its OWN
// method silently replaced by the built-in — the binding-order defect this
// engine has already paid for four times (`ownSymbolNameOf`, `ownTimeframeOf`,
// `resolveName`, `request.security`). So the caller passes `shadowed`, and a
// name the script defines is never rewritten.
//
// ⛔ THE RECEIVER MUST BE A DECLARED NAME, and THE CALLER DECIDES THAT — this
// function only says where the name ends. `k._box.pop()` and
// `info.retestTimes.size()` lex as ONE dotted ident; `_hline.get(0)` in the
// committed corpus names a user-FUNCTION PARAMETER. A receiver with no
// declaration has no family to read, and the family may never be guessed from
// the method name — `delete` belongs to five object families and `get` to three
// collection ones. Those stay unresolved and are refused/counted by the caller,
// by name, exactly as before.

/** `'coll.get'` → `{ recv: 'coll', method: 'get' }`, splitting at the LAST dot,
 *  or null when there is no receiver or no method.
 *
 *  ⭐⭐ THE LAST DOT, NOT THE FIRST, AND THE DIFFERENCE IS A SILENT DROP.
 *  `z.b.set_bgcolor(c)` — a drawing held in a USER-TYPE FIELD, which is how the
 *  smart-money scripts in the corpus carry a box across bars — split at the
 *  first dot to recv `z`, method `b.set_bgcolor`, and the old
 *  `method.indexOf('.') >= 0` line then threw the whole thing away.
 *
 *  ⚰️ MEASURED: the object pass emitted `["setreg","create"]` where the name
 *  form `box.set_bgcolor(z.b, c)` emits `["setreg","create","update"]` — the
 *  setter GONE — with `unsupported: []` and `droppedOps: 0`. Every diagnostic
 *  counter read zero, so nothing anywhere recorded that a member's line had
 *  been discarded. The only thing between that and a chart was the RUNTIME lane
 *  independently refusing `runtime:expression-statement`, a guard in another
 *  lane catching it by accident — the third time this file's own header records
 *  that same accident.
 *
 *  ⭐ A TWO-SEGMENT NAME IS UNAFFECTED: first dot and last dot are the same dot,
 *  so every existing caller sees byte-identical answers for `array.get`,
 *  `box.set_bgcolor` and the rest. What changes is only names of three segments
 *  or more, all of which previously answered null.
 *
 *  ⛔ AND THE HEAD IS NOT THE RECEIVER — that was the old comment's objection to
 *  reading `a.b.c` at all, and it was right: `a` does not own `c`. `a.b` does.
 *  Splitting at the last dot is what makes the receiver the whole path, so the
 *  op addresses the object the member named rather than the wrong one. */
export function splitMethodName(name) {
  const s = String(name || '')
  const dot = s.lastIndexOf('.')
  if (dot <= 0 || dot === s.length - 1) return null
  return { recv: s.slice(0, dot), method: s.slice(dot + 1) }
}

/**
 * A method-form CALL node → the equivalent namespace-form call node.
 *
 * @param {object}   node       a `{type:'call', name, args, tok}` parse node
 * @param {Function} nsOf       receiver name → its namespace (`'array'`,
 *                              `'map'`, `'matrix'`, `'line'`, `'box'`, …) or
 *                              null when this lane has no declaration for it
 * @param {Function} [shadowed] method name → true when the script DEFINES it
 * @returns {{node:object, ns:string, method:string, recv:string}|null}
 */
export function methodFormCall(node, nsOf, shadowed) {
  if (!node || node.type !== 'call') return null
  const split = splitMethodName(node.name)
  if (!split) return null
  const { recv, method } = split
  if (typeof shadowed === 'function' && shadowed(method)) return null
  const ns = nsOf(recv)
  if (!ns) return null
  // ⭐ THE RECEIVER BECOMES ARGUMENT 0, AS AN UNNAMED ARGUMENT, and it carries
  // the call's own token so every refusal downstream still points at the line
  // the member wrote rather than at a node with no position.
  const recvArg = { name: null, value: { type: 'name', name: recv, tok: node.tok }, tok: node.tok }
  return {
    ns,
    method,
    recv,
    node: {
      ...node,
      type: 'call',
      name: `${ns}.${method}`,
      args: [recvArg, ...(node.args || [])],
    },
  }
}
