// app/src/components/chart/builder/memberPane/conditionColumn.test.js
//
// ─── ⭐⭐ (j) j.3b(b) / R34 — THE PANE DOOR CARRIES THE CONDITION ────────────
//
// j.3b(a) made the TRANSLATOR carry a conditional fill's two colours and its
// condition (`colorUp`/`colorDown`/`colorCondition`). The renderer (j.3a, R30) draws
// a fill from a per-point colour array resolved through `colorMode: 'column:<key>'`.
// Between them sits a hole: `colorMode` names a COLUMN, and the pane document has no
// column for a condition — `memberPaneDefinition` carries no dynamic colour for a
// plot OR a fill. So the carried condition reaches the document and stops.
//
// R34: the document gains a HIDDEN CONDITION ROW, and its key is what `colorMode`
// names.
//
// ⛔⛔ KEYED BY THE CANONICAL FORMULA, NOT BY THE FILL. Clouds' twenty fills are
// twenty separate `fill()` calls over ONE `isBullish`. Keyed per fill, the document
// would grow TWENTY identical columns — twenty evaluations of one expression, twenty
// rows against a document cap that exists to bound exactly that, and twenty chances
// for them to disagree. Keyed by formula, it grows one. That is the whole ruling,
// and the two-fills-one-condition case below is what pins it.
//
// ⛔ A DERIVED COLUMN IS NOT AN AUTHOR OUTPUT. The condition rows are appended AFTER
// `DOC_CARRY_MAX` has bounded the author's outputs, because dropping one would leave
// a fill's `colorMode` naming a column nobody declared — a locator into nothing,
// which is the failure j.1 already refuses for a fill's ANCHORS. They cost the
// member nothing: `CARRY_MAX` bounds what is VISIBLE, and these are hidden.
import { describe, it, expect } from 'vitest'
import { memberPaneDefinition } from './memberPaneDefinition.js'

const HEAD = '//@version=5\nindicator("t", overlay=true)\n'
const PLOTS = [
  'a = ta.sma(close, 5)',
  'b = ta.sma(close, 10)',
  'c = ta.sma(close, 20)',
  'd = ta.sma(close, 30)',
  'up = close > open',
  'hi = high > low[1]',
  'p1 = plot(a, "A")',
  'p2 = plot(b, "B")',
  'p3 = plot(c, "C")',
  'p4 = plot(d, "D")',
].join('\n')

/** Two fills share ONE condition (`up`); a third uses a DIFFERENT one (`hi`). */
const THREE_FILLS = `${HEAD}${PLOTS}
fill(p1, p2, color = up ? color.green : color.red)
fill(p2, p3, color = up ? color.blue : color.yellow)
fill(p3, p4, color = hi ? color.olive : color.navy)
`

/** The same script with the two SHARING fills gone — one condition should remain. */
const ONE_FILL = `${HEAD}${PLOTS}
fill(p3, p4, color = hi ? color.olive : color.navy)
`

/** No conditional at all — a static fill must mint no column. */
const STATIC_FILL = `${HEAD}${PLOTS}
fill(p1, p2, color = color.new(color.green, 40))
`

const built = (src, id = 'u_member-pane_cond') =>
  memberPaneDefinition({ source: src, id, name: 'T' })

const plotsOf = (src) => {
  const r = built(src)
  expect(r.ok, `the pane refused the fixture: ${r.reason}`).toBe(true)
  return (r.definition && r.definition.plots) || []
}
const fillsOf = (src) => plotsOf(src).filter((p) => p.fill)
/** A condition row is hidden, owns no fill, and is not one of the author's plots. */
const conditionRows = (src) => plotsOf(src).filter((p) => p.hidden === true && p.conditionFor)

describe('(j) j.3b(b) / R34 — the pane door carries a deduped condition column', () => {
  it('⛔⛔ NON-VACUITY — the fixture declares THREE fills over TWO distinct formulas', () => {
    // Without this, "exactly two rows" could pass over a script that translated to
    // one fill, or to three fills whose conditions the translator never carried —
    // and the count would be measuring the fixture, not the door.
    const r = built(THREE_FILLS)
    expect(r.ok, r.reason).toBe(true)
    const tFills = ((r.translation || {}).presentation || {}).fills || []
    expect(tFills.length, 'the translator did not carry three fills').toBe(3)
    const carried = tFills.filter((f) => f.colorUp && f.colorDown && f.colorCondition)
    expect(carried.length, 'the translator carried no conditional colours — j.3b(a) is the gate').toBe(3)
    const formulas = new Set(carried.map((f) => f.colorCondition.formula))
    expect(formulas.size, 'the fixture must hold exactly two DISTINCT conditions').toBe(2)
    expect([...formulas].sort()).toEqual(['close > open', 'high > low[1]'])
  })

  it('⛔ CONTROL — a STATIC fill mints no condition column', () => {
    expect(conditionRows(STATIC_FILL).length, 'a static fill grew a condition row').toBe(0)
    const f = fillsOf(STATIC_FILL)
    expect(f.length).toBe(1)
    expect(f[0].fill.colorMode, 'a static fill must declare no colour mode').toBeUndefined()
  })

  it('⛔ CONTROL — hidden rows do not consume the VISIBLE carry budget', () => {
    // R25's measurement governs: `CARRY_MAX` bounds what a member SEES and
    // `DOC_CARRY_MAX` bounds the document. A condition row is hidden, so it can
    // never displace a plot the member was going to look at. Pinned to the MEASURED
    // visible count of this fixture rather than to the constant.
    const visible = plotsOf(THREE_FILLS).filter((p) => p.hidden !== true)
    expect(visible.length, 'the fixture draws four visible plots').toBe(4)
  })

  it.fails('⛔⛔ TWO FILLS SHARING ONE CONDITION PRODUCE ONE COLUMN, NOT TWO', () => {
    const rows = conditionRows(THREE_FILLS)
    expect(rows.length, 'three fills over two formulas must mint exactly two columns').toBe(2)
    // …and each is hidden, so it binds no series (R27 amended).
    expect(rows.every((r) => r.hidden === true)).toBe(true)
    // …and each carries the CONDITION as its own source, evaluated by the same
    // path a plot's column is — never a second evaluator.
    expect(rows.map((r) => r.source).sort()).toEqual(['close > open', 'high > low[1]'])
  })

  it.fails('⛔⛔ EACH FILL\'S colorMode NAMES THE RIGHT COLUMN', () => {
    const fills = fillsOf(THREE_FILLS)
    expect(fills.length).toBe(3)
    const rows = conditionRows(THREE_FILLS)
    const keyOfFormula = new Map(rows.map((r) => [r.source, r.key]))
    // the two sharing fills point at the SAME key; the third at the other one
    const modes = fills.map((p) => p.fill.colorMode)
    expect(modes.every((m) => typeof m === 'string' && m.startsWith('column:'))).toBe(true)
    const upKey = keyOfFormula.get('close > open')
    const hiKey = keyOfFormula.get('high > low[1]')
    expect(modes.filter((m) => m === `column:${upKey}`).length,
      'the two fills sharing a condition must name ONE key').toBe(2)
    expect(modes.filter((m) => m === `column:${hiKey}`).length).toBe(1)
    // …and the two colours ride with it, from the translator, unchanged.
    for (const p of fills) {
      expect(typeof p.fill.colorUp).toBe('string')
      expect(typeof p.fill.colorDown).toBe('string')
    }
  })

  it.fails('⛔⛔ A COLUMN DIES WITH THE LAST FILL THAT NAMES IT', () => {
    // The same script with the two sharing fills removed keeps exactly one column —
    // the one the surviving fill still needs. A column left behind is a computed
    // series nothing draws, which is the "declarable and inert" shape this engine
    // refuses elsewhere.
    const rows = conditionRows(ONE_FILL)
    expect(rows.length, 'the abandoned condition column was not removed').toBe(1)
    expect(rows[0].source).toBe('high > low[1]')
    const fills = fillsOf(ONE_FILL)
    expect(fills.length).toBe(1)
    expect(fills[0].fill.colorMode).toBe(`column:${rows[0].key}`)
  })

  it.fails('⛔ A CONDITION COLUMN IS A REAL COLUMN — it carries a tree and a mode', () => {
    // ⛔ NOT A SECOND EVALUATOR. The row goes through `evaluateFormula` exactly as
    // an author's plot row does, so the column the renderer reads is produced by the
    // one compute path. A row with a source and no `ast` would be a locator into
    // nothing the moment the binder asked for its column.
    const rows = conditionRows(THREE_FILLS)
    // ⛔ THE GUARD THIS TEST WAS WRITTEN WITHOUT, AND `it.fails` CAUGHT IT.
    // Today `conditionRows` is empty, so the loop below ran zero times and the case
    // PASSED — under `it.fails`, which expects a failure, that showed up at once as
    // an unexpected pass. A loop over an empty set asserts nothing; every other case
    // here happens to pin a COUNT first, and this one did not.
    expect(rows.length, 'no condition rows at all — the loop below would assert nothing').toBe(2)
    for (const r of rows) {
      expect(r.ast, `${r.source} has no tree`).toBeTruthy()
      expect(typeof r.mode, `${r.source} has no mode`).toBe('string')
      expect(r.key, 'a condition row needs a key for colorMode to name').toBeTruthy()
    }
  })
})
