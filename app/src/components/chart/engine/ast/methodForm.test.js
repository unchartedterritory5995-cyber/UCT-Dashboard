// app/src/components/chart/engine/ast/methodForm.test.js
//
// ─── ⭐⭐ THE METHOD FORM — `t.cell(…)` IS `table.cell(t, …)` ────────────────
//
// Pine lets every namespaced call move its first argument in front of the dot,
// and since v5 that is the spelling most authors use. This engine had NO support
// for it in any lane. MEASURED over `corpus/committed` (266 scripts):
//
//   2,570 method-form sites on a DECLARED collection, across 37 scripts
//     211 method-form sites on a DECLARED drawing handle, across 19 more
//
// so it is not an edge spelling, it is the main one.
//
// ⛔⛔ THE LOAD-BEARING RAIL IN THIS FILE IS SECTION B, AND IT ASSERTS THE OP
// LIST, NOT THAT SOMETHING COMPILED. `postfixMember.test.js` records what a
// weaker assertion cost: two readers in the object pass recognise a statement by
// its FIRST token and take the first `(` as the whole call, so
// `box.new(…).delete()` emitted the create and dropped the delete WITHOUT A
// WORD — a box that stays on a member's chart forever, drawn by a line their
// script says to remove. Every spelling admitted here is held to "the same ops
// as the name form, byte for byte", which is the only assertion that can see
// that class of defect.
//
// ⚰️ AND THE UNCOUNTED DROP WAS ALREADY HERE. Before this landed,
// `b.set_bgcolor(c)` fell out of the object pass's bare-call block with `ns =
// 'b'` matching nothing: no op, and `objectDiagnostics.unsupported` EMPTY. The
// only thing between that and a member's chart was the RUNTIME lane
// independently refusing the same line `runtime:expression-statement` — a guard
// in another lane catching it by accident. Measured: written as a BINDING
// (`x = b.get_left()`), which that guard does not see, the lane answered OK and
// drew a box whose setter had disappeared. Section C is that half.
//
// ⛔ RULE 5 THROUGHOUT — every coordinate and index below is computed from
// series data. A literal-only fixture folds to a constant and would leave the
// argument and index binding paths completely unrailed, so `set_x2(bar_index)`
// and an index of `close > open ? 0 : 1` are used rather than `set_x2(5)` and
// `0`.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { buildObjectLane } from '../runtime/objectLane.js'

const H5 = '//@version=5\nindicator("t", overlay=true)\n'
const H6 = '//@version=6\nindicator("t", overlay=true)\n'
const BARS = Array.from({ length: 30 }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))

/** ⛔ RULE 5 — an index that cannot fold to a constant. */
const IDX = 'close > open ? 0 : 1'
/** A table declared once, inside the corpus's own `barstate.islast` idiom. */
const T = 'var table t = table.new(position.top_right, 2, 2)\nif barstate.islast\n'
/** A box whose every coordinate is series data. */
const B = 'if close > open\n    b = box.new(bar_index - 2, high, bar_index, low)\n'
/** A collection of lines, with one line pushed into it. */
const MK = 'var line[] ls = array.new_line()\nif barstate.islast\n'
  + '    l = line.new(bar_index - 2, low, bar_index, high)\n'
/** The same collection written with Pine's GENERIC constructor. */
const MKG = 'var ls = array.new<line>()\nif barstate.islast\n'
  + '    l = line.new(bar_index - 2, low, bar_index, high)\n'

const pass = (body, header = H5) => translatePine(header + body, {
  strict: true, objects: true, objectRawTrees: true, objectIterTrees: true,
})
const opsJson = (t) => JSON.stringify((t.objects && t.objects.ops) || null)
const kinds = (t) => ((t.objects && t.objects.ops) || []).map((o) => o.k)
const diag = (t) => t.objectDiagnostics || {}
const lane = (body, header = H5) => buildObjectLane(header + body, {
  bars: BARS, tf: 'D', newestBarIsForming: false,
})
const laneKinds = (r) => (r.ok ? (r.objects.ops || []).map((o) => o.k) : null)

// --------------------------------------------------------------------------- //
// A — the family comes from the DECLARATION
// --------------------------------------------------------------------------- //

describe('⛔⛔ A — the family is read off the declaration, never off the method', () => {
  /** The family the DRAWING will really be made with: the register the delete
   *  addresses, looked up in the converted program's own register table.
   *
   *  ⛔ ASSERTED THROUGH `regs`, NOT OFF THE COLLECTED OP. The conversion drops
   *  `family` from a `delete` and keeps it on the REGISTER the target points at,
   *  which is what `objectRuntime` reads — so reading it anywhere else would be
   *  a rail on a field nothing consumes. */
  const familyOfDelete = (t) => {
    const del = t.objects.ops.find((o) => o.k === 'delete')
    const reg = (t.objects.regs || []).find((r) => r.id === del.target.id)
    return reg && reg.family
  }

  it('`b.delete()` on a declared BOX emits a delete in the box family', () => {
    expect(familyOfDelete(pass(`${B}    b.delete()\nplot(close)`))).toBe('box')
  })

  it('⭐ the SAME method on a declared LINE is the LINE family', () => {
    // ⛔ THE PAIR IS THE POINT. `delete` belongs to line, label, box, table and
    // linefill alike, so a reader that took the family from the method name
    // would answer identically for both of these and be wrong about one. Only
    // the declaration distinguishes them, and only a pair can show that it did.
    const t = pass('if close > open\n    l = line.new(bar_index - 2, low, bar_index, high)\n'
      + '    l.delete()\nplot(close)')
    expect(familyOfDelete(t)).toBe('line')
  })

  it('⛔ CONTROL — an UNDECLARED receiver emits NOTHING and invents no family', () => {
    // `_hline` in `htf-liquidity-dashboard-tfo` is a user-FUNCTION PARAMETER,
    // and `k._box` in `ict-killzones-pivots-tfo` is a field of a user type.
    // Neither has a declaration to read a family off, and the method name may
    // never supply one — so the statement stays unread rather than being aimed
    // at a guess.
    const t = pass(`${B}    whoKnows.delete()\nplot(close)`)
    expect(kinds(t)).not.toContain('delete')
  })
})

// --------------------------------------------------------------------------- //
// B — THE OP LIST, BYTE FOR BYTE (the load-bearing rail)
// --------------------------------------------------------------------------- //

describe('⛔⛔ B — a method form emits the SAME PROGRAM as its name form', () => {
  it('`t.cell(…)` === `table.cell(t, …)`', () => {
    const post = pass(`${T}    t.cell(0, 0, str.tostring(close))\nplot(close)`)
    const name = pass(`${T}    table.cell(t, 0, 0, str.tostring(close))\nplot(close)`)
    expect(opsJson(post)).toBe(opsJson(name))
    expect(kinds(name)).toEqual(['create', 'cell'])
  })

  it('`t.set_bgcolor(c)` === `table.set_bgcolor(t, c)`', () => {
    const post = pass(`${T}    t.set_bgcolor(close > open ? color.lime : color.red)\nplot(close)`)
    const name = pass(`${T}    table.set_bgcolor(t, close > open ? color.lime : color.red)\nplot(close)`)
    expect(opsJson(post)).toBe(opsJson(name))
    expect(kinds(name)).toEqual(['create', 'update'])
  })

  it('`b.set_bgcolor(c)` === `box.set_bgcolor(b, c)`', () => {
    const post = pass(`${B}    b.set_bgcolor(close > open ? color.lime : color.red)\nplot(close)`)
    const name = pass(`${B}    box.set_bgcolor(b, close > open ? color.lime : color.red)\nplot(close)`)
    expect(opsJson(post)).toBe(opsJson(name))
    expect(kinds(name)).toContain('update')
  })

  it('⛔⛔ `b.delete()` === `box.delete(b)` — the op that MUST NOT go missing', () => {
    const post = pass(`${B}    b.delete()\nplot(close)`)
    const name = pass(`${B}    box.delete(b)\nplot(close)`)
    expect(opsJson(post)).toBe(opsJson(name))
    expect(kinds(name)).toContain('delete')
  })

  it('`ls.push(l)` === `array.push(ls, l)`', () => {
    const post = pass(`${MK}    ls.push(l)\nplot(close)`)
    const name = pass(`${MK}    array.push(ls, l)\nplot(close)`)
    expect(opsJson(post)).toBe(opsJson(name))
    expect(kinds(name)).toContain('push')
  })

  it('⭐⭐ the CHAINED form — `ls.get(i).set_x2(n)` === the name form', () => {
    // ⭐ `array.get(ls, i).set_x2(n)` is itself a second spelling, and
    // `postfixMember.test.js` already holds IT to the name form. Pinning this
    // third one to the first makes all three one program rather than a chain of
    // pairwise agreements that can drift in the middle.
    const post = pass(`${MK}    array.push(ls, l)\n    ls.get(${IDX}).set_x2(bar_index)\nplot(close)`)
    const name = pass(`${MK}    array.push(ls, l)\n`
      + `    line.set_x2(array.get(ls, ${IDX}), bar_index)\nplot(close)`)
    expect(opsJson(post)).toBe(opsJson(name))
    expect(kinds(name)).toContain('update')
  })

  it('⛔ AND THE CHAINED TARGET IS A COLLECTION READ WITH A TREE INDEX', () => {
    // Rule 5's other half, the shape `postfixMember.test.js` states for the
    // `array.get` spelling: an index that folded to `{v:'const'}` would address
    // the same line on every bar — a WRONG drawing rather than a missing one,
    // and every assertion above would still pass.
    const t = pass(`${MK}    array.push(ls, l)\n    ls.get(${IDX}).set_x2(bar_index)\nplot(close)`)
    const up = t.objects.ops.find((o) => o.k === 'update')
    expect(up.target.r).toBe('coll')
    expect(up.target.index.v).toBe('tree')
  })

  it('⛔⛔ the GENERIC declaration is the SAME declaration — `array.new<line>()`', () => {
    // ⚰️ Only `array.new_line()` was read, and the corpus prefers the other one:
    // `imbalanceLab = array.new<label>()` (footprint-iq-pro) is the declaration
    // behind the very call sites this lane was opened for. Without this the
    // collection had no `coll` entry and every `imbalanceLab.get(x).set_…()` was
    // unaddressable for a reason that had nothing to do with the method form.
    const generic = pass(`${MKG}    ls.push(l)\n    ls.get(${IDX}).set_x2(bar_index)\nplot(close)`)
    const typed = pass(`${MK}    ls.push(l)\n    ls.get(${IDX}).set_x2(bar_index)\nplot(close)`)
    expect(opsJson(generic)).toBe(opsJson(typed))
    expect(kinds(typed)).toContain('update')
  })
})

// --------------------------------------------------------------------------- //
// C — a drop this reader cannot carry is COUNTED, never silent
// --------------------------------------------------------------------------- //

describe('⛔⛔ C — an unreadable method form is counted by name', () => {
  it('an unknown method on a declared handle is counted, and emits nothing', () => {
    const t = pass(`${B}    b.frobnicate(color.red)\nplot(close)`)
    expect(diag(t).unsupported).toContain('box.frobnicate')
    expect(kinds(t)).not.toContain('update')
  })

  it('⛔ CONTROL — a method it DOES carry is not counted', () => {
    // Without this the assertion above would pass under a rule that counted
    // every method form, which would make the ledger useless for sizing.
    const t = pass(`${B}    b.set_bgcolor(close > open ? color.lime : color.red)\nplot(close)`)
    expect(diag(t).unsupported).not.toContain('box.set_bgcolor')
    expect(kinds(t)).toContain('update')
  })

  it('⛔⛔ a HALF-READ statement is counted — `b.copy().delete()`', () => {
    // The span guard's own case: the first `(` does not close on the last token,
    // so this reader does not read the statement. ⚰️ That is precisely the shape
    // that emitted a lone create and dropped the delete the last time this pass
    // met it, and the answer has to be a COUNTED drop rather than silence.
    const t = pass(`${B}    b.copy().delete()\nplot(close)`)
    expect(diag(t).unsupported).toContain('box.copy')
    expect(kinds(t)).not.toContain('delete')
  })

  it('⛔ `ls.pop().delete()` is counted, never resolved to an element read', () => {
    // `{r:'coll', index}` ADDRESSES an element; `pop` REMOVES one. Resolving
    // `k._box.pop().delete()` (ict-killzones-pivots-tfo L250) to a read would
    // delete the right object and leave the collection holding a handle the
    // script believes it took out.
    const t = pass(`${MK}    array.push(ls, l)\n    ls.pop().delete()\nplot(close)`)
    expect(diag(t).unsupported).toContain('array.pop')
    expect(kinds(t)).not.toContain('delete')
  })

  it('a GETTER is recorded as a getter, never lowered', () => {
    const t = pass(`${B}    b.get_left()\nplot(close)`)
    expect(diag(t).getters).toContain('box.get_left')
    expect(kinds(t)).not.toContain('update')
  })
})

// --------------------------------------------------------------------------- //
// D — the script's OWN method takes the statement back
// --------------------------------------------------------------------------- //

describe('⛔⛔ D — a user definition wins over the method form', () => {
  const DEF = 'method maintainPivot(array<line> srcArray, line value) =>\n'
    + '    array.unshift(srcArray, value)\n'
  const USE = `${MK}    ls.maintainPivot(l)\nplot(close)`

  it('a declared `method` is NOT rewritten into a built-in nobody wrote', () => {
    // ⚰️ `pro-trading-art-double-top-bottom-with-alert` writes exactly this:
    // `method maintainPivot(array<float> srcArray, float value) => …` and then
    // `top.maintainPivot(ph)`, where `top` REALLY IS a declared array. Reporting
    // `array.maintainPivot` would send the member looking for a Pine member that
    // does not exist instead of at their own method.
    const t = pass(DEF + USE, H6)
    expect(diag(t).unsupported).not.toContain('array.maintainPivot')
  })

  it('⛔⛔ AND THE CHAINED FORM YIELDS TOO — the receiver rewrite is not a back door', () => {
    // ⚰️ THE ONLY RAIL ON `ufcs.js`'s OWN `shadowed` PARAMETER, and it was
    // missing: a mutation disabling that check stayed GREEN across 59 cases,
    // because the two other callers each test `defined` themselves before
    // asking. `emitPostfix` does NOT — it hands `isDefined` to `methodFormCall`
    // and trusts it — so without this case the parameter was a guard nobody
    // could demonstrate (`lesson_a_guard_repeated_is_a_guard_unproved`).
    //
    // ⛔ A SCRIPT THAT DEFINES `method get(…)` OWNS `ls.get(i)`. Rewriting it to
    // `array.get(ls, i)` and then addressing the result would aim a setter at
    // whatever the built-in returns, not at what the member's own method does —
    // a wrong drawing, silently, from a name they defined themselves.
    const DEFG = 'method get(array<line> srcArray, int i) =>\n    array.first(srcArray)\n'
    const body = `${MK}    array.push(ls, l)\n    ls.get(${IDX}).set_x2(bar_index)\nplot(close)`
    const shadowed = pass(DEFG + body, H6)
    expect(kinds(shadowed)).not.toContain('update')
  })

  it('⛔ CONTROL — WITHOUT that definition the chained form IS lowered', () => {
    // The pair that makes the case above a measurement: same program, no
    // `method get`, and the update must appear.
    const t = pass(`${MK}    array.push(ls, l)\n    ls.get(${IDX}).set_x2(bar_index)\nplot(close)`, H6)
    expect(kinds(t)).toContain('update')
  })

  it('⛔ CONTROL — WITHOUT the definition the same line IS counted', () => {
    // The control that makes the case above a measurement rather than a
    // tautology: with nothing shadowing it, the rewrite fires and the name is
    // reported, so the assertion above is about the DEFINITION and not about a
    // rule that never counts anything.
    const t = pass(USE, H6)
    expect(diag(t).unsupported).toContain('array.maintainPivot')
  })
})

// --------------------------------------------------------------------------- //
// ⛔⛔ F — THE SILENT WRONG NUMBER (measured on the branch point)
// --------------------------------------------------------------------------- //

describe('⛔⛔ F — a method-form WRITE is a write, and a read never folds past it', () => {
  const PUSH_NAME = 'a = array.new_float(0)\nfor i = 0 to 3\n    array.push(a, close[i])\n'
  const PUSH_UFCS = 'a = array.new_float(0)\nfor i = 0 to 3\n    a.push(close[i])\n'
  const host = (body) => translatePine(H6 + body, { strict: true })

  it('⛔ CONTROL — the NAME form folds the loop and answers 4', () => {
    // Non-vacuity: this is the answer the method form has to be measured
    // against, and it is a real fold rather than a refusal.
    const t = host(`${PUSH_NAME}plot(array.size(a))`)
    expect(t.ok).toBe(true)
    expect(JSON.stringify(t.outputs[0].formula)).toContain('4')
  })

  it('⛔⛔ the METHOD form NEVER answers 0 with no refusal', () => {
    // ⚰️⚰️ MEASURED ON THE BRANCH POINT: it did exactly that. `mutatorTargets`
    // matches the TOKEN `array.push`, the method form arrives as the token
    // `a.push`, so the write was invisible — and the read folded anyway. Same
    // program, two spellings, `4` and `0`, neither refusing. `plot`ting 0 for a
    // loop that pushed four values is the most convincing kind of wrong: there
    // is nothing on screen to say it happened.
    //
    // ⛔ THE ASSERTION IS "NOT A SILENT 0", NOT "EQUALS 4". Opacity is the fix
    // that landed — the array is marked written-by-something-unreadable and the
    // READ refuses by name. Unrolling the method form would answer 4 and is
    // better, but it must first yield to a script's own `method push(…)`, and a
    // wrong unroll is a wrong number where a wrong opacity is only a refusal.
    const t = host(`${PUSH_UFCS}plot(array.size(a))`)
    if (t.ok) expect(JSON.stringify(t.outputs[0].formula)).not.toBe('"0"')
    else expect(t.refusal.guard).toBe('pine:collection')
  })

  it('⛔ and the refusal NAMES THE ARRAY, not the line that read it', () => {
    const t = host(`${PUSH_UFCS}plot(array.size(a))`)
    expect(t.ok).toBe(false)
    expect(t.refusal.message).toContain('`a`')
  })

  it('⛔ CONTROL — adding the method-form clause did not break the NAME form', () => {
    // ⭐ WHAT THIS ACTUALLY PROVES, stated precisely because the obvious reading
    // is wrong: the new clause in `mutatorTargets` runs over EVERY dotted call,
    // including `array.push(a, x)` itself, and this asserts it did not make the
    // name form opaque on the way past. That is a real regression guard.
    //
    // ⚠️ IT IS NOT A PROOF THAT THE NAMESPACE EXCLUSION IS LIVE, and an earlier
    // draft of this comment claimed it was. Deleting
    // `!PINE_MEMBER_NAMESPACES.has(...)` leaves this case GREEN — measured — and
    // no fixture can turn it red, because a Pine script cannot bind `array`,
    // `table`, `matrix`, `map` or `linefill` for the extra entry to collide
    // with. The exclusion is kept as stated intent and is recorded in `pine.js`
    // as undemonstrable rather than counted as a guard here.
    const t = host(`${PUSH_NAME}plot(array.size(a))`)
    expect(t.ok).toBe(true)
  })
})

// --------------------------------------------------------------------------- //
// E — the LANE gives both spellings the same verdict, end to end
// --------------------------------------------------------------------------- //

describe('⭐⭐ E — one Pine operation, one verdict, whichever spelling', () => {
  it('⛔ CONTROL — the NAME form draws end to end, so the pairs below are not vacuous', () => {
    const r = lane(`${T}    table.cell(t, 0, 0, str.tostring(close))\nplot(close)`)
    expect(r.ok).toBe(true)
    expect(laneKinds(r)).toEqual(['create', 'cell'])
  })

  it('⛔⛔ and so does `t.cell(…)` — the SAME ops', () => {
    // ⚰️ Measured before this landed: this refused `runtime:expression-statement`
    // while the line above compiled and drew. One Pine operation, two verdicts,
    // decided by which spelling the author happened to use.
    const post = lane(`${T}    t.cell(0, 0, str.tostring(close))\nplot(close)`)
    const name = lane(`${T}    table.cell(t, 0, 0, str.tostring(close))\nplot(close)`)
    expect(post.ok).toBe(true)
    expect(laneKinds(post)).toEqual(laneKinds(name))
  })

  it('`b.delete()` reaches the lane with its delete intact', () => {
    const post = lane(`${B}    b.delete()\nplot(close)`)
    const name = lane(`${B}    box.delete(b)\nplot(close)`)
    expect(post.ok).toBe(true)
    expect(laneKinds(post)).toEqual(laneKinds(name))
    expect(laneKinds(post)).toContain('delete')
  })

  it('⛔ a method form nobody owns the drawing for still refuses BY NAME', () => {
    // ⭐ `buildRuntimeIr` WITHOUT `objectTrees` is the value runtime asked on its
    // own, and a drawing statement is not its business in either spelling. The
    // refusal must NAME the canonical operation — `box.delete` — because that is
    // the thing this lane does not do; `b.delete` names a variable.
    const r = buildRuntimeIr(`${H5}${B}    b.delete()\nplot(close)`, { bars: BARS, inputs: {} })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:object-op')
    expect(r.refusal.message).toContain('box.delete')
  })

  it('⛔ CONTROL — the NAME form refuses identically without ownership', () => {
    const r = buildRuntimeIr(`${H5}${B}    box.delete(b)\nplot(close)`, { bars: BARS, inputs: {} })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:object-op')
  })

  it('⛔ a collection method form routes through the ONE array admitter', () => {
    // `a.push(x)` IS `array.push(a, x)`, and it must be admitted by the same
    // table — same arity check, same void rule — as the hand-written form.
    const post = buildRuntimeIr(`${H6}a = array.new_float(0)\na.push(close)\nplot(a.get(0))`,
      { bars: BARS, inputs: {} })
    const name = buildRuntimeIr(`${H6}a = array.new_float(0)\narray.push(a, close)\nplot(array.get(a, 0))`,
      { bars: BARS, inputs: {} })
    expect(name.ok).toBe(true)
    expect(post.ok).toBe(true)
  })

  it('⭐⭐ a method-form READ compiles to the SAME IR as the name form', () => {
    // ⛔ THE SAME PROGRAM, NOT TWO PROGRAMS THAT BOTH COMPILE. `a.size()` and
    // `array.size(a)` are one Pine operation; two IRs would mean two lowering
    // paths, and two lowering paths drift.
    //
    // ⚰️ Before this landed the method form was routed to the COLUMNAR lane —
    // the route test walks `name` nodes and a method form's receiver arrives
    // glued into the CALL NAME — and refused `pine:builtin`, *"the engine
    // grammar does not hold `a.size`"*: false twice over, since `a.size` is not
    // a built-in and `array.size` is a thing this lane holds. 839 `.size()` and
    // 815 `.get()` sites on a declared collection across the committed corpus
    // were written the losing way.
    // ⛔ RULE 5 — the value pushed is series data, so nothing folds away.
    const body = (read) => `${H6}a = array.new_float(0)\narray.push(a, close)\nplot(${read})`
    const post = buildRuntimeIr(body('a.size()'), { bars: BARS, inputs: {} })
    const name = buildRuntimeIr(body('array.size(a)'), { bars: BARS, inputs: {} })
    expect(name.ok).toBe(true)
    expect(post.ok).toBe(true)
    expect(JSON.stringify(post.ir)).toBe(JSON.stringify(name.ir))
  })

  it('⛔ AND WITH A COMPUTED INDEX — the argument path is railed too', () => {
    // ⛔ RULE 5. `a.get(0)` folds its index to a constant and leaves the
    // argument-binding path completely unrailed; this index cannot fold.
    const body = (read) => `${H6}a = array.new_float(4, 0.0)\nplot(${read})`
    const post = buildRuntimeIr(body('a.get(close > open ? 0 : 1)'), { bars: BARS, inputs: {} })
    const name = buildRuntimeIr(body('array.get(a, close > open ? 0 : 1)'), { bars: BARS, inputs: {} })
    expect(name.ok).toBe(true)
    expect(JSON.stringify(post.ir)).toBe(JSON.stringify(name.ir))
  })

  it('⛔ and an array method the runtime does NOT hold refuses `runtime:array`', () => {
    // Not `runtime:expression-statement` — "an expression evaluated for effect"
    // is true of the line and says nothing. The member needs the name of the
    // collection operation this runtime has no answer for.
    const r = buildRuntimeIr(`${H6}a = array.new_float(0)\na.reverse()\nplot(array.size(a))`,
      { bars: BARS, inputs: {} })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:array')
    expect(r.refusal.message).toContain('array.reverse')
  })
})

// --------------------------------------------------------------------------- //
// G — the receiver is a UDT FIELD PATH, not a bare name
// --------------------------------------------------------------------------- //

/** A UDT holding one box, instantiated once, its field assigned a real box.
 *
 *  ⛔ RULE 5 — every coordinate is series data, so nothing folds to a constant.
 *  ⭐ The field is assigned with `:=` on a `var` instance, which is how the
 *  smart-money scripts in the corpus actually carry a drawing across bars. */
const Z = 'type Zone\n    box b\n\nvar Zone z = Zone.new(na)\nif close > open\n'
  + '    z.b := box.new(bar_index - 2, high, bar_index, low)\n'

describe('⛔⛔ G — a method form on a UDT FIELD is the same op as the name form', () => {
  it('⭐⭐ `z.b.set_bgcolor(c)` === `box.set_bgcolor(z.b, c)`', () => {
    // ⚰️ MEASURED BEFORE THE FIX: the NAME form already worked — `z.b` lexes as
    // one ident, so the declaration collector registers it and `targetRef`
    // resolves it as an ordinary register. The METHOD form died one layer
    // earlier, in `splitMethodName`, which split at the FIRST dot and then
    // refused any method still carrying one: `z.b.set_bgcolor` came back as
    // recv `z`, method `b.set_bgcolor`, and was rejected outright.
    //
    // ⛔ SO THE OBJECT PASS EMITTED NOTHING AND COUNTED NOTHING. The only thing
    // between that and a member's chart was the RUNTIME lane independently
    // refusing the line `runtime:expression-statement` — the same accidental
    // catch this file's header records, in another lane, one more time.
    expect(opsJson(pass(`${Z}    z.b.set_bgcolor(color.red)\n`)))
      .toBe(opsJson(pass(`${Z}    box.set_bgcolor(z.b, color.red)\n`)))
  })

  it('⛔⛔ `z.b.delete()` === `box.delete(z.b)` — the op that MUST NOT go missing', () => {
    expect(opsJson(pass(`${Z}    z.b.delete()\n`)))
      .toBe(opsJson(pass(`${Z}    box.delete(z.b)\n`)))
  })

  it('⭐ a coordinate setter carrying series data — `z.b.set_right(bar_index)`', () => {
    expect(opsJson(pass(`${Z}    z.b.set_right(bar_index)\n`)))
      .toBe(opsJson(pass(`${Z}    box.set_right(z.b, bar_index)\n`)))
  })

  it('⛔ CONTROL — the name form was ALREADY working, so the test above can fail', () => {
    // ⭐⭐ WITHOUT THIS THE SECTION IS VACUOUS. Both sides of an equality that
    // compares two EMPTY op lists pass, and would have passed before the fix.
    // This pins that the right-hand side of every comparison above is a real
    // program, so an equality here means "the method form reached it" rather
    // than "neither form emitted anything".
    const namedForm = pass(`${Z}    box.set_bgcolor(z.b, color.red)\n`)
    expect(kinds(namedForm)).toEqual(['setreg', 'create', 'update'])
  })

  it('⛔ CONTROL — an UNDECLARED field path emits NOTHING and invents no family', () => {
    // A last-dot split hands `nothing.here` to the declaration lookup, which
    // must answer null rather than inventing a family out of the method name.
    const t = pass(`${H5}if close > open\n    nothing.here.set_bgcolor(color.red)\n`.slice(H5.length))
    expect(kinds(t)).toEqual([])
    expect(diag(t).unsupported || []).toEqual([])
  })

  it('⛔⛔ CONTROL — a prototype reach is still refused, not read as a field path', () => {
    // `close.constructor.constructor` IS `Function`. Splitting at the last dot
    // makes it LOOK like a field path with method `constructor`; the escape
    // census credits `canonicalise:member` with catching this, and that guard
    // lives in another layer that this change must not route around.
    const r = lane(`${H6}plot(close.constructor.constructor)\n`.slice(H6.length), H6)
    expect(r.ok).toBe(false)
  })
})
