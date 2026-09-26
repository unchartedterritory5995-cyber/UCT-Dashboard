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

// ⛔ ONE TRANSLATION FOR THE WHOLE FILE. `memberPaneDefinition` re-reads 34,378
// characters of Pine and is pure; calling it per case made this file heavy
// enough to starve the parallel pool and tip unrelated source-sweep suites past
// vitest's 15s default. The document is the same object every time by design —
// which is also what the cases below are about.
let PANE = null
const paneDef = () => {
  if (!PANE) PANE = memberPaneDefinition({ source: V2, id: 'u_v2pane', name: 'Uncharted Volume v2' })
  return PANE
}

/** The member's route, end to end, with no layer mocked. */
function drawn(symbol = SYMBOL) {
  const built = paneDef()
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

  it('⛔ and the OTHER named drops are the style props, also to the line', () => {
    // `atrMultColor` / `dcrColor` are chosen in an `if` branch, fall back to the
    // renderer's default ink, and a fallback nobody can see is the thing this
    // list exists to stop. ⏭️ Routed; it does not change a NUMBER.
    //
    // ⚰️ `cell.text_size` WAS SIX OF THESE AND IS NOW NONE (2026-09-20).
    // `tableTextSize` is an `input.string` mapped to `size.*`, and the reason it
    // dropped was that `ENUM_SLOTS` — the set of props whose value is a WORD —
    // held `position` ALONE. Every other enum prop fell through to the numeric
    // tree path, which cannot carry a string. A LITERAL `text_size = size.small`
    // survived that (an earlier branch answers a bare enum name), so the hole
    // only opened for a script that COMPUTED its size, and it stayed open
    // because six silent fallbacks to `normal` look exactly like a design.
    const names = built.translation.objectDiagnostics.droppedPropNames
    expect(names.filter((n) => n.startsWith('cell.text_size@')),
      'a computed `text_size` should resolve through ENUM_SLOTS, not drop').toHaveLength(0)
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
// ─── ⭐⭐ R-Q — THE STEP CEILING, DERIVED, AND WHAT IT NOW ADMITS ───────────
//
// ⚰️ THIS SECTION USED TO ASSERT THE OPPOSITE, AND THE OPPOSITE WAS THE DEFECT.
// It pinned that v2 at 8,000 bars REFUSED 22 of its 133 graph nodes on
// `interpret:steps` — *accum over 8000 bars with a 250-bar warm-up is 2000000
// steps and the ceiling is 1000000* — and reported that as the engine's
// containment envelope working. It was working; it was also drawing the four
// characters `NaN` in every dashboard cell on SPY 1D, the timeframe a chart
// opens on. A guard that is correct and ships a blank dashboard is still a
// shipped blank dashboard.
//
// ⭐ R-Q derived the ceiling instead (`recurrenceSteps.measure.test.js`):
// deepest real warm-up 250, deepest depth a member can pan to 32,000, worst real
// product 8,000,000, ceiling 12,000,000. What this section pins now is the
// consequence — nothing v2 needs refuses at any depth the product reaches — and
// that the guard is still a guard.
describe('⭐⭐ v2 reads at every depth the product reaches', () => {
  const depths = [
    ['SPY 1D as the chart loads it', 8000],
    ['the daily backfill target (fullBarsFor D)', 12500],
  ]
  for (const [label, n] of depths) {
    it(`⭐ ${label} — ${n} bars, ZERO nodes unreadable`, { timeout: 300_000 }, () => {
      const built = paneDef()
      const bars = Array.from({ length: n }, (_, i) => ({
        t: 1_000_000_000 + i * 86400, o: 100, h: 104, l: 96,
        c: 100 + Math.sin(i / 7) * 4, v: 40_000_000 + i * 13_000,
      }))
      const r = objectReaderFor(built.definition, bars, { inputs: undefined, tf: 'D', symbol: SYMBOL })
      expect(r.failed, `refused: ${JSON.stringify((r.refusals || []).slice(0, 2))}`).toEqual([])
      expect(r.refusals).toEqual([])
    })
  }

  it('⛔⛔ AND THE GUARD IS STILL A GUARD — the grammar\'s own maximum refuses', () => {
    // ⭐ `budget.js::DEFAULT_BUDGET.maxLookback` is 960, so 960 is the widest
    // warm-up this engine will ever admit; `fullBarsFor('30')` is 32,000, the
    // deepest a member can pan to. Their product is 30,720,000 — and it refuses,
    // by 2.56×. A ceiling raised until one script passed would have landed at
    // 8,000,000 with nothing left bounded above it.
    // ⛔ THE WARM-UP IS THE GRAMMAR'S OWN MAXIMUM (`budget.js::DEFAULT_BUDGET
    // .maxLookback` = 960), not an invented one — a wider value refuses at
    // `budget:lookback` FIRST and would prove the wrong guard. 13,000 bars is
    // just past the daily backfill target, so the shape is reachable rather than
    // hypothetical: 13,000 × 960 = 12,480,000, over the ceiling.
    const bars = Array.from({ length: 13000 }, (_, i) => ({
      t: 1_000_000_000 + i * 86400, o: 100, h: 104, l: 96, c: 100 + Math.sin(i / 7) * 4, v: 1e7,
    }))
    let msg = ''
    try {
      interpret({
        type: 'call',
        name: 'accum',
        args: [
          { type: 'series', name: 'close' },
          { type: 'op', name: '+', args: [{ type: 'series', name: 'self' }, { type: 'series', name: 'close' }] },
          { type: 'num', value: 960 },
        ],
      }, bars, {}, { maxNodes: 1e6, maxLookback: 960, maxSeriesRefs: 64 }, undefined, { tf: 'D' })
    } catch (e) { msg = String((e && e.message) || e) }
    expect(msg).toContain('steps')
    expect(msg).toContain(String(MAX_RECURRENCE_STEPS))
    expect(32000 * 960).toBeGreaterThan(MAX_RECURRENCE_STEPS)
  })

  it('⛔⛔ and a refusal is RECORDED BY NODE WITH ITS GUARD, never a bare NaN', () => {
    // ⚰️ THE OTHER HALF OF THE RULING. Before this, a refused node reached a cell
    // as `NaN` through `readNode` and the reader answered only `failed: [92, 95,
    // …]` — a list of graph indices, thrown away by the binder. A member saw
    // `Vol : NaN (NaNx)` and could not tell the engine's refusal from the
    // script's own `na`; an engineer got an index and no guard.
    //
    // ⭐ The budget is squeezed rather than the bars, so this stays fast: the
    // point is the SHAPE of the record, and a refusal is a refusal.
    const built = paneDef()
    const squeezed = { ...built.definition, compute: { ...built.definition.compute, budget: { maxNodes: 1, maxLookback: 1, maxSeriesRefs: 1 } } }
    const r = objectReaderFor(squeezed, BARS, { inputs: undefined, tf: 'D', symbol: SYMBOL })
    expect(r.failed.length).toBeGreaterThan(0)
    expect(r.refusals.length).toBe(r.failed.length)
    expect(r.refusals[0]).toHaveProperty('node')
    expect(r.refusals[0].guard).toMatch(/^(budget|interpret|resolve):/)
    expect(r.refusals[0].message.length).toBeGreaterThan(10)
  })
})
