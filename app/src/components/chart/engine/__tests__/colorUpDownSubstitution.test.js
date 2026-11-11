// app/src/components/chart/engine/__tests__/colorUpDownSubstitution.test.js
//
// ─── ⭐ `colorUp` / `colorDown` ARE SUBSTITUTABLE (UCT RS Phase 1, unit 5) ─────
//
// A `colorMode: 'column:<key>'` plot alternates between two colours per bar.
// Until 2026-11-05 both had to be an author's LITERALS: `SUBSTITUTABLE_PLOT_FIELDS`
// named `color`, `width`, `levels` and `lineStyle`, so a member could recolour a
// one-colour line and never a two-colour one — and the RS line coloured by its
// position against its moving average (the Phase preset, `bull` above / `bear`
// below) could not be a pair of colour inputs.
//
// This file drives the pair through every layer the brief names, in order:
//   1. the SCHEMA — a `$ref` in either field validates, resolves to the input's
//      default, records `$refs`, and an undeclared input is refused with the
//      schema's own message (never silently defaulted);
//   2. the RESOLVER — `pool.resolvePlotForInstance` re-applies a member's pick
//      and leaves literals alone;
//   3. the BINDER — the points handed to the renderer carry the MEMBER's pair,
//      which is the proof that `columnColorsForPlot` reads the RESOLVED plot;
//   4. UCT RS itself — Classic resolves to ONE hue (the ≤2 hues + 1 neutral
//      budget, plan §3 / decision 9), the Phase preset to two, and the hidden
//      `rsAbove` condition plot draws no chip.
import { describe, it, expect } from 'vitest'
import { validateDefinition, SUBSTITUTABLE_PLOT_FIELDS, SCHEMA_VERSION } from '../defSchema'
import { resolvePlotForInstance, columnColorsForPlot } from '../pool'
import { getDefinition } from '../nativeRegistry'
import { legendChips } from '../readout'
import { createBinder } from '../binder'
import { IND_TOKENS } from '../../designTokens'
import { createFakeChart } from './fakeChart'

const UP = '#3cb868'
const DOWN = '#e74c3c'
const PICK_UP = '#111111'
const PICK_DOWN = '#222222'

/** A two-colour line whose pair comes from two colour inputs, over a hidden
 *  condition column — the shape UCT RS's `rsLine` now has, in miniature. */
function twoColourDef() {
  return {
    schemaVersion: SCHEMA_VERSION, id: 'u_updown', version: 1,
    compute: { kind: 'native', fn: 'rsi', rev: 1 },
    meta: { name: 'Up/Down', shortName: 'UD', category: 'Momentum', tier: 'free', repaint: 'non-repainting' },
    placement: { target: 'pane', scale: { min: 0, max: 100 } },
    inputs: [
      { key: 'up', type: 'color', label: 'Up', default: UP },
      { key: 'down', type: 'color', label: 'Down', default: DOWN },
    ],
    plots: [
      { key: 'value', label: 'Value', style: 'line', color: '$up', width: 1,
        colorMode: 'column:cond', colorUp: '$up', colorDown: '$down', role: 'primary', legend: { decimals: 2 } },
      { key: 'cond', label: 'Cond', style: 'line', hidden: true, color: '#7f8ea3', width: 1, role: 'context', legend: { hide: true } },
    ],
    events: [],
  }
}

function validated(def = twoColourDef()) {
  const r = validateDefinition(def)
  expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  return r.def
}

// ─── 1. the schema ───────────────────────────────────────────────────────────

describe('the schema — colorUp/colorDown are in the substitution grammar', () => {
  it('SUBSTITUTABLE_PLOT_FIELDS names both', () => {
    expect(SUBSTITUTABLE_PLOT_FIELDS).toContain('colorUp')
    expect(SUBSTITUTABLE_PLOT_FIELDS).toContain('colorDown')
  })

  it('a definition with colorUp: "$a" validates, resolves to the default and records the ref', () => {
    const def = validated()
    const line = def.plots[0]
    expect(line.colorUp).toBe(UP)
    expect(line.colorDown).toBe(DOWN)
    // `width: 1` is a literal, so it records nothing; the three colours do.
    expect(line.$refs).toEqual({ color: 'up', colorUp: 'up', colorDown: 'down' })
  })

  it('a literal is left alone and records no ref', () => {
    const d = twoColourDef()
    d.plots[0].color = '#aaaaaa'
    d.plots[0].colorUp = '#abcdef'
    d.plots[0].colorDown = '#fedcba'
    const def = validated(d)
    expect(def.plots[0].colorUp).toBe('#abcdef')
    expect(def.plots[0].colorDown).toBe('#fedcba')
    expect(def.plots[0].$refs, 'all literals — nothing to remember').toBeUndefined()
  })

  it('⛔ a $ref on colorUp naming an UNDECLARED input is refused with the schema\'s message', () => {
    const d = twoColourDef()
    d.plots[0].colorUp = '$nope'
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    const err = r.errors.find((e) => e.startsWith('plots[0].colorUp:'))
    expect(err, JSON.stringify(r.errors)).toBeTruthy()
    expect(err).toMatch(/unresolvable \$ref/)
    expect(err).toMatch(/\$nope/)
    expect(err).toMatch(/never silently defaulted/)
  })

  it('⛔ and the same for colorDown — the two fields are one rule', () => {
    const d = twoColourDef()
    d.plots[0].colorDown = '$nope'
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.startsWith('plots[0].colorDown:') && /unresolvable \$ref/.test(e))).toBe(true)
  })

  it('a ref that resolves to a NON-colour is judged on what it becomes', () => {
    const d = twoColourDef()
    d.inputs.push({ key: 'n', type: 'int', label: 'N', default: 3, min: 1, max: 9 })
    d.plots[0].colorUp = '$n'
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    const err = r.errors.find((e) => e.startsWith('plots[0].colorUp:'))
    expect(err).toMatch(/expected a non-empty colour string/)
    expect(err).toMatch(/after substituting "\$n"/)
  })
})

// ─── 2. the resolver ─────────────────────────────────────────────────────────

describe('pool.resolvePlotForInstance — the member\'s pair, not the definition\'s', () => {
  it('resolves both from the instance inputs and leaves the definition plot untouched', () => {
    const line = validated().plots[0]
    const out = resolvePlotForInstance(line, { up: PICK_UP, down: PICK_DOWN })
    expect(out.colorUp).toBe(PICK_UP)
    expect(out.colorDown).toBe(PICK_DOWN)
    expect(out.color, 'the chip colour follows the same input').toBe(PICK_UP)
    expect(line.colorUp, 'pure — the definition keeps its default').toBe(UP)
  })

  it('a partial pick resolves one side and keeps the other default', () => {
    const line = validated().plots[0]
    const out = resolvePlotForInstance(line, { down: PICK_DOWN })
    expect(out.colorUp).toBe(UP)
    expect(out.colorDown).toBe(PICK_DOWN)
  })

  it('with nothing picked, the plot is returned as it is (identity)', () => {
    const line = validated().plots[0]
    expect(resolvePlotForInstance(line, {})).toBe(line)
  })

  it('a LITERAL pair is not touched by an input that happens to share a name', () => {
    const d = twoColourDef()
    d.plots[0].colorUp = '#abcdef'
    d.plots[0].colorDown = '#fedcba'
    const line = validated(d).plots[0]
    const out = resolvePlotForInstance(line, { up: PICK_UP, down: PICK_DOWN })
    expect(out.colorUp).toBe('#abcdef')
    expect(out.colorDown).toBe('#fedcba')
  })

  it('⭐ columnColorsForPlot — the binder\'s reader — sees the RESOLVED pair', () => {
    const line = validated().plots[0]
    expect(columnColorsForPlot(resolvePlotForInstance(line, { up: PICK_UP, down: PICK_DOWN })))
      .toEqual({ key: 'cond', up: PICK_UP, down: PICK_DOWN })
    expect(columnColorsForPlot(line)).toEqual({ key: 'cond', up: UP, down: DOWN })
  })
})

// ─── 3. the binder ───────────────────────────────────────────────────────────

const BARS = Array.from({ length: 6 }, (_, i) => ({ t: 1700000000 + i * 60, c: 10 + i }))
/** cond: 1,1,0,0,NaN,1 → up,up,down,down,down,up (an `na` condition takes the
 *  else branch — owner ruling 2, 2026-09-28). */
const COLUMNS = { value: [1, 2, 3, 4, 5, 6], cond: [1, 1, 0, 0, NaN, 1] }

/** Drive the REAL binder over the repo's fake chart with the VALIDATED
 *  definition, and hand back the data the visible plot was `setData`'d with. */
function pointsDrawn(def, inputs) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const registry = {
    getDefinition: (id) => (id === def.id ? def : null),
    computeFor: () => COLUMNS,
    hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
    columnKeys: (d) => (d.plots || []).map((p) => p.key),
  }
  binder.sync({
    enabled: true,
    instances: [{ instanceId: 'inst:u_updown:1', defId: def.id, inputs }],
    registry,
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 1, scaleId: 'u_updown', scaleOptions: {} }),
  })
  const setDatas = fake.calls.filter((c) => c.method === 'setData')
  expect(setDatas.length, 'exactly one series drawn — the hidden condition draws nothing').toBe(1)
  return setDatas[0].args[0]
}

describe('⭐⭐ the binder consumes the RESOLVED plot — the member\'s pair reaches the renderer', () => {
  it('a member\'s pick colours the points, bar by bar', () => {
    const points = pointsDrawn(validated(), { up: PICK_UP, down: PICK_DOWN })
    expect(points.map((p) => p.color)).toEqual([PICK_UP, PICK_UP, PICK_DOWN, PICK_DOWN, PICK_DOWN, PICK_UP])
    expect(points.map((p) => p.value), 'a colour rule never moves a number').toEqual([1, 2, 3, 4, 5, 6])
  })

  it('⛔ CONTROL: with nothing picked the definition defaults draw', () => {
    const points = pointsDrawn(validated(), {})
    expect(points.map((p) => p.color)).toEqual([UP, UP, DOWN, DOWN, DOWN, UP])
  })
})

// ─── 4. UCT Relative Strength ────────────────────────────────────────────────

describe('UCT RS — one hue on Classic, two on Phase, and a hidden condition plot', () => {
  const rs = getDefinition('rsLine')
  const line = rs.plots.find((p) => p.key === 'rsLine')
  const preset = (id) => rs.meta.presets.find((p) => p.id === id)
  const inputKeys = new Set(rs.inputs.map((i) => i.key))

  it('the line is coloured by the `rsAbove` column through two colour inputs', () => {
    expect(line.colorMode).toBe('column:rsAbove')
    expect(line.$refs.colorUp).toBe('color')
    expect(line.$refs.colorDown).toBe('lineDownColor')
    // The chip's one swatch follows the "above" colour.
    expect(line.$refs.color).toBe('color')
  })

  it('the two inputs live in the Line group, labelled by what they colour; `lineColor` is gone', () => {
    const up = rs.inputs.find((i) => i.key === 'color')
    const down = rs.inputs.find((i) => i.key === 'lineDownColor')
    expect(up).toMatchObject({ type: 'color', label: 'Line above avg', group: 'Line', default: '#6ba3be' })
    expect(down).toMatchObject({ type: 'color', label: 'Line below avg', group: 'Line', default: '#6ba3be' })
    expect(inputKeys.has('lineColor')).toBe(false)
    // ⭐ Review finding V3 (unit 7): two identical swatches for one line need to say
    // why, and the second needs to say what it colours — the dialog renders a
    // `tooltip` as visible row text under the control.
    expect(up.tooltip).toBe('Line colour above its average. Classic uses one colour; keep both swatches the same for a single-colour line')
    expect(down.tooltip).toBe('Line colour below its average; the Phase preset sets red here')
  })

  // ⭐ Visual review S1 (2026-11-06): seven of thirteen labels truncated to an
  // ellipsis in the Chart Settings inspector column, and the units were the part
  // cut. The long form lives in the tooltip; the label must fit the column.
  it('every RS input label fits the inspector column (17 characters) and the long form is in the tooltip', () => {
    const d = rs
    // 17 = the longest label that rendered whole in the 2026-11-06 recapture
    // ('High before price'); 'Short-history dots' at 18 still cut to 'Short-history d'.
    const MAX = 17
    for (const inp of d.inputs) {
      expect(inp.label.length, `${inp.key} label "${inp.label}" is ${inp.label.length} chars`).toBeLessThanOrEqual(MAX)
    }
    const byKey = Object.fromEntries(d.inputs.map((i) => [i.key, i]))
    expect(byKey.maLength.label).toBe('Average (bars)')
    expect(byKey.maLength.tooltip).toMatch(/^Average length in bars/)
    expect(byKey.lookback.label).toBe('Lookback (bars)')
    expect(byKey.lookback.tooltip).toMatch(/^New-high lookback/)
    expect(byKey.priceTolerance.label).toBe('Tolerance (%)')
    expect(byKey.priceTolerance.tooltip).toMatch(/^Price-high tolerance/)
    expect(byKey.showNewHighBeforePrice.label).toBe('High before price')
    expect(byKey.showNewHighBeforePrice.tooltip).toMatch(/^RS high before price/)
    expect(byKey.shortHistoryDots.label).toBe('Short history')  // VA2 rename, 2026-11-07
    expect(byKey.shortHistoryDots.tooltip).toMatch(/fewer bars than the lookback/)
  })

  it('⭐ Classic resolves to ONE hue for up and down — the ≤2 hues + 1 neutral budget holds', () => {
    const classic = preset('classic')
    expect(classic.inputs).toMatchObject({ color: '#6ba3be', lineDownColor: '#6ba3be' })
    const cc = columnColorsForPlot(resolvePlotForInstance(line, classic.inputs))
    expect(cc).toEqual({ key: 'rsAbove', up: '#6ba3be', down: '#6ba3be' })
    // And the untouched definition (first turn-on, nothing picked) draws the same.
    expect(columnColorsForPlot(line)).toEqual({ key: 'rsAbove', up: '#6ba3be', down: '#6ba3be' })
    expect(IND_TOKENS.classic.info, 'the blue is the Classic chart preset\'s `info` role').toBe('#6ba3be')
  })

  it('⭐ the Phase preset resolves to TWO — the Classic chart preset\'s bull above, bear below', () => {
    const phase = preset('phase')
    expect(phase).toMatchObject({ label: 'Phase (21 EMA)' })
    expect(phase.origin).toMatch(/Manrav video 59/)
    expect(phase.inputs).toMatchObject({ maLength: 21, maType: 'EMA', color: IND_TOKENS.classic.bull, lineDownColor: IND_TOKENS.classic.bear })
    const cc = columnColorsForPlot(resolvePlotForInstance(line, phase.inputs))
    expect(cc).toEqual({ key: 'rsAbove', up: '#3cb868', down: '#e74c3c' })
    expect(cc.up).not.toBe(cc.down)
  })

  it('every preset sets only DECLARED inputs, and the two presets set the same keys', () => {
    for (const p of rs.meta.presets) {
      for (const k of Object.keys(p.inputs)) expect(inputKeys.has(k), `${p.id} sets undeclared ${k}`).toBe(true)
    }
    expect(Object.keys(preset('phase').inputs).sort()).toEqual(Object.keys(preset('classic').inputs).sort())
  })

  it('the colours stay on the client — neither keys the server fetch', () => {
    expect(rs.meta.serverInputs).not.toContain('color')
    expect(rs.meta.serverInputs).not.toContain('lineDownColor')
  })

  it('`rsAbove` is a HIDDEN line plot, as the Awesome Oscillator declares `rising`', () => {
    const cond = rs.plots.find((p) => p.key === 'rsAbove')
    expect(cond).toMatchObject({ style: 'line', hidden: true, role: 'context', legend: { hide: true } })
    const rising = getDefinition('awesome').plots.find((p) => p.key === 'rising')
    expect(cond.hidden).toBe(rising.hidden)
    expect(cond.legend).toEqual(rising.legend)
  })

  it('⛔ the hidden `rsAbove` plot draws NO chip; the RS chip wears the "above" colour', () => {
    const registry = (id) => (id === 'rsLine' ? rs : null)
    const chipsFor = (inputs) => legendChips([], null, registry, [{ instanceId: 'i1', defId: 'rsLine', inputs }])
    const classic = chipsFor({})
    expect(classic.some((c) => c.plotKey === 'rsAbove')).toBe(false)
    const rsChip = classic.find((c) => c.plotKey === 'rsLine')
    expect(rsChip).toBeTruthy()
    expect(rsChip.color).toBe('#6ba3be')
    // The Phase preset's chip follows `color` — one swatch, the "above" hue.
    const phase = chipsFor(preset('phase').inputs)
    expect(phase.some((c) => c.plotKey === 'rsAbove')).toBe(false)
    expect(phase.find((c) => c.plotKey === 'rsLine').color).toBe('#3cb868')
    // Only the RS line declares a chip at all: MA, dots and the condition hide theirs.
    expect(classic.map((c) => c.plotKey)).toEqual(['rsLine'])
  })
})
