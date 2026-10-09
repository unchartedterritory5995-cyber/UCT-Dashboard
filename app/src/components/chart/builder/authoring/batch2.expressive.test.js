// BATCH 2 — EXPRESSIVE AUTHORING: the deterministic acceptance set.
//
// The conversational engine (`applyPatch` / `applyTurn`) with real trees; colours and
// tables are drawn by the shipped evaluators (`computeFor`, the object runtime). The
// model is not involved — these are the patches a model would send.
// ASKED / CLAIMED / DID per case.
import { describe, it, expect } from 'vitest'
import { parseFormula, astHash } from '../../engine/ast/parse'
import { interpret } from '../../engine/ast/interpret'
import { bindObjectProgram, assertObjectProgram } from '../../engine/ast/objectProgram'
import { evaluateObjects } from '../../engine/objectRuntime'
import { toRenderState } from '../../engine/objectRenderState'
import * as registry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from '../memberPane/memberPaneDefinition'
import { applyPatch, applyTurn, openAuthoringState, newAuthoringState, undo, prepareSave } from './index'
import { readback, presentationLines } from './readback'
import { compactView } from './compactView'
import { validatePatchShape } from './patchValidate'
import { tableSpecOfDefinition } from './tables'
import { modelOf } from './model'
import { plotColorRule, paintStatesOf } from './colorRules'
import { derivedDefName } from './derivedName'
import { symTickersOf } from '../../engine/otherSymbols'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const C = 'uct.authoring.patch/1'
const env = (rev, ops) => ({ contract: C, baseRevision: rev, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'AAPL' }
const N = 260
const mk = (seed, drift) => Array.from({ length: N }, (_, i) => {
  const c = 100 + drift * i + 7 * Math.sin(i / (6 + seed)) + 2.5 * Math.cos(i / 3.3)
  return { t: 1_700_000_000 + i * 86400, o: c - 0.6 + 0.3 * Math.sin(i), h: c + 1.8, l: c - 1.7, c, v: 1_000_000 + 41_000 * ((i * 7 + seed) % 13) }
})
const BARS = mk(1, 0.12)
const SPY = mk(4, 0.05)
const applied = (r) => { expect(r.status, JSON.stringify(r.errors)).toBe('applied'); return r.definition }

/** A definition's per-bar colours for one plot, through the shipped palette reading. */
function paletteColours(def, plotKey) {
  const plot = def.plots.find((p) => p.key === plotKey)
  const col = plot.colorMode.slice('column:'.length)
  registry.installUserDefinitions([def])
  const cols = registry.computeFor(def, BARS, {}, { tf: 'D', symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } })
  const idx = Array.from(cols[col])
  return idx.map((c) => (Number.isInteger(c) && c >= 0 && c < plot.colorPalette.length ? plot.colorPalette[c] : null))
}

/** Draw a definition's table the way the chart's object lane does. */
function renderTable(def, bars = BARS) {
  assertObjectProgram(def.objects)
  const bound = bindObjectProgram(def.objects, (i) => i)
  const cols = def.objects.trees.map((tree) => Array.from(interpret(tree, bars, {}, undefined, undefined,
    { tf: 'D', semantics: 2, symbols: { SPY: SPY.slice(0, bars.length) } })))
  const res = evaluateObjects(bound, { barCount: bars.length, readNode: (n, b) => (cols[n] ? cols[n][b] : NaN), readTime: (i) => bars[i].t })
  return toRenderState(res.live, { bars }).tables[0]
}

// ─── 1. four-state histogram ────────────────────────────────────────────────────

const HIST = 'ema(close, 12) - ema(close, 26)'
const FOUR = [
  { relation: 'positive_rising', color: '#00e676' },
  { relation: 'positive_falling', color: '#1b5e20' },
  { relation: 'negative_falling', color: '#d50000' },
  { relation: 'negative_rising', color: '#ff9800' },
]
const histCreate = [
  { op: 'create', name: 'Momentum histogram', placement: 'pane', outputs: [{ key: 'hist', label: 'Momentum', tree: P(HIST) }] },
  { op: 'set_style', output: 'hist', style: 'histogram' },
  { op: 'set_color_states', output: 'hist', states: FOUR },
]

describe('1 · four-state histogram', () => {
  it('ASKED bright green when positive and rising, dark green positive and falling, red negative and falling, orange negative and rising · DID a palette over one hidden state column (EXACT)', () => {
    expect(validatePatchShape(env(0, histCreate)).ok).toBe(true)
    const def = applied(applyPatch(null, env(0, histCreate), { gateCtx: GATE }))
    const plot = def.plots.find((p) => p.key === 'hist')
    expect(plot.colorMode).toBe('column:hist_cs')
    expect(plot.colorPalette).toEqual(FOUR.map((s) => s.color))
    expect(def.plots.find((p) => p.key === 'hist_cs')).toMatchObject({ hidden: true })
    const rule = plotColorRule(def, plot)
    expect(rule.rule).toBe('states')
    expect(rule.states.map((s) => s.relation)).toEqual(FOUR.map((s) => s.relation))
    expect(presentationLines(def).join('\n')).toMatch(/coloured by state: .* when above zero and rising, .* when below zero and rising; its normal colour otherwise/)
    // the hidden column is not an output the member reads
    expect(readback(def, {}, GATE).outputs.map((o) => o.key)).toEqual(['hist'])
  })

  it('the colours equal the Pine import of the same rule, bar for bar (where both answer)', () => {
    const def = applied(applyPatch(null, env(0, histCreate), { gateCtx: GATE }))
    const ours = paletteColours(def, 'hist')
    const pine = memberPaneDefinition({ id: 'u_pine_hist_cmp', name: 'pine', source: `//@version=5
indicator("h")
val = ta.ema(close, 12) - ta.ema(close, 26)
c = val > 0 ? (val > val[1] ? #00e676 : #1b5e20) : (val < val[1] ? #d50000 : #ff9800)
plot(val, style = plot.style_histogram, color = c)
` })
    expect(pine.ok, pine.reason).toBe(true)
    const pdef = pine.definition
    const pplot = pdef.plots.find((p) => typeof p.colorMode === 'string' && p.colorMode.startsWith('column:') && Array.isArray(p.colorPalette))
    expect(pplot).toBeTruthy()
    const theirs = paletteColours(pdef, pplot.key)
    let compared = 0
    for (let i = 40; i < N; i += 1) {
      if (ours[i] === null || theirs[i] === null) continue
      expect(ours[i]?.toLowerCase(), `bar ${i}`).toBe(theirs[i]?.toLowerCase())
      compared += 1
    }
    expect(compared).toBeGreaterThan(180)       // non-vacuous: the four colours really alternate
    expect(new Set(ours.filter(Boolean)).size).toBe(4)
  })

  it('states FOLLOW the line: changing its maths keeps "rising" about the new line', () => {
    const def = applied(applyPatch(null, env(0, histCreate), { gateCtx: GATE }))
    const st = openAuthoringState(def, { defId: 'u_0a1b2c3d4e5f', version: 1 })
    const t = applyTurn(st, env(st.revision, [{ op: 'set_output_tree', output: 'hist', tree: P('ema(close, 8) - ema(close, 21)') }]), { gateCtx: GATE })
    expect(t.result.status, JSON.stringify(t.result.errors)).toBe('applied')
    const rule = plotColorRule(t.state.working, t.state.working.plots.find((p) => p.key === 'hist'))
    expect(rule.states.map((s) => s.relation)).toEqual(FOUR.map((s) => s.relation))
  })
})

// ─── 2. three-state candles ─────────────────────────────────────────────────────

const candleOps = [
  { op: 'create', name: 'Trend candles', placement: 'price', outputs: [{ key: 'fast', label: 'EMA 10', tree: P('ema(close, 10)') }, { key: 'slow', label: 'EMA 30', tree: P('ema(close, 30)') }] },
  { op: 'set_color_states', channel: 'barcolor', states: [
    { when: P('ema(close, 10) > ema(close, 30) * 1.01'), color: '#00c853' },
    { when: P('ema(close, 10) < ema(close, 30) * 0.99'), color: '#d50000' }],
  otherwise: '#ffd600' },
]

describe('2 · three-state candle colouring', () => {
  it('ASKED green in an uptrend, yellow in consolidation, red in a downtrend · DID one candle palette paint (EXACT)', () => {
    const def = applied(applyPatch(null, env(0, candleOps), { gateCtx: GATE }))
    const paint = def.paints.find((p) => p.kind === 'barcolor')
    expect(paint).toMatchObject({ colorMode: 'column:candles_cs', colorPalette: ['#00c853', '#d50000', '#ffd600'] })
    const states = paintStatesOf(def)
    expect(states).toHaveLength(1)
    expect(states[0].otherwise).toBe('#ffd600')
    expect(presentationLines(def).join('\n')).toMatch(/candles painted by state: .*; .* otherwise/)
    registry.installUserDefinitions([def])
    const cols = registry.computeFor(def, BARS, {}, { tf: 'D' })
    const idx = Array.from(cols.candles_cs).filter(Number.isFinite)
    expect(new Set(idx)).toEqual(new Set([0, 1, 2]))       // all three states occur
  })

  it('⛔ a state that is a number, not a yes/no, is refused by name', () => {
    const r = applyPatch(null, env(0, [candleOps[0], { op: 'set_color_states', channel: 'bgcolor', states: [
      { when: P('ema(close, 10)'), color: '#00c853' }], otherwise: '#000000' }]), { gateCtx: GATE })
    expect(r.status).toBe('refused')
    expect(r.errors[0].code).toBe('color:state-not-yes-no')
  })

  it('⛔ more than four colours, or a single colour, is refused', () => {
    const five = [1, 2, 3, 4].map((k) => ({ when: P(`close > open * ${1 + k / 100}`), color: '#00c853' }))
    const r = applyPatch(null, env(0, [candleOps[0], { op: 'set_color_states', channel: 'barcolor', states: five, otherwise: '#000000' }]), { gateCtx: GATE })
    expect(r.errors[0].code).toBe('color:states-limit')
    const one = applyPatch(null, env(0, [candleOps[0], { op: 'set_color_states', channel: 'barcolor', states: [five[0]] }]), { gateCtx: GATE })
    expect(one.errors[0].code).toBe('color:states-few')
  })
})

// ─── 3/4. conditional multi-cell table with a merged header ──────────────────────

const tableOps = [
  { op: 'create', name: 'Status board', placement: 'price', outputs: [
    { key: 'rsi', label: 'RSI 14', tree: P('rsi(close, 14)'), hidden: true },
    { key: 'bull', label: 'RSI bullish', tree: P('rsi(close, 14) > 50'), hidden: true },
    { key: 'trend', label: 'Uptrend', tree: P('ema(close, 20) > ema(close, 50)'), hidden: true },
    { key: 'rs', label: 'RS vs SPY', tree: P('close / sym("SPY", close)'), hidden: true },
    { key: 'rsUp', label: 'RS rising', tree: P('close / sym("SPY", close) > sma(close / sym("SPY", close), 20)'), hidden: true }] },
  { op: 'set_table', position: 'top_right', cells: [
    { row: 0, col: 0, text: 'Market status', bold: true, size: 'large', span: 2 },
    { row: 1, col: 0, text: 'RSI' }, { row: 1, col: 1, output: 'rsi', format: 'decimal1', colorWhen: { output: 'bull', true: '#00c853', false: '#d50000' } },
    { row: 2, col: 0, text: 'Trend' }, { row: 2, col: 1, output: 'trend', labels: { true: 'Bullish', false: 'Bearish' }, backgroundWhen: { output: 'trend', true: '#1b5e20', false: '#b71c1c' } },
    { row: 3, col: 0, text: 'RS vs SPY' }, { row: 3, col: 1, output: 'rs', format: 'decimal3', colorWhen: { output: 'rsUp', true: '#00c853', false: '#d50000' } }] },
]

describe('3/4 · conditional table, status words, merged title', () => {
  it('ASKED RSI, trend and relative strength, bullish green / bearish red, a title across the top · DID (EXACT)', () => {
    expect(validatePatchShape(env(0, tableOps)).ok).toBe(true)
    const def = applied(applyPatch(null, env(0, tableOps), { gateCtx: GATE }))
    const spec = tableSpecOfDefinition(def)
    expect(spec.cells).toEqual(tableOps[1].cells)                       // round-trips exactly
    const table = renderTable(def)
    const cell = (r, c) => table.cells.find((x) => x.row === r && x.col === c)
    expect(cell(0, 0)).toMatchObject({ text: 'Market status', colspan: 2, text_size: 'large' })
    const rsiBull = interpret(P('rsi(close, 14) > 50'), BARS)[N - 1] === 1
    expect(cell(1, 1).text_color.toLowerCase()).toBe(rsiBull ? '#00c853' : '#d50000')
    const up = interpret(P('ema(close, 20) > ema(close, 50)'), BARS)[N - 1] === 1
    expect(cell(2, 1).text).toBe(up ? 'Bullish' : 'Bearish')
    expect(cell(2, 1).bgcolor.toLowerCase()).toBe(up ? '#1b5e20' : '#b71c1c')
    expect(cell(3, 1).text).toMatch(/^\d+\.\d{3}$/)                    // the other symbol was read
    expect(symTickersOf(def)).toContain('SPY')
    expect(presentationLines(def).join('\n')).toMatch(/across 2 columns; large text/)
  })

  it('an UNKNOWN test keeps the plain colour — never a neighbouring state', () => {
    const def = applied(applyPatch(null, env(0, tableOps), { gateCtx: GATE }))
    // 8 bars: a 14-bar RSI and a 50-bar EMA have no answer yet — genuinely unknown
    const t = renderTable(def, BARS.slice(0, 8))
    const rsi = t.cells.find((x) => x.row === 1 && x.col === 1)
    expect(rsi.text).toBe('—')
    expect(String(rsi.text_color).toLowerCase()).not.toBe('#00c853')
    expect(String(rsi.text_color).toLowerCase()).not.toBe('#d50000')
    const trend = t.cells.find((x) => x.row === 2 && x.col === 1)
    expect(trend.text).toBe('—')
    expect(String(trend.bgcolor || '').toLowerCase()).not.toBe('#1b5e20')
    expect(String(trend.bgcolor || '').toLowerCase()).not.toBe('#b71c1c')
  })

  it('⛔ a cell colour that follows a NUMBER, a span past the table, a cell inside a merge — refused by name', () => {
    const bad = (cells) => applyPatch(null, env(0, [tableOps[0], { op: 'set_table', cells }]), { gateCtx: GATE })
    expect(bad([{ row: 0, col: 0, output: 'rsi', colorWhen: { output: 'rsi', true: '#00c853', false: '#d50000' } }]).errors[0].message).toMatch(/is a number; a cell's text colour follows a yes\/no/)
    expect(bad([{ row: 0, col: 5, text: 'x', span: 2 }]).errors[0].message).toMatch(/column 6 at most/)
    expect(bad([{ row: 0, col: 0, text: 'T', span: 3 }, { row: 0, col: 1, text: 'x' }]).errors[0].message).toMatch(/inside the merged cell/)
  })

  it('a follow-up that edits the test a colour follows re-derives the table in the same patch', () => {
    const def = applied(applyPatch(null, env(0, tableOps), { gateCtx: GATE }))
    const st = openAuthoringState(def, { defId: 'u_0a1b2c3d4e5e', version: 1 })
    const t = applyTurn(st, env(st.revision, [{ op: 'set_output_tree', output: 'bull', tree: P('rsi(close, 14) > 60') }]), { gateCtx: GATE })
    expect(t.result.status, JSON.stringify(t.result.errors)).toBe('applied')
    expect(tableSpecOfDefinition(t.state.working).cells).toEqual(tableOps[1].cells)
    expect(t.state.working.objects.trees.some((x) => astHash(x) === astHash(P('rsi(close, 14) > 60')))).toBe(true)
  })
})

// ─── 5. marker styling ─────────────────────────────────────────────────────────

describe('5 · marker styling', () => {
  it('ASKED big orange up-arrows for the buy signal, small grey circles for the exit · DID size + colour, the signal maths untouched', () => {
    const ops = [
      { op: 'create', name: 'Signals', placement: 'price', outputs: [
        { key: 'buy', label: 'Buy', tree: P('crossOver(close, ema(close, 20))') },
        { key: 'exit', label: 'Exit', tree: P('crossUnder(close, ema(close, 20))') }] },
      { op: 'set_marker', output: 'buy', shape: 'arrowUp', position: 'belowBar', size: 2, color: '#ff9800' },
      { op: 'set_marker', output: 'exit', shape: 'circle', position: 'aboveBar', size: 0.5, color: '#9e9e9e' },
    ]
    expect(validatePatchShape(env(0, ops)).ok).toBe(true)
    const def = applied(applyPatch(null, env(0, ops), { gateCtx: GATE }))
    const buy = def.plots.find((p) => p.key === 'buy')
    expect(buy).toMatchObject({ style: 'markers', marker: { shape: 'arrowUp', position: 'belowBar', size: 2 } })
    // the colour is the plot's own colour SETTING (a `$` reference to its input), as every authored plot's is
    const colourOf = (p) => (typeof p.color === 'string' && p.color.startsWith('$')
      ? def.inputs.find((x) => x.key === p.color.slice(1)).default : p.color)
    expect(colourOf(buy)).toBe('#ff9800')
    expect(colourOf(def.plots.find((p) => p.key === 'exit'))).toBe('#9e9e9e')
    expect(def.plots.find((p) => p.key === 'exit').marker.size).toBe(0.5)
    expect(presentationLines(def).join('\n')).toMatch(/size 2/)
    const plain = applied(applyPatch(null, env(0, [ops[0]]), { gateCtx: GATE }))
    expect(JSON.stringify(def.compute)).toBe(JSON.stringify(plain.compute))   // the signal calculation is identical
    expect(applyPatch(null, env(0, [ops[0], { ...ops[1], size: 9 }]), { gateCtx: GATE }).status).toBe('refused')
  })
})

// ─── 6/7. vocabulary through the conversational door ──────────────────────────────

describe('6/7 · linear regression and cross-symbol correlation, authored', () => {
  it('ASKED a 50-bar linear regression · DID store the expansion, read back and named as the regression', () => {
    const tree = { type: 'call', name: 'linreg', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 50 }, { type: 'num', value: 0 }] }
    expect(validatePatchShape(env(0, [{ op: 'create', name: 'LinReg', outputs: [{ key: 'value', tree }] }])).ok).toBe(true)
    const def = applied(applyPatch(null, env(0, [{ op: 'create', name: 'x', placement: 'price', outputs: [{ key: 'value', tree }] }]), { gateCtx: GATE }))
    expect(JSON.stringify(def.compute)).not.toMatch(/"linreg"/)
    // the stored source is the READABLE form (a zero offset is the default and not written)
    const sources = JSON.stringify(def.compute)
    expect(sources).toMatch(/linreg\(close, 50\)/)
    const rb = readback(def, {}, GATE)
    expect(rb.outputs[0].sentence).toMatch(/the 50-bar linear regression of close/)
    expect(derivedDefName(modelOf(def))).toMatch(/LINREG 50/)
  })

  it('ASKED the 20-day correlation of this stock with SPY · DID cross-symbol, computed when SPY bars are supplied', () => {
    const tree = P('correlation(close, sym("SPY", close), 20)')
    const def = applied(applyPatch(null, env(0, [{ op: 'create', name: 'Correlation with SPY', outputs: [{ key: 'value', tree }] }]), { gateCtx: GATE }))
    expect(symTickersOf(def)).toEqual(['SPY'])
    const col = interpret(tree, BARS, {}, undefined, undefined, { tf: 'D', symbols: { SPY } })
    const last = col[N - 1]
    expect(last).toBeGreaterThanOrEqual(-1)
    expect(last).toBeLessThanOrEqual(1)
    expect(readback(def, {}, GATE).outputs[0].sentence).toMatch(/correlation of close with/)
    // the model's view shows the call, and offers no slot inside it
    const view = compactView(def, openAuthoringState(def, { defId: 'u_1a1b2c3d4e5f', version: 1 }), GATE)
    expect(view.definition.outputs[0].formula).toBe("correlation(close, sym('SPY', close), 20)")
    expect(view.definition.outputs[0].slots).toEqual([])
    expect(view.capabilities.formulaFunctions).toContain('correlation(source1, source2, length)')
  })
})

// ─── 8/9. save → reopen exact; follow-up changes one state; undo ───────────────────

describe('8/9 · reopen exactly; change one colour state; undo', () => {
  it('a saved definition reopens EXACTLY, and an unrelated follow-up keeps every presentation field', () => {
    const def = applied(applyPatch(null, env(0, [...histCreate, candleOps[1],
      { op: 'add_output', key: 'sig', label: 'Signal', tree: P('ema(ema(close, 12) - ema(close, 26), 9)') }]), { gateCtx: GATE }))
    const stored = { ...def, id: 'u_0c1b2c3d4e5f', version: 3 }
    const st = openAuthoringState(stored, { defId: stored.id, version: 3 })
    expect(st.working).toBe(stored)                                     // OPEN != MUTATE
    const look = (d) => JSON.stringify({ plots: d.plots.map((p) => { const rest = { ...p }; delete rest.label; return rest }), paints: d.paints, objects: d.objects || null, inputs: d.inputs })
    const t = applyTurn(st, env(st.revision, [{ op: 'set_levels', values: [0] }]), { gateCtx: GATE })
    expect(t.result.status, JSON.stringify(t.result.errors)).toBe('applied')
    const after = { ...t.state.working, plots: t.state.working.plots.filter((p) => p.style !== 'hlines') }
    expect(look(after)).toBe(look(stored))
    const prep = prepareSave(t.state)
    expect(prep.errors).toEqual([])
    expect(prep.doc).toMatchObject({ id: stored.id, version: 4 })
    // the reopened states still read back as states
    expect(plotColorRule(t.state.working, t.state.working.plots.find((p) => p.key === 'hist')).rule).toBe('states')
    expect(paintStatesOf(t.state.working)).toHaveLength(1)
  })

  it('"make the falling-below-zero state purple" changes ONE palette entry; undo restores it exactly', () => {
    const def = applied(applyPatch(null, env(0, histCreate), { gateCtx: GATE }))
    const st = openAuthoringState(def, { defId: 'u_0d1b2c3d4e5f', version: 1 })
    const next = FOUR.map((s) => (s.relation === 'negative_falling' ? { ...s, color: '#7b1fa2' } : s))
    const t = applyTurn(st, env(st.revision, [{ op: 'set_color_states', output: 'hist', states: next }]), { gateCtx: GATE })
    expect(t.result.status, JSON.stringify(t.result.errors)).toBe('applied')
    expect(t.state.working.plots.find((p) => p.key === 'hist').colorPalette).toEqual(['#00e676', '#1b5e20', '#7b1fa2', '#ff9800'])
    const back = undo(t.state)
    expect(JSON.stringify(back.working)).toBe(JSON.stringify(def))
  })

  it('a two-colour rule replaces states (and back) without leaving a hidden column behind', () => {
    const def = applied(applyPatch(null, env(0, histCreate), { gateCtx: GATE }))
    const st = openAuthoringState(def, { defId: 'u_0e1b2c3d4e5f', version: 1 })
    const t = applyTurn(st, env(st.revision, [{ op: 'set_color_rule', output: 'hist', rule: 'sign', up: '#00e676', down: '#d50000' }]), { gateCtx: GATE })
    expect(t.result.status, JSON.stringify(t.result.errors)).toBe('applied')
    expect(t.state.working.plots.map((p) => p.key)).toEqual(['hist'])
    expect(t.state.working.plots[0].colorPalette).toBeUndefined()
    const off = applyTurn(openAuthoringState(def, { defId: 'u_0e1b2c3d4e5f', version: 1 }), env(0, [{ op: 'set_color_states', output: 'hist', states: [] }]), { gateCtx: GATE })
    expect(off.result.status).toBe('applied')
    expect(off.state.working.plots.map((p) => p.key)).toEqual(['hist'])
  })
})

// ─── security and legacy ───────────────────────────────────────────────────────

describe('colour security, version handling, legacy compatibility', () => {
  it('⛔ a non-colour in any new colour field is refused at the patch door', () => {
    const evil = 'url(https://evil.example/x)'
    expect(validatePatchShape(env(0, [{ op: 'set_color_states', output: 'v', states: [{ relation: 'rising', color: evil }, { relation: 'falling', color: '#000000' }] }])).ok).toBe(false)
    expect(validatePatchShape(env(0, [{ op: 'set_marker', output: 'v', shape: 'circle', color: evil }])).ok).toBe(false)
    expect(validatePatchShape(env(0, [{ op: 'set_table', cells: [{ row: 0, col: 0, text: 'x', colorWhen: { output: 'v', true: evil, false: '#000000' } }] }])).ok).toBe(false)
  })

  it('a definition with none of the new features builds byte-identically (no field appears)', () => {
    const plain = applied(applyPatch(null, env(0, [{ op: 'create', name: 'EMA 20', placement: 'price', outputs: [{ key: 'value', label: 'EMA 20', tree: P('ema(close, 20)') }] }]), { gateCtx: GATE }))
    const text = JSON.stringify(plain)
    for (const k of ['colorPalette', '_cs', 'mergecells', 'text_size', 'colorWhen']) expect(text).not.toContain(k)
    expect(newAuthoringState().revision).toBe(0)
  })
})
