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
// ⭐ THE ONE GENUINELY MISSING CAPABILITY IS PINNED HERE TOO, at the bottom: a
// drawing call used as a VALUE (`array.push(labels, label.new(…))`) is refused
// even under ownership, deliberately, because there is no honest number to
// return for a drawing handle. That refusal must NOT carry the ownership hint —
// it is the real gap, and pointing it at the seam would send the next reader
// somewhere the fix is not. It is the twelfth script,
// `liquidity-levels-sonarlab` @L170, written in exactly that shape.
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
    // ⭐ The one shape that still refuses under ownership is a drawing used as
    // a VALUE — and that is the real gap, not a routing question. Sending its
    // reader to the ownership seam would send them where the fix is not.
    const b = build('var labels = array.new_label()\n'
      + 'array.push(labels, label.new(bar_index, close, "x"))\n'
      + 'plot(array.size(labels))', true)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:object-op')
    expect(b.refusal.message).not.toMatch(/objectTrees/)
  })

  it('⭐ a drawing used as a VALUE is refused under ownership too, by design', () => {
    // There is no honest number for a drawing handle: `na` would make
    // `na(array.get(labels, i))` read TRUE for a label already drawn. The
    // corpus shape is `array.push(labels, label.new(…))`, and this is the
    // capability the census row should point at once the routing half is read
    // correctly.
    const b = build('var labels = array.new_label()\n'
      + 'array.push(labels, label.new(bar_index, close, "x"))\n'
      + 'plot(array.size(labels))', false)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:object-op')
  })
})
