// ROOT CAUSE · BUG C (owner live test, production ebde0bd402): one SPY chart. "Open a second chart for NVDA beside SPY. Change SPY
// to the 1-hour timeframe, but leave NVDA's chart alone." → the Agent asked "one new NVDA chart, or the earlier four-chart layout?"
// → the owner picked "Add one new NVDA chart beside SPY (2 charts total)" → "I couldn't fill in the details of one of the steps,
// so nothing was changed." — SPY only. Through the REAL panel (panelHarness); no model unless a probe scripts one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { manifestFor, normalizeArgs } from './capabilities'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const ASK = 'Open a second chart for NVDA beside SPY. Change SPY to the 1-hour timeframe, but leave NVDA\'s chart alone.'
const charts = (m) => m.board.state.widgets.filter(w => w.type === 'chart').map(w => [m.h.charts.read(w.id).symbol, m.h.charts.read(w.id).tf])
const buttons = () => screen.queryAllByRole('button').map(b => b.textContent).filter(Boolean)

// the model's question as it was shown live (two choices), and the plan a model writes for the picked choice
const QUESTION = 'Do you want one new NVDA chart beside SPY, or the earlier four-chart layout?'
const CHOICES = [{ label: 'Add one new NVDA chart beside SPY (2 charts total)', ref: null }, { label: 'Use the earlier four-chart layout', ref: null }]
const clarify = () => ({ disposition: 'clarify', reply: QUESTION, question: { text: QUESTION, choices: CHOICES }, ops: [], unsupported_category: null })
const actionsOf = (body) => {
  const m = body?.manifest || body?.capabilities || body?.actions || []
  return (Array.isArray(m) ? m : Object.values(m)).map(a => (typeof a === 'string' ? a : a?.name)).filter(Boolean)
}
const turnBodies = () => p.st.calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])

describe('BUG C · the answer turn after the pick must still offer every action the pending request needs', () => {
  it('the turn after the pick carries widget.addCharts AND chart.setTimeframe (the original request\'s two steps)', async () => {
    const m = p.mount(...ONE('SPY'))
    p.st.envelopes.push(clarify())
    await m.say(ASK)
    const first = actionsOf(turnBodies()[0])
    const pick = buttons().find(t => t === CHOICES[0].label)
    expect(pick, `the question's choices must be buttons: ${JSON.stringify(buttons())}`).toBeTruthy()
    await m.click(pick)
    const second = actionsOf(turnBodies()[1])
    if (process.env.DUMP) console.log('KEYS>>', Object.keys(turnBodies()[1] || {}).join(','), '| FIRST', first.length, first.filter(a => /chart\.setTimeframe|addCharts|chartGrid/.test(a)), '| SECOND', second.length, second.filter(a => /chart\.setTimeframe|addCharts|chartGrid/.test(a)), '| MSG', turnBodies()[1]?.message)
    if (process.env.CAPS_OUT) {
      const caps = (turnBodies()[1].capabilities || []).filter(c => ['chart.setTimeframe', 'widget.addCharts', 'chartGrid.set', 'widget.add', 'chart.setSymbol'].includes(c.name))
      ;(await import('node:fs')).writeFileSync(process.env.CAPS_OUT, JSON.stringify({ caps, routing: turnBodies()[1].routing, pending: turnBodies()[1].pending }, null, 1))
    }
    expect(first).toContain('chart.setTimeframe')
    expect(second, 'the answer turn lost the pending request\'s timeframe step').toContain('chart.setTimeframe')
    expect(second).toContain('widget.addCharts')
  }, 40000)
})

// the plan a model writes for the pick, with "the 1-hour timeframe" in the model's own words (server-side, turn.py
// expand_compact_ops refuses the WHOLE envelope as "args_schema" for such a value — tests/test_uct_agent_rootcause_c.py)
const TF_WORDS = ['60', '1h', '1H', 'hourly', '60m', '1hr']
const resumed = (tf) => (b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [
  { action: 'widget.addCharts', target: (Object.values(b.context || {}).flat().find(e => /workspace/i.test(String(e?.label || e?.ref)))?.ref) || 'workspace', args: { symbols: ['NVDA'], timeframe: null, chart_type: null, exact: null } },
  { action: 'chart.setTimeframe', target: b.context.charts.find(c => c.symbol === 'SPY').ref, args: { timeframe: tf } },
] })
// the same two steps as a grid: SPY kept, NVDA added (re-tiles to make room) + SPY's timeframe
const resumedGrid = (tf) => (b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [
  { action: 'chartGrid.set', target: 'board', args: { symbols: ['SPY', 'NVDA'], timeframe: null, layout: 'columns', new_charts: null, watchlist: null, replace: null } },
  { action: 'chart.setTimeframe', target: b.context.charts.find(c => c.symbol === 'SPY').ref, args: { timeframe: tf } },
] })
describe('BUG C · the resumed plan as a grid + timeframe', () => {
  it.each(['60', '1h'])('timeframe %j → SPY hourly beside a new NVDA chart', async (tf) => {
    const m = p.mount(...ONE('SPY'))
    p.st.envelopes.push(clarify())
    await m.say(ASK)
    p.st.envelopes.push(resumedGrid(tf))
    await m.click(CHOICES[0].label)
    expect(charts(m), p.transcript()).toEqual([['SPY', '60'], ['NVDA', 'D']])
  }, 40000)
})

describe('BUG C · the resumed plan after the pick: the model\'s words for "1-hour" bind to the timeframe', () => {
  // ⏸ BUG C (c), DEFERRED until #1275 merges (planChartGrid): widget.addCharts beside a chart that fills the board is refused
  // (no empty space; an add + change of an existing chart in one request) — the add-beside → grid re-tile fix comes then
  it.skip.each(TF_WORDS)('timeframe %j → SPY hourly beside a new NVDA chart', async (tf) => {
    const m = p.mount(...ONE('SPY'))
    p.st.envelopes.push(clarify())
    await m.say(ASK)
    p.st.envelopes.push(resumed(tf))
    await m.click(CHOICES[0].label)
    expect(charts(m), p.transcript()).toEqual([['SPY', '60'], ['NVDA', 'D']])
  }, 40000)
})


// chart.setTimeframe reads the model's spelling of a timeframe exactly as widget.addCharts does (by GRAMMAR — capabilities/
// timeframeWords.js; the server mirrors it in turn.py _coerce_schema). Was: no word for it → the whole turn refused.
describe('BUG C · chart.setTimeframe reads timeframe spellings like widget.addCharts', () => {
  it.each(['1h', 'hourly', '60m', '1hr', 'daily', 'weekly', '15 minutes', '1-hour'])('%j', (w) => {
    const tf = normalizeArgs('chart.setTimeframe', { timeframe: w }).args.timeframe
    const add = normalizeArgs('widget.addCharts', { symbols: ['NVDA'], timeframe: w, chart_type: null, exact: null }).args.timeframe
    expect(manifestFor({ surface: 'charts' }).find(c => c.name === 'chart.setTimeframe').args.properties.timeframe.enum).toContain(tf)
    expect(tf).toBe(add)
  })
})
