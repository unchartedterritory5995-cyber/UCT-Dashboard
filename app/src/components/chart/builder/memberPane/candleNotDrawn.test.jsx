// app/src/components/chart/builder/memberPane/candleNotDrawn.test.jsx
//
// ─── ⛔⛔ H14 (2026-09-28) — A CANDLE AT THE HOST MEMBER DOOR IS SAID, NOT DRAWN AS FOUR LINES ─
//
// `plotcandle` / `plotbar` translate to four rows. The host door drew each one
// that was not a bare price passthrough as a visible `style: 'line'`, live on
// production, on two committed corpus scripts. This rail drives both of those
// scripts through the REAL door (`memberPaneDefinition`) and the real
// `MemberPane`, and asserts:
//   1. no row of the candle reaches the document (by AST identity with the
//      translation's candle outputs, so a relabelled row cannot slip past);
//   2. the member reads the runtime lane's sentence, as RENDERED DOM TEXT —
//      in the refusal when the candle was all the pane could draw, in the
//      disclosures when the pane attaches;
//   3. CONTROL: an ordinary `plot` added to the same script still draws as a
//      visible line, and the candle is still disclosed beside it;
//   4. a bare price passthrough candle is unchanged (carried hidden, no sentence).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import * as engineRegistry from '../../engine/nativeRegistry'
import { MULTI_OUTPUT_CALLS } from '../../engine/ast/pine'
import { memberPaneDefinition } from './memberPaneDefinition'
import { MULTI_OUTPUT_NOT_DRAWN, isUndrawnMultiOutput } from './candleNotDrawn'
import MemberPane from './MemberPane.jsx'

const paneProps = []
vi.mock('../../pane/ChartPane', () => ({
  default: (props) => { paneProps.push(props); return <div data-testid="mock-chart-pane" /> },
}))

const REPO = path.resolve(process.cwd(), '..')
const corpus = (name) => fs.readFileSync(path.join(REPO, 'corpus', 'committed', `${name}.pine`), 'utf8')
const DEF_ID = 'u_member-pane-candle'

const setMemberPane = (v) => {
  if (v === undefined) delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  else import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = v
}
beforeEach(() => { paneProps.length = 0; setMemberPane('1') })
afterEach(() => {
  cleanup()
  setMemberPane(undefined)
  vi.unstubAllEnvs()
  engineRegistry.uninstallUserDefinition(DEF_ID)
})

const SENTENCE = (call, line) =>
  `This script's \`${call}\` (line ${line}) ${MULTI_OUTPUT_NOT_DRAWN[call]}.`

const SCRIPTS = [
  { script: 'institutional-smc-order-flow-matrix-pro__0b30cae0e6', line: 85 },
  { script: 'smt-divergence-ict-01-tradingfinder-smart-money-technique__3f66e16b3c', line: 116 },
]

const candleOutputs = (d) => (d.translation.outputs || [])
  .filter((o) => Object.prototype.hasOwnProperty.call(MULTI_OUTPUT_CALLS, o.kind))
const candleRows = (d) => {
  const asts = new Set(candleOutputs(d).map((o) => o.ast))
  return (d.rows || []).filter((r) => asts.has(r.ast))
}
const noteItems = () => {
  const list = screen.queryByTestId('pine-member-pane-notes')
  return list ? [...list.querySelectorAll('li')].map((li) => li.textContent) : []
}

describe('the sentence map is derived from MULTI_OUTPUT_CALLS, never retyped', () => {
  it('every multi-output call has a sentence, and nothing else does', () => {
    expect(Object.keys(MULTI_OUTPUT_NOT_DRAWN).sort())
      .toEqual(Object.keys(MULTI_OUTPUT_CALLS).sort())
    expect(Object.keys(MULTI_OUTPUT_CALLS).length).toBeGreaterThan(0) // non-vacuity
  })
  it('`constructor` is not a candle (own-property test, not `in`)', () => {
    expect(isUndrawnMultiOutput({ kind: 'constructor', hidden: false })).toBe(false)
    expect(isUndrawnMultiOutput({ kind: 'plot', hidden: false })).toBe(false)
    expect(isUndrawnMultiOutput({ kind: 'plotcandle', hidden: false })).toBe(true)
    expect(isUndrawnMultiOutput({ kind: 'plotcandle', hidden: true })).toBe(false)
  })
})

describe.each(SCRIPTS)('$script — through the real member door', ({ script, line }) => {
  it('non-vacuity: the translation still COMPUTES the candle — four visible rows the old door drew as lines', () => {
    const d = memberPaneDefinition({ source: corpus(script), id: DEF_ID })
    const c = candleOutputs(d)
    expect(c.map((o) => o.kind)).toEqual(['plotcandle', 'plotcandle', 'plotcandle', 'plotcandle'])
    expect(c.every((o) => !o.hidden && o.ast && o.formula && !o.refusal)).toBe(true)
    expect(c.every((o) => o.line === line)).toBe(true)
  })

  it('objects-only OFF: refused BY NAME, rendered, and nothing is drawn', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
    const source = corpus(script)
    const d = memberPaneDefinition({ source, id: DEF_ID })
    expect(d.ok).toBe(false)
    expect(candleRows(d)).toEqual([])
    expect(d.reason).toBe(`${SENTENCE('plotcandle', line)} It plots nothing else this pane can draw.`)
    render(<MemberPane sym="SPY" tf="D" source={source} defId={DEF_ID} />)
    expect(screen.getByTestId('pine-member-pane-refusal').textContent).toBe(d.reason)
    expect(paneProps).toHaveLength(0)
  })

  it('objects-only ON: attaches, no candle row, no visible line, and the sentence is a rendered disclosure', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const source = corpus(script)
    const d = memberPaneDefinition({ source, id: DEF_ID })
    expect(d.ok, d.reason || '').toBe(true)
    expect(candleRows(d)).toEqual([])
    expect(d.rows.filter((r) => !r.hidden && r.style === 'line')).toEqual([])
    expect(d.notes.map((n) => n.note)).toContain(SENTENCE('plotcandle', line))
    expect(d.definition.meta.disclosures.map((n) => n.note)).toContain(SENTENCE('plotcandle', line))
    render(<MemberPane sym="SPY" tf="D" source={source} defId={DEF_ID} />)
    expect(noteItems()).toContain(SENTENCE('plotcandle', line))
    const installed = engineRegistry.getDefinition(DEF_ID)
    expect(installed, 'the pane installed nothing').toBeTruthy()
    expect((installed.plots || []).filter((p) => !p.hidden)).toEqual([])
  })

  it('CONTROL: an ordinary `plot` in the same script still draws as a visible line, candle still said', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
    const source = `${corpus(script).replace(/\s*$/, '')}\nplot(ta.sma(close, 20), "Control")\n`
    const d = memberPaneDefinition({ source, id: DEF_ID })
    expect(d.ok, d.reason || '').toBe(true)
    expect(candleRows(d)).toEqual([])
    const visible = d.rows.filter((r) => !r.hidden)
    expect(visible.map((r) => [r.label, r.style])).toEqual([['Control', 'line']])
    expect(d.notes.map((n) => n.note)).toContain(SENTENCE('plotcandle', line))
    render(<MemberPane sym="SPY" tf="D" source={source} defId={DEF_ID} />)
    expect(noteItems()).toContain(SENTENCE('plotcandle', line))
    const installed = engineRegistry.getDefinition(DEF_ID)
    expect(installed.plots.filter((p) => !p.hidden).map((p) => p.label)).toEqual(['Control'])
  })
})

describe('synthetic shapes the corpus does not carry', () => {
  const src = (...body) => ['//@version=6', 'indicator("t", overlay = true)', ...body].join('\n')

  it('a derived candle with `display = cond ? display.all : display.none` is not drawn and its knob is not offered', () => {
    const d = memberPaneDefinition({
      source: src(
        'bool useBarColor = input.bool(false, "Color Bars")',
        'plot(ta.sma(close, 5), "M")',
        'plotcandle(open, high, low, ta.sma(close, 3), "C", color.red, display = useBarColor ? display.all : display.none)',
      ),
      id: DEF_ID,
    })
    expect(d.ok, d.reason || '').toBe(true)
    expect(d.rows.filter((r) => !r.conditionFor).map((r) => r.label)).toEqual(['M'])
    expect(d.notes.map((n) => n.note)).toContain(SENTENCE('plotcandle', 5))
    expect((d.definition.inputs || []).map((i) => i.key)).not.toContain('useBarColor')
  })

  it('`plotbar` is said in its own words', () => {
    const d = memberPaneDefinition({
      source: src('plot(ta.sma(close, 5), "M")',
        'plotbar(ta.sma(open, 2), ta.sma(high, 2), ta.sma(low, 2), ta.sma(close, 2), "B")'),
      id: DEF_ID,
    })
    expect(d.ok, d.reason || '').toBe(true)
    expect(candleRows(d)).toEqual([])
    expect(d.rows.map((r) => r.label)).toEqual(['M'])
    expect(d.notes.map((n) => n.note)).toContain(SENTENCE('plotbar', 4))
  })

  it('UNCHANGED: a bare price passthrough candle is carried hidden, draws nothing, and adds no sentence', () => {
    const d = memberPaneDefinition({
      source: src('plot(ta.sma(close, 5), "M")', 'plotcandle(open, high, low, close)'),
      id: DEF_ID,
    })
    expect(d.ok, d.reason || '').toBe(true)
    // the pre-fix shape, measured before the change: M visible + four hidden passthrough rows
    expect(d.rows.map((r) => [r.label, r.hidden])).toEqual([
      ['M', false], ['open', true], ['high', true], ['low', true], ['close', true],
    ])
    expect(d.notes.map((n) => n.note).join(' ')).not.toMatch(/draws candles/)
  })
})
