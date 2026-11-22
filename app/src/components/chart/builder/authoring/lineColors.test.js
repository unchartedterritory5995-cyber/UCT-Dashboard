// SEVERAL LINES, SEVERAL COLOURS (applyPatch.js, `LINE_COLORS`; ruling 2026-11-18).
//
// Every new line used to take the one default colour, so an indicator with several lines (+DI,
// -DI and ADX; a Fisher line and its trigger) was drawn as lines nobody could tell apart. Held
// here: the first number line keeps the default; each one after it takes the next of the chart's
// own moving-average slot colours; an indicator with ONE number line is exactly as it was; a
// true/false output and a hidden line take no slot; a line added later takes a colour no line of
// that indicator already wears; and a colour the member chose is never touched.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { applyPatch, newAuthoringState, applyTurn } from './index'
import { LINE_COLORS, lineColorAt } from './applyPatch'
import { CHART_DEFAULTS } from '../../chartDefaults'
import { BUILDER_INPUTS } from '../builderInputs'
import { compactView } from './compactView'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const C = 'uct.authoring.patch/1'
const GATE = { tf: 'D', symbol: 'AAPL' }
const GOLD = BUILDER_INPUTS[0].default
const [GREEN, PINK, BLUE, ORANGE] = CHART_DEFAULTS.overlays.map((o) => o.color)
const out = (key, src, extra = {}) => ({ key, label: key, tree: P(src), ...extra })
const create = (outputs, placement = 'pane') => ({ contract: C, baseRevision: 0, disposition: 'change', assumptions: [],
  ops: [{ op: 'create', name: 'x', placement, outputs }] })
/** What a member SEES: each output's resolved colour, read from the view the window itself builds. */
const colours = (def) => Object.fromEntries(compactView(def, {}, GATE).definition.outputs.map((o) => [o.key, o.presentation.color]))
const built = (outputs) => {
  const r = applyPatch(null, create(outputs), { gateCtx: GATE })
  expect(r.status, JSON.stringify(r.errors)).toBe('applied')
  return r.definition
}

describe('the palette', () => {
  it('is the default line colour, then the chart\'s own moving-average slot colours, in slot order', () => {
    expect(LINE_COLORS).toEqual([GOLD, GREEN, PINK, BLUE, ORANGE])
    expect(LINE_COLORS).toEqual(['#c9a84c', '#4ade80', '#f472b6', '#60a5fa', '#fb923c'])   // as they stand today; a change is seen
    expect(new Set(LINE_COLORS).size).toBe(LINE_COLORS.length)                              // every one distinct
    // past the last slot they go round again, and the default is never repeated
    expect([0, 1, 2, 3, 4, 5, 6, 8].map(lineColorAt)).toEqual([GOLD, GREEN, PINK, BLUE, ORANGE, GREEN, PINK, ORANGE])
  })
})

describe('a new indicator', () => {
  it('⛔ with ONE number line is exactly as it was', () => {
    expect(colours(built([out('ma', 'ema(close, 20)')]))).toEqual({ ma: GOLD })
    // ... with a signal beside it too: a true/false output is not a line among lines
    expect(colours(built([out('cross', 'close > ema(close, 20)'), out('ma', 'ema(close, 20)')]))).toEqual({ cross: GOLD, ma: GOLD })
    expect(colours(built([out('ma', 'ema(close, 20)'), out('cross', 'close > ema(close, 20)')]))).toEqual({ ma: GOLD, cross: GOLD })
  })

  it('with several number lines draws each in its own colour, in the order they were written', () => {
    const three = built([out('plus', 'ema(high, 14)'), out('minus', 'ema(low, 14)'), out('adx', 'ema(close, 14)')])
    expect(colours(three)).toEqual({ plus: GOLD, minus: GREEN, adx: PINK })
    const six = built(['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => out(k, `ema(close, ${10 + i})`)))
    expect(Object.values(colours(six))).toEqual([GOLD, GREEN, PINK, BLUE, ORANGE, GREEN])
  })

  it('a hidden line and a true/false output take no slot', () => {
    const def = built([
      out('work', 'ema(close, 5)', { hidden: true }),            // a hidden working line
      out('fast', 'ema(close, 10)'),
      out('up', 'ema(close, 10) > ema(close, 30)'),              // true/false
      out('slow', 'ema(close, 30)'),
    ])
    expect(colours(def)).toEqual({ work: GOLD, fast: GOLD, up: GOLD, slow: GREEN })
  })
})

describe('a line added later', () => {
  const turn = (state, ops) => {
    const r = applyTurn(state, { contract: C, baseRevision: state.revision, disposition: 'change', assumptions: [], ops }, { gateCtx: GATE })
    expect(r.result.status, JSON.stringify(r.result.errors)).toBe('applied')
    return r.state
  }
  const start = (outputs) => turn(newAuthoringState(), [{ op: 'create', name: 'x', placement: 'pane', outputs }])

  it('takes the first colour no number line of that indicator already wears', () => {
    let s = start([out('fast', 'ema(close, 10)')])
    s = turn(s, [{ op: 'add_output', key: 'slow', tree: P('ema(close, 30)') }])
    expect(colours(s.working)).toEqual({ fast: GOLD, slow: GREEN })
    s = turn(s, [{ op: 'add_output', key: 'mid', tree: P('ema(close, 20)') }])
    expect(colours(s.working)).toEqual({ fast: GOLD, slow: GREEN, mid: PINK })
  })

  it('never matches a colour the member chose, and never touches it', () => {
    let s = start([out('fast', 'ema(close, 10)'), out('slow', 'ema(close, 30)')])
    s = turn(s, [{ op: 'set_style', output: 'fast', color: GREEN }])        // the member makes the first line green
    expect(colours(s.working)).toEqual({ fast: GREEN, slow: GREEN })         // their choice stands, even when it now matches
    s = turn(s, [{ op: 'add_output', key: 'mid', tree: P('ema(close, 20)') }])
    expect(colours(s.working)).toEqual({ fast: GREEN, slow: GREEN, mid: GOLD })   // the first colour nobody wears
  })

  it('a true/false output added later keeps the default, and a number line added beside only a signal keeps it too', () => {
    let s = start([out('cross', 'close > ema(close, 20)')])
    s = turn(s, [{ op: 'add_output', key: 'ma', tree: P('ema(close, 20)') }])
    expect(colours(s.working)).toEqual({ cross: GOLD, ma: GOLD })
    s = turn(s, [{ op: 'add_output', key: 'again', tree: P('close < ema(close, 20)') }])
    expect(colours(s.working)).toEqual({ cross: GOLD, ma: GOLD, again: GOLD })
  })
})
