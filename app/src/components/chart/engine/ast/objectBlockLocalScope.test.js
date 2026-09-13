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
    // v2's Volume-table block stops at a tuple destructure `foldStatements`
    // cannot fold, so everything after it in that block is still unbound. A
    // counter that could only ever read zero would prove nothing.
    const t = translatePine(V2, { strict: true })
    expect(t.objectDiagnostics.unboundLocals).toBeGreaterThan(0)
    expect(t.objectDiagnostics.unboundLocalNames).toContain('volCellText')
  })
})

describe('⭐⭐ v2 — what step 1 actually moved', () => {
  const t = translatePine(V2, { strict: true })
  const ops = (t.objects && t.objects.ops) || []

  it('the two Range cells now carry their text', () => {
    // BEFORE step 1: cells 0, dropReasons {cell:text: 6}, unboundLocals 41 over
    // 20 names. The Range table's `rangeText` and `usedText` are ordinary block
    // locals and were unbound purely because `foldIfChain` refuses a block that
    // contains object statements — so nobody bound them at all.
    expect(ops.filter((o) => o.k === 'cell')).toHaveLength(2)
    expect(t.objectDiagnostics.dropReasons['cell:text']).toBe(4)
  })

  it('⛔ and the residue is NAMED, not a number', () => {
    // Every remaining unbound name is inside the Volume-table block, downstream
    // of `[tableUnit, tableDivisor] = f_getVolumeUnit(volDisplay)`. That is
    // capability 2's work, and it is a list a reader can act on rather than "22".
    const names = t.objectDiagnostics.unboundLocalNames
    expect(names).toContain('volCellText')
    expect(names).toContain('volMultText')
    // ⛔ NOTHING FROM THE RANGE TABLE IS STILL IN IT — that half is done.
    expect(names).not.toContain('rangeText')
    expect(names).not.toContain('usedText')
  })
})
