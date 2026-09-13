// app/src/components/chart/engine/__tests__/memberPaneTables.test.js
//
// ─── ⭐⭐ R2 STEP 6 — THE WHOLE WIRE, ON THE MEMBER'S OWN ROUTE ──────────────
//
//   Pine source
//     → memberPaneDefinition()        the document a member SAVES and installs
//     → objectReaderFor(def, bars)    the binder's own call, arguments and all
//     → evaluateObjects()             one pass, forward, bar by bar
//     → toRenderState()               generic geometry
//     → layoutTables() → renderTables()   a real `<table>` on the pane
//
// ⛔⛔ THIS FILE EXISTS BECAUSE EVERY LAYER WAS ALREADY GREEN AND THE TABLE DID
// NOT DRAW. `translatePine` reported six cells, `paneGate` passed, the object
// model, the runtime, the render state, the layout and the DOM adapter each had
// their own passing rails — and `uncharted-volume-v2.pine`, a script whose whole
// product is two dashboards, put ZERO tables on a member's chart. Three separate
// wires were cut, in three different files, and no component test could see any
// of them because a component test mocks the thing on the other side:
//
//   1. `memberPaneDefinition` never named `objects`, so the PANE document — the
//      one that reaches a chart through `indicatorInstances` — carried no object
//      program at all. (The SCAN document has carried it since C3B.)
//   2. `objectColumns` interpreted the RAW tree, with no bind-time fold, so 24
//      of v2's 27 object trees refused: eighteen on `syminfo.ticker` and six on
//      a window length behind a `timeframe.*` test. `computeFor` has folded both
//      since R-K — one document, two evaluators, one of them blind.
//   3. `binder.sync` passed `inputs` and `tf` to the object reader and not
//      `symbol`, so even a folded lane had nothing to settle `syminfo.*` with.
//
// ⭐ So the assertions below are about the WIRE, deliberately. What the strings
// SAY is `pineTableVendorParity.test.js`'s job, against the vendor captures.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { layoutTables } from '../objectCanvas'
import { renderTables } from '../objectTableDom'
import { nodeTree } from '../ast/graph'
import { interpret, MAX_RECURRENCE_STEPS } from '../ast/interpret'

const V2 = fs.readFileSync(path.resolve(process.cwd(), '..',
  'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

const N = 400
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100 + Math.sin(i / 9) * 3,
  h: 104 + Math.sin(i / 9) * 3,
  l: 96 + Math.sin(i / 9) * 3,
  c: 100 + Math.sin(i / 7) * 4,
  v: 40_000_000 + i * 13_000,
}))

// ⭐ THE SYMBOL IS THE STORE'S SPELLING, NOT PINE'S. `symbolScope.json::confirmed`
// is keyed by what OUR store holds — SPY's exchange is `'NYSE Arca'`, which is
// witnessed as Pine's `AMEX`. Handing `'AMEX'` here would look more correct and
// resolve NOTHING, because the map's keys are the other vocabulary.
const SYMBOL = Object.freeze({ ticker: 'SPY', exchange: 'NYSE Arca' })

const dom = new JSDOM('<!doctype html><body></body>')
const doc = dom.window.document

/** The member's route, end to end, with no layer mocked. */
function drawn(symbol = SYMBOL) {
  const built = memberPaneDefinition({ source: V2, id: 'u_v2pane', name: 'Uncharted Volume v2' })
  const reader = objectReaderFor(built.definition, BARS, { inputs: undefined, tf: 'D', symbol })
  const run = reader && evaluateObjects(reader.program, {
    barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  const state = run && toRenderState(run.live, { bars: BARS })
  const root = doc.createElement('div')
  doc.body.appendChild(root)
  const stats = state ? renderTables(root, layoutTables(state), doc) : null
  return { built, reader, run, state, root, stats }
}

describe('⭐⭐ v2 reaches a member\'s pane with both of its dashboards', () => {
  const { built, reader, run, state, root, stats } = drawn()

  it('the pane document CARRIES the object program — wire 1', () => {
    expect(built.ok, built.reason || '').toBe(true)
    expect(built.definition.objects, 'the pane document dropped `objects`').toBeTruthy()
    // ⭐ THE BREAKDOWN, NOT A TOTAL. Nine ops: two `table.new`, six
    // `table.cell`, and ONE surviving `table.set_position` — the Range table's,
    // whose position the enum reader can now resolve. The Volume table's
    // `set_position` is still dropped for the same reason its `create` position
    // is (see the approximation case below), and a bare `9` would have hidden
    // which of the two it was.
    const kinds = built.definition.objects.ops.reduce((a, o) => {
      const k = o.k === 'create' ? `create:${o.family}` : o.k
      a[k] = (a[k] || 0) + 1
      return a
    }, {})
    expect(kinds).toEqual({ 'create:table': 2, cell: 6, update: 1 })
  })

  it('⛔⛔ and every object tree EVALUATES — wires 2 and 3, measured as a count', () => {
    // ⚰️ `failed` was 24 of 27. It is the instrument for both bind-time wires at
    // once, and it is zero or it is not: a tree that refuses cannot place a
    // coordinate, and the op that needed it is dropped with nothing on screen.
    expect(reader, 'objectReaderFor returned nothing').toBeTruthy()
    expect(reader.failed).toEqual([])
    expect(run.status).toBe('ok')
  })

  it('⛔ CONTROL — WITHOUT the symbol the same call refuses, and refuses LOUDLY', () => {
    // The case above must not be able to pass for the wrong reason. With no
    // symbol, `symbolConstantsWith` returns `{}` by design and every `syminfo.*`
    // stays NotFoldable — which is R-K's deliberate choice of a loud refusal
    // over a half-resolved guess, and it is what makes `failed: []` above a
    // statement about the wiring rather than about the fixture.
    const bare = drawn(null)
    expect(bare.reader.failed.length).toBeGreaterThan(20)
    expect(bare.stats).toEqual({ tables: 0, cells: 0, skipped: 0 })
  })

  it('⭐⭐ TWO TABLES, FOUR DRAWN CELLS — exactly what the folded inputs enable', () => {
    // Six `table.cell` ops exist in the program. `show_avg_volume` defaults FALSE
    // so the AVol cell's op is guarded out and never runs; `show_dcr_in_range_table`
    // defaults FALSE so the DCR cell runs and folds to `''`, and an empty cell is
    // not drawn. Four is the number a member sees, and the number the vendor's
    // `fillText` capture recorded on the same script.
    expect(state.tables).toHaveLength(2)
    expect(stats).toEqual({ tables: 2, cells: 4, skipped: 0 })
    expect(root.querySelectorAll('table')).toHaveLength(2)
    expect(root.querySelectorAll('td')).toHaveLength(4)
  })

  it('⛔ the two switched-off cells are ABSENT, not blank', () => {
    // The ruling's own words. A blank `<td>` would satisfy a count and lie to a
    // member: a dashboard cell that says nothing where the author wrote a number
    // reads as "the value is empty".
    const texts = [...root.querySelectorAll('td')].map((td) => td.textContent)
    expect(texts.some((t) => t === '')).toBe(false)
    expect(texts.some((t) => t.includes('DCR'))).toBe(false)
    expect(texts.some((t) => t.includes('AVol'))).toBe(false)
  })

  it('⭐⭐ THE RANGE TABLE IS IN THE CORNER THE SCRIPT DECLARES, not the default', () => {
    // ⭐ `atrPos = f_getTablePos(atrTablePosition)` — a user function whose body
    // is a chain of ternaries over an `input.string`, with a `position.*` at each
    // leaf. Before the enum-slot reader this prop was DROPPED and the renderer
    // used `OBJECT_DEFAULTS.table.position` (`top_right`), putting the dashboard
    // in the opposite corner from the one the author asked for. The vendor
    // capture reads `position_input: "Top Left"`.
    const range = state.tables.find((t) => t.cells.some((c) => c.text.includes('ATR')))
    expect(range.position).toBe('top_left')
    const el = [...root.querySelectorAll('table')]
      .find((x) => x.textContent.includes('ATR'))
    expect(el.getAttribute('data-uct-table-position')).toBe('top_left')
    expect(el.style.left).toBe('8px')
    expect(el.style.right).toBe('')
  })

  it('⚠️ and the VOLUME table\'s position is an APPROXIMATION, named to its line', () => {
    // ⛔⛔ THIS ONE IS NOT RESOLVED, AND IT LANDS ON THE RIGHT ANSWER ANYWAY,
    // WHICH IS THE DANGEROUS CASE. `volPosName = hasRecentHV ? 'Top Center' :
    // volTablePosition` picks the string at RUNTIME, so the comparison inside
    // `f_getTablePos` cannot fold to a numeric condition and the whole enum read
    // refuses. The renderer falls back to `top_right` — which is exactly where
    // the vendor draws it, because `volTablePosition` defaults to Top Right and
    // no HV event is recent. A coincidence is not a result, so the drop is
    // NAMED with its line rather than left as one of nine anonymous
    // `droppedProps`, and the capability is routed.
    const vol = state.tables.find((t) => t.cells.some((c) => c.text.includes('Vol :')))
    expect(vol.position).toBe('top_right')
    expect(built.translation.objectDiagnostics.droppedPropNames)
      .toContain('table.position@490')
  })

  it('⛔ and the OTHER named drops are the two style props, also to the line', () => {
    // `tableTextSize` is an `input.string` mapped to `size.*` and `atrMultColor`
    // / `dcrColor` are chosen in an `if` branch. Both fall back — to `normal` and
    // to the renderer's default ink — and a fallback nobody can see is the thing
    // this list exists to stop. ⏭️ Both are routed; neither changes a NUMBER.
    const names = built.translation.objectDiagnostics.droppedPropNames
    expect(names.filter((n) => n.startsWith('cell.text_size@'))).toHaveLength(6)
    expect(names.filter((n) => n.startsWith('cell.text_color@'))).toHaveLength(2)
    // ⛔ AND NOTHING ELSE IS DROPPED SILENTLY — the named list accounts for the
    // whole count, so a tenth drop cannot appear without a name.
    expect(names).toHaveLength(built.translation.objectDiagnostics.droppedProps)
  })
})


// ─── ⛔⛔ THE CEILING A REAL CHART'S DEPTH REACHES, MEASURED ────────────────
//
// ⚰️ FOUND IN THE BROWSER, NOT HERE, AND THEN REPRODUCED HERE. On the rig's own
// SPY 1D chart — 8,000 daily bars, the depth the product actually loads — both
// tables drew and both read `Vol : NaN (NaNx) ` / `ATR : $NaN (NaN%)`. The
// wiring was right; 22 of the document's 133 graph nodes refuse
// `interpret:steps`:
//
//     accum over 8000 bars with a 250-bar warm-up is 2000000 steps
//     and the ceiling is 1000000
//
// ⛔ THAT IS THE ENGINE'S CONTAINMENT ENVELOPE WORKING, NOT A WIRING DEFECT —
// `MAX_RECURRENCE_STEPS` is shared with the plot lane and exists so a chart
// cannot become a hang. What is a defect is that a member CANNOT TELL: a refused
// node reads `NaN` through `readNode`, and `NaN` in a text template renders the
// three characters `NaN` in a dashboard cell, indistinguishable from the script
// having honestly said `na`. So the count is carried out of the binder and
// stamped on the layer, and this rail is what keeps it carried.
//
// ⏭️ ROUTED, NOT GUESSED AT: whether the CHART lane may spend more steps than a
// universe sweep is a ruling about the envelope, and raising a shared constant
// at the end of a session is how a hang ships.
describe('⛔ what the object lane could not read is COUNTED, not silently NaN', () => {
  // ⚠️ THE TIMEOUTS ARE STATED, NOT INHERITED. Twenty-seven object trees over
  // thousands of bars is genuinely slow — the 8,000-bar case walks
  // `bars × warmup` until the ceiling refuses — and a case that trips vitest's
  // 15s default reports as a FAILURE of the thing it measures. Naming the number
  // keeps a slow measurement legible as slow.
  it('⭐⭐ at 1,400 bars every node reads — and the count is zero', { timeout: 120_000 }, () => {
    const built = memberPaneDefinition({ source: V2, id: 'u_v2pane', name: 'v2' })
    const bars = Array.from({ length: 1400 }, (_, i) => ({
      t: 1_400_000_000 + i * 86400, o: 100, h: 104, l: 96,
      c: 100 + Math.sin(i / 7) * 4, v: 40_000_000 + i * 13_000,
    }))
    const r = objectReaderFor(built.definition, bars, { inputs: undefined, tf: 'D', symbol: SYMBOL })
    expect(r.failed).toEqual([])
  })

  it('⛔⛔ …and at 8,000 the STEP CEILING refuses, by name and with its arithmetic', { timeout: 120_000 }, () => {
    // ⭐ The bar count is the only thing that changes between the two cases, which
    // is what makes this a statement about the ceiling rather than about v2.
    const built = memberPaneDefinition({ source: V2, id: 'u_v2pane', name: 'v2' })
    const bars = Array.from({ length: 8000 }, (_, i) => ({
      t: 1_000_000_000 + i * 86400, o: 100, h: 104, l: 96,
      c: 100 + Math.sin(i / 7) * 4, v: 40_000_000 + i * 13_000,
    }))
    const r = objectReaderFor(built.definition, bars, { inputs: undefined, tf: 'D', symbol: SYMBOL })
    expect(r.failed.length).toBeGreaterThan(0)
    // ⛔ AND THE REASON IS THE ONE NAMED ABOVE, not some other refusal that
    // happens to fire at this depth. The failed list is silent about WHY by
    // construction (`objectReaderFor` catches), so the guard is asked directly.
    let msg = ''
    try {
      interpret(nodeTree(built.definition.compute.graph || { nodes: [] }, r.failed[0]),
        bars, {}, undefined, undefined, { tf: 'D' })
    } catch (e) { msg = String((e && e.message) || e) }
    // A V1 document has no graph, so this only asserts when there is one to ask.
    if (built.definition.compute.graph) {
      expect(msg).toContain('steps')
      expect(msg).toContain(String(MAX_RECURRENCE_STEPS))
    }
  })
})
