// app/src/components/chart/engine/ast/objectBlockLocalScope.test.js
//
// ─── ⭐⭐ R2 STEP 1 — ONE AUTHORITY FOR A BLOCK LOCAL'S VALUE: THE WALK ──────
//
// ⚰️ WHAT THIS REPLACES. `buildObjectProgram.scopeFor` used to rebuild every name
// an object op needed by RE-PARSING the statement's tokens. That is a second
// reader of the same source, and the two disagreed in a way nothing could see:
// `stampInputName` marks an `input.*` call node with the name it was bound to,
// and only the WALK does that. A re-parse hands back a fresh node without it, so
// `declareInputs` had nothing to mint and a member's knob folded to its literal
// DEFAULT — inside object coordinates only, while every plot on the same
// document honoured it.
//
// ⛔⛔ AND THE OBVIOUS FIX IS THE TRAP THIS FILE GUARDS. "Make the resolver
// factory honour the scope every caller hands it" is one word, it looks right,
// and on its own it makes things WORSE: the scope it would then honour is the
// re-parsed one, so the knob dies in more places rather than fewer. The order is
// load-bearing — `scopeFor` has to stop re-parsing FIRST. `THE KNOB SURVIVES A
// BLOCK-LOCAL SCOPE` below is red for the naive fix and green only for the
// proper one.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'
import { memberInputTranslation } from '../../builder/builderInputs'

const REPO = path.resolve(process.cwd(), '..')
const V2 = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

/** ⭐ THE OP HAS BLOCK LOCALS *AND* READS AN INPUT — which is the combination
 *  `objectParams.test.js` does not have. Its `if` body holds only the `line.new`
 *  itself, so `scopeFor` returned `env` untouched and the re-parse never fired.
 *  This one declares `lo` and `hi` inside the block, so the op carries locals and
 *  the old path rebuilt every name it could see, `off` included. */
const SRC = `//@version=5
indicator("Block local + knob", overlay = true, max_lines_count = 200)
off = input.int(5, "Offset", minval = 0, maxval = 200)
lvl = close * (1 + off / 100.0)
var line ln = na
if barstate.islast
    lo = lvl
    hi = lo + 1
    ln := line.new(bar_index - 60, lo, bar_index, hi, color = color.yellow, width = 3)
plot(lvl, title = "LVL")
`

// ⚠️ `plot(lvl)` IS LOAD-BEARING, not decoration. `memberInputTranslation`
// only declares an input the OUTPUTS actually reach, so a script whose plot never
// touches `off` has nothing to declare and this file would measure an engine that
// was never asked the question — green for the wrong reason on every branch.
// The first draft of this fixture plotted `close` and did exactly that.

const documentFor = (src) => {
  const t = memberInputTranslation(translatePine, src)
  return { t, ops: (t.objects && t.objects.ops) || [], diag: t.objectDiagnostics || {} }
}

const treeOf = (t, ref) => (ref && ref.v === 'tree' ? (t.objects.trees || [])[ref.tree] : null)

describe('⭐⭐ a block local reaches an object coordinate through the WALK', () => {
  it('⛔⛔ THE KNOB SURVIVES A BLOCK-LOCAL SCOPE — red for the naive fix', () => {
    const { t, ops } = documentFor(SRC)
    const create = ops.find((o) => o.k === 'create')
    expect(create, 'the line was dropped entirely').toBeTruthy()

    const y1 = JSON.stringify(treeOf(t, create.props.y1))
    // ⛔ THE IDENTIFIER, NOT THE LITERAL. `off` must survive as a declared name;
    // `{"type":"num","value":5}` in this position is the exact regression — the
    // member's knob welded shut inside a coordinate.
    expect(y1, 'the input folded to its literal default inside the coordinate')
      .toContain('"name":"off"')
    expect(y1).not.toContain('"value":5')
  })

  it('⭐ and the block local itself is READ, not lost', () => {
    // `hi = lo + 1` — a local built from another local. If the walk did not bind
    // them the whole op would be dropped for an unresolvable coordinate.
    const { t, ops } = documentFor(SRC)
    const create = ops.find((o) => o.k === 'create')
    const y2 = JSON.stringify(treeOf(t, create.props.y2))
    expect(y2).toContain('"name":"off"')
    expect(y2).toContain('"value":1')
  })

  it('⛔ NOTHING in this script is left for a re-parse to pick up', () => {
    // The diagnostic is the measurement, not a hope: `unboundLocals` counts every
    // name the object pass wanted and the walk never bound. Zero here means the
    // walk really is the only authority for this script.
    const { diag } = documentFor(SRC)
    expect(diag.unboundLocals || 0).toBe(0)
    expect(diag.unboundLocalNames || []).toEqual([])
  })

  it('⛔ CONTROL — the diagnostic can be NON-zero, so the case above is not vacuous', () => {
    // ⚰️ THIS CONTROL USED TO BE v2 ITSELF, and step 2a retired it by fixing the
    // thing it measured: the Volume-table block stopped at a tuple destructure
    // `foldStatements` could not fold, stranding nine names. It folds now and v2
    // reads ZERO — so the control has to come from a construct the walk still
    // genuinely gives up on, or this file would be asserting a counter that can
    // only ever read zero.
    //
    // A `for` loop is that construct: `foldStatements` throws `pine:block` on it
    // by ruling, so every local declared AFTER it in the same block is unbound.
    const src = `//@version=5
indicator("unbindable", overlay = true)
var line ln = na
if barstate.islast
    total = 0.0
    for i = 0 to 3
        total := total + close[i]
    lo = total / 4
    ln := line.new(bar_index - 10, lo, bar_index, lo)
plot(close)
`
    const t = translatePine(src, { strict: true })
    expect(t.objectDiagnostics.unboundLocals).toBeGreaterThan(0)
    expect(t.objectDiagnostics.unboundLocalNames).toContain('lo')
  })
})

// ─── ⛔⛔ THE ELEMENT-WISE TUPLE FOLD, AND WHAT IT MUST STILL REFUSE ─────────
//
// R2 step 2a folds an `if/else if/else` chain whose every arm is a same-arity
// tuple into a TUPLE of ternaries. That is what let `[tableUnit, tableDivisor] =
// f_getVolumeUnit(volDisplay)` hand out its parts. ⛔ The two checks it kept are
// the whole safety of the feature — the same pair `foldStatements` makes when it
// builds a bare tuple return — and a fold that widened them would hand a name a
// part from the wrong arm, which parses, lints, saves and is silently WRONG.
describe('⛔ the tuple fold refuses what it always refused', () => {
  const chain = (arms) => `//@version=6
indicator("t", overlay=true)
f_u(_v) =>
    a = math.abs(_v)
${arms}
[p, q] = f_u(volume)
plot(p)
`
  const guardsFor = (src) => (translatePine(src, { strict: true }).notes || [])
    .map((n) => n.guard || n.code)

  it('⭐ same arity in every arm folds — the case step 2a added', () => {
    const src = chain(`    if a >= 1e9
        ['B', 1e9]
    else
        ['M', 1e6]`)
    expect(guardsFor(src)).not.toContain('pine:tuple')
  })

  it('⛔ MISMATCHED ARITY still refuses at pine:tuple', () => {
    // Arm one answers two values and arm two answers three. Folding element-wise
    // would silently drop the third, or pair `q` with the wrong element.
    const src = chain(`    if a >= 1e9
        ['B', 1e9]
    else
        ['M', 1e6, 3.0]`)
    expect(guardsFor(src)).toContain('pine:tuple')
  })

  it('⛔ NO `else` arm still refuses — the chain has no total value', () => {
    // Without an else the chain can fall through with no value at all, so there
    // is nothing to hand the second name on those bars.
    const src = chain(`    if a >= 1e9
        ['B', 1e9]
    else if a >= 1e6
        ['M', 1e6]`)
    expect(guardsFor(src)).toContain('pine:tuple')
  })

  it('⛔ a ONE-element arm is a list, not a tuple, and still refuses', () => {
    const src = `//@version=6
indicator("t", overlay=true)
f_u(_v) =>
    a = math.abs(_v)
    if a >= 1e9
        [1e9]
    else
        [1e6]
[p] = f_u(volume)
plot(p)
`
    expect(guardsFor(src)).toContain('pine:tuple')
  })
})

describe('⭐⭐ v2 — the running measurement, step by step', () => {
  const t = translatePine(V2, { strict: true })
  const ops = (t.objects && t.objects.ops) || []

  // ⭐⭐ THE LEDGER THIS FILE EXISTS TO KEEP. Every number here is a measurement
  // of one script through the shipped door, and each step moves it:
  //
  //   before step 1   cells 0   cell:text 6   unboundLocals 41 over 20 names
  //   after  step 1   cells 2   cell:text 4   unboundLocals 22 over  9 names
  //   after  step 2a  cells 3   cell:text 3   unboundLocals  0
  //   after  step 2b  cells 4   cell:text 2   unboundLocals  0
  //   target          cells 6   cell:text 0   unboundLocals  0
  it('cells 4, cell:text 2 — both Volume cells and both Range cells', () => {
    // ⭐ 2b lit `volCellText`, the cell a member actually reads. What is left is
    // the Range table's `atrMultText` and `dcrText`, both built across `if`
    // branches with `:=` — step 3.
    expect(ops.filter((o) => o.k === 'cell')).toHaveLength(4)
    expect(t.objectDiagnostics.dropReasons['cell:text']).toBe(2)
  })

  it('⭐⭐ EVERY BLOCK LOCAL IS BOUND BY THE WALK — unboundLocals is 0', () => {
    // Step 1 made the walk the authority; step 2a taught it the one construct it
    // was still giving up on inside these blocks, the tuple destructure
    // `[tableUnit, tableDivisor] = f_getVolumeUnit(volDisplay)`. Nothing in v2
    // is left for a re-parse to have picked up.
    expect(t.objectDiagnostics.unboundLocals || 0).toBe(0)
  })

  it('⛔ and the tuple destructure no longer refuses AT ALL', () => {
    // `pine:tuple` fired twice on this script — lines 391 and 465 — because an
    // `if/else if/else` chain whose every arm is a tuple folded to one scalar
    // value, and `destructureBindings` then said *"returns one value, and 2
    // names were given"*: a sentence about the FOLD, not about the script.
    const tupleNotes = (t.notes || []).filter((n) => (n.guard || n.code) === 'pine:tuple')
    expect(tupleNotes).toEqual([])
  })
})
