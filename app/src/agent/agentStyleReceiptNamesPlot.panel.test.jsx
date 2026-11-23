// THE RECEIPT NAMES THE PLOT through the REAL panel (AgentPanel + useAgent + the instant path / a scripted plan + runtime +
// Indicators' own writer + confirm). AUDIT 11-23: "color the MACD signal line orange" changed the Signal colour and said
// "Changed MACD's color". Now the receipt names the output by the definition's own label. Classes:
//   INSTANT     the member's words, no model: MACD's signal line, the histogram's up bars, Ichimoku's Kijun
//   EVERY COLOUR every colour setting of MACD / Stochastic / ADX / Ichimoku (generated from the definitions), by the instant
//               reader or — when the words are the model's — a scripted indicatorStyle.set: the stored colour is that
//               setting's, and the receipt names it
//   PLOT STYLE  a scripted plotStyle change on one MACD output: "Changed how MACD's <output> is drawn"
//   UNCHANGED   a one-colour indicator (EMA 20, RSI) keeps "Changed <name>'s color …"
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import * as R from '../components/chart/engine/nativeRegistry'
import { styleOptionsOf } from '../components/chart/builder/agentMutations'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const DEFS = ['macd', 'stoch', 'adx', 'ichimoku', 'rsi']
const csOf = (board) => { const w = board.state.widgets.find(x => x.id === 'c'); return mergeChartSettings(w?.opts?.settings ? JSON.stringify(w.opts.settings) : null) }
const inst = (board, defId) => (csOf(board).indicatorInstances || []).filter(i => !i.deleted).find(i => i.defId === defId)
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { cleanup() })
async function mount() {
  const [widgets, syms] = ONE('QQQ')
  const s = widgets[0].opts.settings
  widgets[0].opts.settings = { ...s, indicatorInstances: [...(s.indicatorInstances || []), ...DEFS.map(d => ({ instanceId: `inst:${d}:1`, defId: d, inputs: {}, hidden: false, ...(d === 'macd' ? { presentation: { signColors: true } } : {}) }))] }
  const m = p.mount(widgets, syms)
  await m.say('add a 20 ema')
  await waitFor(() => expect(DEFS.every(d => inst(m.board, d))).toBe(true))
  return m
}
const stylePlan = (args) => (body) => p.env('apply', [{ action: 'indicatorStyle.set', target: body.context.indicatorEdits.find(c => /QQQ/.test(c.chart)).ref, args }])

describe('instant: the member\'s words → the receipt names the output', () => {
  it('"color the MACD signal line orange" — the Signal colour, named; Undo puts it back', async () => {
    const m = await mount()
    const before = JSON.stringify(inst(m.board, 'macd'))
    const out = await m.say('color the MACD signal line orange')
    await waitFor(() => expect(inst(m.board, 'macd').inputs?.signalColor).toBeTruthy())
    expect(out).toMatch(/Changed MACD's Signal color on Chart \(QQQ\) to orange\./)
    expect(out).not.toMatch(/Changed MACD's color/)
    expect(inst(m.board, 'macd').inputs?.macdColor).toBeUndefined()
    await m.say('undo')
    await waitFor(() => expect(JSON.stringify(inst(m.board, 'macd'))).toBe(before))
  }, 60000)
  it('"make the macd up bars blue" — the histogram\'s up colour, named', async () => {
    const m = await mount()
    const out = await m.say('make the macd up bars blue')
    expect(out).toMatch(/Changed MACD's Histogram up color on Chart \(QQQ\) to blue\./)
  }, 60000)
  it('"change the ichimoku kijun color to purple" — Kijun, named', async () => {
    const m = await mount()
    const out = await m.say('change the ichimoku kijun color to purple')
    await waitFor(() => expect(inst(m.board, 'ichimoku').inputs?.kijunColor).toBeTruthy())
    expect(out).toMatch(/Changed Ichimoku's Kijun color on Chart \(QQQ\) to purple\./)
  }, 60000)
})

// every colour setting of the multi-colour indicators on the board, from the definitions
const LEGEND = { macd: 'MACD', stoch: 'Stoch', adx: 'ADX', ichimoku: 'Ichimoku' }
const COLOR_ROWS =DEFS.flatMap(d => { const c = (R.getDefinition(d).inputs || []).filter(i => i.type === 'color'); return c.length > 1 ? c.map(i => [d, i.key, i.label || i.key]) : [] })
describe("every colour setting of a multi-colour indicator (the instant reader, or the scripted plan when it is the model's), named in the receipt", () => {
  it.each(COLOR_ROWS)('%s · %s (%s)', async (d, key, label) => {
    const m = await mount()
    p.st.envelopes.push(stylePlan({ instance: `inst:${d}:1`, property: 'color', value: 'orange', output: label }))
    // (the words name the indicator as its legend does, so the state rail reads the request as about it)
    const out = await m.say(`change the ${LEGEND[d]} ${label} color to orange`)
    await waitFor(() => expect(inst(m.board, d).inputs?.[key], out).toBeTruthy())
    expect(out).toMatch(new RegExp(`Changed ${esc(LEGEND[d])}[^']*'s ${esc(label.replace(/\s+colou?r$/i, ''))} color on Chart \\(QQQ\\) to orange\\.`))
  }, 60000)
})

describe('plot style: one output of MACD, named', () => {
  it('a scripted plotStyle change on a MACD output names that output', async () => {
    const m = await mount()
    const opts = styleOptionsOf(csOf(m.board), R, inst(m.board, 'macd').instanceId)
    const row = opts.plotStyles.find(s => s.options.some(o => o !== s.current))
    const v = row.options.find(o => o !== row.current)
    const plot = R.getDefinition('macd').plots.find(x => x.key === row.plotKey)
    p.st.envelopes.push(stylePlan({ instance: 'inst:macd:1', property: 'plotStyle', value: v, output: row.plotKey }))
    const out = await m.say(`change the macd ${plot.label} plot style to ${v}`)
    expect(out).toMatch(new RegExp(`Changed how MACD's ${esc(plot.label)} is drawn on Chart \\(QQQ\\)`))
  }, 60000)
})

describe('unchanged: a one-colour indicator keeps its receipt', () => {
  it('"make the 20 ema green" / RSI orange', async () => {
    const m = await mount()
    expect(await m.say('make the 20 ema green')).toMatch(/Changed EMA 20's color on Chart \(QQQ\) to green\./)
    p.st.envelopes.push(stylePlan({ instance: 'inst:rsi:1', property: 'color', value: 'orange', output: null }))
    expect(await m.say('make the rsi orange please')).toMatch(/Changed (?:RSI \(14\)|Relative Strength Index|RSI)'s color on Chart \(QQQ\) to orange\./)
  }, 60000)
})
