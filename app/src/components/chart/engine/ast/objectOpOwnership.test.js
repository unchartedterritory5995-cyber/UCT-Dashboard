// app/src/components/chart/engine/ast/objectOpOwnership.test.js
//
// ─── ⛔⛔ `runtime:object-op` IS A QUESTION ABOUT THE CALLER, NOT THE SCRIPT ──
//
// The runtime-lane corpus census reports **12 scripts** whose first blocker is
// `runtime:object-op` — `label.new`, `box.new`, `label.delete`, `line.delete`,
// `table.new`. Read as a work queue that says "teach the value runtime to
// draw", which is the one thing this lane must never learn.
//
// ⭐⭐ MEASURED 2026-09-21: ELEVEN OF THE TWELVE MOVE OFF IT THE MOMENT THE
// CALLER SAYS IT OWNS THE DRAWING, and FOUR of them then compile END TO END
// (`4c-nyse-market-breadth-ratio`, `camarilla-screener`,
// `extrapolated-pivot-connector`, `parabolic-sar`). Those eleven are a property
// of the HARNESS — a two-lane pipeline asked with one lane — and not of the
// corpus. `buildObjectLane` already declares ownership on every call.
//
// ⛔ SO THE REFUSAL HAS TO SAY SO. Its sentence was true and incomplete: *"a
// graphical-object operation — these belong to the object program, not the
// value runtime"*. That is a statement about the LANE, and it sends the reader
// to implement drawing in the value runtime. The missing half is a statement
// about the CALL: nobody said who owns the drawing, and saying so is one
// argument away.
//
// ⚰️ STRUCK 2026-09-22: *"THE ONE GENUINELY MISSING CAPABILITY IS PINNED HERE
// TOO — a drawing call used as a VALUE (`array.push(labels, label.new(…))`) is
// refused even under ownership, deliberately, because there is no honest number
// to return for a drawing handle."* It was the twelfth script,
// `liquidity-levels-sonarlab` @L170, and it is **CLOSED**. The premise was that
// the value lane has no representation for a drawing handle; `runtime/handles.js`
// gives it one — opaque, `kindOf`-named `'drawing'`, never a number and never
// `na` — so a create written at a position the OBJECT PASS collects one from
// now lowers to that handle and the two lanes compose. The synthetic shape
// DRAWS end to end (`runtime/__tests__/drawingAsValue.test.js`).
//
// ⭐⭐ WHAT REPLACED IT AS THE SHAPE THAT STILL REFUSES UNDER OWNERSHIP IS A
// DIFFERENT CAPABILITY, and the survivor moved straight onto it: READING a
// drawing (`line.get_y1(l)`) in a value position. Holding a handle and
// answering a number ABOUT the drawing are not the same thing, and this lane
// has neither the drawing nor an honest number — `liquidity-levels-sonarlab`
// is now @L100, not @L170. That refusal is the one the control below pins, and
// it must still NOT carry the ownership hint: pointing its reader at the seam
// would send them where the fix is not.
//
// ⚠️ ONE SHAPE IS STILL MISFILED AND IS NOT FIXED HERE, recorded rather than
// hidden: a drawing bound to a PLAIN name and used later
// (`nl = cond ? line.new(…) : na` … `array.push(rays, nl)`, the shape
// `rsi-horizontal-resistance-levels` @L26 writes) is refused by the COLUMNAR
// lane at `pine:drawing`, because `holdsObjectCall` tests the SUBTREE and that
// subtree is a bare name. `holdsArray` resolves such a name through `env` and
// this could too — but `holdsObjectCall` also decides the ownership SKIP at
// three declaration branches, so widening it changes what gets skipped, and
// that is a separate change with its own cases to write.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from './pineRuntimeFrontend.js'

const N = 3
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const head = '//@version=6\nindicator("t")\n'

/** ⛔ `objectTrees` IS THE OWNERSHIP DECLARATION, and an EMPTY ARRAY still
 *  declares it — a drawing whose coordinates are all literals references no
 *  trees at all. `Array.isArray([])`, never `.length`. */
const build = (src, owned) => buildRuntimeIr(head + src, {
  bars: BARS, inputs: {}, ...(owned ? { objectTrees: [] } : {}),
})

/** The statement shapes the census's eight scripts actually die on, one per
 *  name, written the way the corpus writes them. */
const STATEMENTS = {
  'label.new': 'label.new(bar_index, close, "x")',
  'box.new': 'box.new(bar_index, high, bar_index, low)',
  'line.new': 'line.new(bar_index, low, bar_index, high)',
  'table.new': 'table.new(position.top_right, 1, 1)',
  'label.delete': 'var label lb = na\nlabel.delete(lb)',
  'line.delete': 'var line ln = na\nline.delete(ln)',
  'box.delete': 'var box bx = na\nbox.delete(bx)',
}

describe('⛔⛔ a drawing STATEMENT is refused only when nobody claims the drawing', () => {
  it('⛔ without ownership every one of them refuses at `runtime:object-op`', () => {
    for (const [name, stmt] of Object.entries(STATEMENTS)) {
      const b = build(`${stmt}\nplot(close)`, false)
      expect(b.ok, name).toBe(false)
      expect(b.refusal.guard, name).toBe('runtime:object-op')
    }
  })

  it('⭐⭐ WITH ownership every one of them BUILDS — the statement is skipped', () => {
    // ⛔ THIS IS THE LOAD-BEARING CASE. If it ever goes red, the census's
    // `runtime:object-op` row has become a real work queue again and the eight
    // scripts behind it are genuinely blocked rather than merely unasked.
    for (const [name, stmt] of Object.entries(STATEMENTS)) {
      const b = build(`${stmt}\nplot(close)`, true)
      expect(b.ok, `${name}: ${b.ok ? '' : `${b.refusal.guard} — ${b.refusal.message}`}`)
        .toBe(true)
    }
  })

  it('⛔ CONTROL: ownership does not make EVERY refusal go away', () => {
    // Without this, the case above is satisfied by a build that had stopped
    // checking anything at all
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    const b = build('plot(nosuchthing.atall(close))', true)
    expect(b.ok).toBe(false)
  })
})

describe('⛔ the refusal names the CALLER, because the caller is the answer', () => {
  it('unowned: the sentence says nobody told this build who owns the drawing', () => {
    const b = build('label.new(bar_index, close, "x")\nplot(close)', false)
    expect(b.refusal.message).toMatch(/objectTrees/)
    expect(b.refusal.message).toMatch(/buildObjectLane/)
  })

  it('⛔ CONTROL: the hint is ABSENT where ownership WAS declared', () => {
    // ⭐ The shape that still refuses under ownership is a drawing READ — and
    // that is a real gap, not a routing question. Sending its reader to the
    // ownership seam would send them where the fix is not.
    // ⚰️ This fixture was `array.push(labels, label.new(…))` until that shape
    // started compiling. Swapping it kept the CONTROL's question intact while
    // the answer to a different question changed.
    const b = build('var lines = array.new_line()\n'
      + 'array.push(lines, line.new(bar_index, low, bar_index, high))\n'
      + 'plot(line.get_y1(array.get(lines, 0)))', true)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:object-op')
    expect(b.refusal.message).toMatch(/line\.get_y1/)
    expect(b.refusal.message).not.toMatch(/objectTrees/)
  })

  it('⭐⭐ a drawing used as a VALUE now BUILDS under ownership — the seam closed', () => {
    // ⭐⭐ THE CORPUS'S DOMINANT LIST-OF-DRAWINGS IDIOM, and the case this file
    // used to pin as the one genuinely missing capability. The object pass
    // collects a create written here and refers to it by site; this lane gives
    // the expression an opaque handle and holds it. Neither lane learned
    // anything about the other's job.
    // ⛔ IF THIS GOES RED, the seam has re-opened and 19 corpus scripts are back
    // behind one refusal.
    const owned = build('var labels = array.new_label()\n'
      + 'array.push(labels, label.new(bar_index, close, "x"))\n'
      + 'plot(array.size(labels))', true)
    expect(owned.ok, owned.ok ? '' : `${owned.refusal.guard} — ${owned.refusal.message}`)
      .toBe(true)
  })

  it('⛔ CONTROL: and WITHOUT ownership the same line still refuses', () => {
    // ⭐ Without this the case above is satisfied by a lane that stopped
    // checking: a handle may stand only for a create somebody has taken
    // responsibility for, and a caller that never ran the object pass has taken
    // none. The refusal here still carries the ownership hint, because for THIS
    // caller the hint is the answer.
    const b = build('var labels = array.new_label()\n'
      + 'array.push(labels, label.new(bar_index, close, "x"))\n'
      + 'plot(array.size(labels))', false)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:object-op')
    expect(b.refusal.message).toMatch(/objectTrees/)
  })
})
