// app/src/components/chart/engine/runtime/__tests__/drawingAsValue.test.js
//
// ─── ⭐⭐⭐ A DRAWING USED AS A VALUE — `array.push(zones, box.new(…))` ──────
//
// The object pass collects a create written inside a collection call
// (`pineObjects.js::nestedCreate`) and refers to it as `{r:'site', id}` — "what
// THIS bar's create at that site made". The runtime lane refused the SAME line
// at `runtime:object-op`, because the two shapes that legitimately mention a
// drawing under ownership — the handle binding and the bare drawing statement —
// are both SKIPPED before lowering, so anything reaching an expression position
// was a drawing with no value to be. One refusal stood between the corpus's
// dominant list-of-drawings idiom and a drawing.
//
// ⛔⛔ WHAT THIS DOES NOT DO, AND MUST NEVER DO: teach the value runtime to
// draw. It builds no coordinates, reads no drawing property and emits no
// drawing op. It gives the expression an OPAQUE HANDLE (`runtime/handles.js`)
// and lets the object program hold the drawing. `line.get_y1(l)` in a value
// position still refuses by name, because READING a drawing is a different
// capability from HOLDING one and this lane has neither.
//
// ⛔ EVERY ARGUMENT OF THE ACCEPTANCE FIXTURE IS COMPUTED FROM SERIES DATA.
// A literal-only fixture folds to constants before it reaches any binding code,
// so the binding stays unrailed and a mutation that broke it would survive —
// the same note `objectCollectionCreate.test.js` carries for the object half.
// `PUSH_CREATE` reads `high`, `low`, `bar_index` and a `close > open` test, so
// every coordinate arrives as a TREE reference and is read back through the
// object runtime.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

import { buildObjectLane, runObjectLane } from '../objectLane.js'
import { buildRuntimeIr, COLLECTION_VALUE_ARG } from '../../ast/pineRuntimeFrontend.js'
import { drawingHandle, isDrawingHandle, DRAWING_FAMILIES } from '../handles.js'
import { kindOf } from '../collections.js'
import { makeProgram, OP } from '../program.js'
import { validateIr, makeIrProgram, drawing, declare, num, SLOT } from '../ir.js'

const HEAD = '//@version=6\nindicator("t", overlay = true)\n'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i,
  h: 110 + i,
  l: 90 + i,
  // ⭐ close ALTERNATES around open so the guarded branch runs on some bars and
  // not others — a fixture whose condition is always true cannot tell a guard
  // that works from a guard that was dropped.
  c: 100 + i + (i % 2 === 1 ? 2 : -2),
  v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const UP_BARS = BARS.filter((b) => b.c > b.o).length

const build = (body) => buildObjectLane(HEAD + body, { bars: BARS, inputs: {} })

/** ⛔ THE LANE'S OWN WORDS, so a case that expected a refusal and got a compile
 *  says which, instead of failing on `undefined`. */
const refusalOf = (lane) => {
  expect(lane.ok, 'expected a refusal and the lane COMPILED').toBe(false)
  return `${lane.lane}/${lane.refusal.guard}`
}

const okOf = (lane) => {
  expect(lane.ok, lane.ok ? '' : `refused by ${lane.lane}/${lane.refusal.guard}: `
    + `${lane.refusal.message}`).toBe(true)
  return lane
}

// ── the acceptance shape, in miniature ──────────────────────────────────────
const PUSH_CREATE = 'var boxes = array.new_box(0)\n'
  + 'if close > open\n'
  + '    array.push(boxes, box.new(bar_index - 2, high, bar_index, low))\n'

describe('⭐⭐⭐ a drawing used as a value, under object-pass ownership', () => {
  it('⭐⭐ `array.push(coll, box.new(…))` COMPILES AND DRAWS, end to end', () => {
    const lane = okOf(build(PUSH_CREATE))
    const r = runObjectLane(lane, { bars: N, series: SERIES })
    expect(r.status).toBe('ok')

    // ⛔⛔ THE MEASURE IS A DRAWING WITH THE SCRIPT'S OWN NUMBERS ON IT, never
    // "it compiled". A lane that admitted the create and lost its coordinates
    // would draw a box at nothing, which is what refusing already drew.
    const boxes = (r.live || []).filter((o) => o.family === 'box')
    expect(boxes.length, 'the guarded create should fire on the up-close bars only')
      .toBe(UP_BARS)
    expect(UP_BARS, 'a fixture whose guard never fires proves nothing').toBeGreaterThan(0)
    expect(UP_BARS, 'nor one whose guard always fires').toBeLessThan(N)
    for (const b of boxes) {
      const bar = b.createdBar
      expect(b.props.top, `box from bar ${bar} lost its \`high\``).toBe(BARS[bar].h)
      expect(b.props.bottom, `box from bar ${bar} lost its \`low\``).toBe(BARS[bar].l)
    }
  })

  it('⛔ CONTROL — WITHOUT ownership the same script still refuses `runtime:object-op`', () => {
    // ⭐ This is what makes the case above a measurement of the SEAM rather than
    // of the script. `buildRuntimeIr` with no `objectTrees` is a caller that has
    // NOT run the object pass, and for such a caller the refusal is correct: no
    // object program holds that create, so a handle here would stand for
    // nothing. Same source, same lane, opposite answer.
    const bare = buildRuntimeIr(HEAD + PUSH_CREATE, { bars: BARS })
    expect(bare.ok).toBe(false)
    expect(bare.refusal.guard).toBe('runtime:object-op')
  })

  it('⭐ `array.set(coll, i, box.new(…))` is admitted at ITS value position', () => {
    okOf(build('var boxes = array.new_box(0)\n'
      + 'array.push(boxes, box.new(bar_index - 1, high, bar_index, low))\n'
      + 'if close > open\n'
      + '    array.set(boxes, 0, box.new(bar_index - 2, high, bar_index, low))\n'))
  })

  it('⛔⛔ READING a drawing is NOT admitted — `line.get_y1` still refuses', () => {
    // ⭐⭐ THE CAPABILITY BOUNDARY, AND IT IS THE SURVIVOR'S REAL WALL. The
    // corpus script this work was aimed at (`liquidity-levels-sonarlab`) moved
    // off `array.push(…, line.new(…))` at L170 and straight onto this at L100:
    // a getter that asks the value lane for a number ABOUT a drawing it does not
    // hold. There is no honest answer, so the refusal stands.
    const lane = build('var lines = array.new_line(0)\n'
      + 'if close > open\n'
      + '    array.push(lines, line.new(bar_index - 2, high, bar_index, low))\n'
      + 'if array.size(lines) > 0 and high > line.get_y1(array.get(lines, 0))\n'
      + '    array.push(lines, line.new(bar_index - 1, low, bar_index, high))\n')
    expect(refusalOf(lane)).toBe('runtime/runtime:object-op')
    expect(lane.refusal.message).toContain('line.get_y1')
  })

  it('⛔ a create at the INDEX position of `array.set` still refuses', () => {
    // ⭐ `array.set(coll, i, v)` carries its value at argument 2, so a create
    // written at argument 1 is in the INDEX position. The object pass collects
    // nothing there either, so a handle here would stand for no drawing — and
    // this is exactly what an off-by-one in `COLLECTION_VALUE_ARG` would start
    // admitting, quietly, because the lane would then compile.
    const lane = build('var boxes = array.new_box(0)\n'
      + 'array.push(boxes, box.new(bar_index - 1, high, bar_index, low))\n'
      + 'array.set(boxes, box.new(0, 0.0, 1, 1.0), 0)\n')
    expect(refusalOf(lane)).toBe('runtime/runtime:object-op')
    expect(lane.refusal.message).toContain('box.new')
  })

  it('⛔ the COLLECTION argument is not a value position either', () => {
    const lane = build('var boxes = array.new_box(0)\n'
      + 'array.push(boxes, box.new(bar_index - 1, high, bar_index, low))\n'
      + 'array.push(box.new(0, 0.0, 1, 1.0), 1)\n')
    expect(refusalOf(lane)).toBe('runtime/runtime:object-op')
    expect(lane.refusal.message).toContain('box.new')
  })

  it('⛔ an ordinary push is untouched — the rule reads a CREATE, not a position', () => {
    const lane = okOf(build('var xs = array.new_float(0)\n'
      + 'if close > open\n'
      + '    array.push(xs, high - low)\n'
      + 'var t = table.new(position.top_right, 1, 1)\n'
      + 'table.cell(t, 0, 0, str.tostring(array.size(xs)))\n'))
    const r = runObjectLane(lane, { bars: N, series: SERIES })
    const t = (r.live || []).find((o) => o.family === 'table')
    const cell = (t.cells || [])[0]
    expect((cell.props || cell).text).toBe(String(UP_BARS))
  })
})

describe('⛔⛔ the handle is a value this lane HOLDS and cannot READ', () => {
  it('⭐ it reaches the const pool, one entry per create', () => {
    const lane = okOf(build('var boxes = array.new_box(0)\n'
      + 'if close > open\n'
      + '    array.push(boxes, box.new(bar_index - 2, high, bar_index, low))\n'
      + 'if close < open\n'
      + '    array.push(boxes, box.new(bar_index - 1, low, bar_index, high))\n'))
    const handles = lane.program.consts.filter(isDrawingHandle)
    // ⛔ TWO, NOT ONE. `constIndex` interns by object identity, so two creates
    // sharing a pool entry would mean the sentinel was rebuilt at lowering and
    // two different drawings had become indistinguishable to anything that ever
    // compares them.
    expect(handles.length).toBe(2)
    expect(new Set(handles.map((h) => h.site)).size).toBe(2)
    for (const h of handles) expect(h.family).toBe('box')
  })

  it('⛔⛔ it is NOT a number, NOT a string, NOT an array and NOT `na`', () => {
    const lane = okOf(build(PUSH_CREATE))
    const h = lane.program.consts.find(isDrawingHandle)
    expect(h, 'no handle reached the pool — the case below would prove nothing').toBeTruthy()
    // ⭐ The answers `collections.js` already wrote down as WRONG for a drawing
    // element: `na` makes `na(array.get(zones, i))` read TRUE for a box the
    // object program drew, and a number is a coordinate, a row number and a
    // colour. `kindOf` naming it is what makes the VM's declared-kind checks
    // refuse it BY NAME instead of coercing it.
    expect(kindOf(h)).toBe('drawing')
    expect(typeof h).not.toBe('number')
    expect(typeof h).not.toBe('string')
    expect(Array.isArray(h)).toBe(false)
    // ⭐ CONTROL — `kindOf` still answers for the kinds it always did, so the
    // case above is not satisfied by a `kindOf` that answers 'drawing' always.
    expect(kindOf(1)).toBe('number')
    expect(kindOf('a')).toBe('string')
    expect(kindOf([1])).toBe('array')
    expect(kindOf(undefined)).toBe('other')
  })

  it('⛔ `isDrawingHandle` asks a SYMBOL — a look-alike object is not one', () => {
    // ⭐ A `{family, site}` duck-type would start answering true for a member's
    // own object the day a UDT can reach this lane, and a value model that
    // widens itself by accident is how a handle becomes whatever was nearby.
    expect(isDrawingHandle({ family: 'box', site: 0 })).toBe(false)
    expect(isDrawingHandle(drawingHandle('box', 0))).toBe(true)
    expect(isDrawingHandle(null)).toBe(false)
    expect(isDrawingHandle(0)).toBe(false)
    expect(isDrawingHandle('box')).toBe(false)
  })

  it('⛔ the const pool admits a handle and still refuses everything else', () => {
    const prog = (consts) => () => makeProgram({
      code: [OP.HALT, 0, 0], consts, columns: [], outputs: [],
    })
    expect(prog([drawingHandle('table', 3)])).not.toThrow()
    expect(prog([1, 'a', drawingHandle('line', 0)])).not.toThrow()
    // ⭐ CONTROL — the rule it was widened from still holds. Without this the
    // widening is indistinguishable from deleting the check.
    expect(prog([{ family: 'box', site: 0 }])).toThrow(/number, a string or a drawing handle/)
    expect(prog([[1, 2]])).toThrow(/number, a string or a drawing handle/)
  })

  it('⛔ the IR validator refuses a `drawing` node that carries anything else', () => {
    const ir = (value) => makeIrProgram({
      slots: [{ name: 'x', kind: SLOT.LOCAL }], statements: [declare(0, value)],
    })
    expect(() => validateIr(ir(drawing('box', 0)))).not.toThrow()
    expect(() => validateIr(ir({ kind: 'drawing', value: { family: 'box', site: 0 } })))
      .toThrow(/drawing carries a drawing handle/)
    // ⭐ CONTROL — a well-formed sibling still validates, so the case above is
    // failing on the handle rather than on the surrounding program.
    expect(() => validateIr(ir(num(1)))).not.toThrow()
  })

  it('⛔ a handle is minted only for a family this engine draws', () => {
    for (const f of DRAWING_FAMILIES) expect(drawingHandle(f, 0).family).toBe(f)
    expect(() => drawingHandle('candle', 0)).toThrow(/not a drawing family/)
    expect(() => drawingHandle('box', -1)).toThrow(/non-negative ordinal/)
  })
})

describe('⛔⛔ the two lanes agree on WHERE a create may be written', () => {
  // ⭐⭐⭐ DERIVED FROM THE OBJECT PASS, NEVER RE-TYPED. `pineObjects.js` decides
  // which argument its reader collects a nested create from; this lane must
  // admit a handle in exactly those positions and nowhere else. Two hand-typed
  // tables of one fact is the drift this repo pays for most — so the object
  // pass's table is READ and this one is checked against it. Moving the source
  // moves this test.
  // ⛔ A RELATIVE READ FROM THE RUNNER'S ROOT (`app/`), which is where vitest
  // is required to be run from. It resolves against the cwd, and the CONTROL
  // below is what makes that safe: a path that stopped resolving throws here,
  // and a path that resolved to the wrong file fails the "was it FOUND" case
  // rather than leaving the derivation comparing against nothing.
  const SRC = fs.readFileSync('src/components/chart/engine/ast/pineObjects.js', 'utf8')

  /** ⛔ COMMENTS STRIPPED FIRST. `VALUE_ARG` is discussed in prose directly
   *  above its declaration, and a scan that reads prose finds a declaration
   *  nobody wrote. */
  const code = SRC
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  const found = /const\s+VALUE_ARG\s*=\s*Object\.freeze\(\{([^}]*)\}\)/.exec(code)

  it("⛔ CONTROL — the object pass's table was actually FOUND", () => {
    // ⭐ An empty result is a failed invocation until proven otherwise: a regex
    // that matches nothing makes every comparison below pass over an empty set.
    expect(found, '`VALUE_ARG` was not found in pineObjects.js — the derivation '
      + 'below would compare against nothing').toBeTruthy()
    expect(found[1].trim().length).toBeGreaterThan(0)
    // ⭐ And the stripper can still SEE a real occurrence — without this the
    // "found it" assertion could be satisfied by a stripper that removed
    // nothing at all, or by one that removed the whole file.
    expect(code, 'the comment stripper removed nothing').not.toContain('the corpus idiom')
    expect(code, 'the comment stripper removed the CODE').toContain('function emitCollection')
  })

  it("⭐⭐ this lane's value positions ARE the object pass's, plus the collection", () => {
    const theirs = Object.fromEntries(
      found[1].split(',').map((p) => p.split(':').map((s) => s.trim()))
        .filter((p) => p.length === 2 && p[0])
        .map(([k, v]) => [k, Number(v)]),
    )
    expect(Object.keys(theirs).length).toBeGreaterThan(0)
    const derived = Object.fromEntries(
      Object.entries(theirs).map(([method, i]) => [`array.${method}`, i + 1]),
    )
    expect(COLLECTION_VALUE_ARG, 'the object pass collects a nested create at '
      + `${JSON.stringify(theirs)} (after the collection) — this lane must admit `
      + 'a handle at exactly those positions, counting the collection')
      .toEqual(derived)
  })
})
