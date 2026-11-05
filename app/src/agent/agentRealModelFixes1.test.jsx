// The defects of the first REAL-MODEL production verification (2026-11-05), each as a slice through the REAL panel with a
// scripted model: what these prove is that a plan runs and is receipted truthfully. Whether a real model picks that plan is
// the next real-model run's question, not this file's.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO } from './testing/panelHarness'
import { buildContext } from './capabilities'
import { noOptionRefusal, withOptionsOrPlain } from './noOptionQuestion'
import { preflightRefusals } from './nl1/interpreter'
import { addChartTab } from '../pages/charts/chartTabs'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// ── defect 1: hide-all is one VIEW flag per chart, as getDateMeta reports it ──
function withHideAll(h, { land = true } = {}) {
  const hidden = new Map()
  const calls = []
  const base = h.charts
  const { read, list } = base
  const see = (s) => s && { ...s, view: { indicatorsHidden: hidden.get(s.ref) === true } }
  h.charts = {
    ...base,
    read: (ref) => see(read(ref)),
    list: () => list().map(see),
    viewDo: (ref, op, arg) => {
      calls.push([ref, op, arg])
      if (land && op === 'setIndicatorsHidden') hidden.set(ref, arg)
      return true
    },
  }
  return { hidden, calls }
}
const planIs = (action, target, args) => p.env('apply', [{ action, target, args }])
const lists = () => [{ id: 'm1', name: 'Momentum', symbols: ['NVDA'] }]
/** The context entry of this kind the panel really sent, as the model reads it. */
const refOfKind = (h, kind) => Object.entries(buildContext(h, { surface: 'charts', message: '' }).refMap).find(([, v]) => v.kind === kind)?.[0]
async function withRsi(say, chart = 'c') {
  p.select(chart)
  await say('add rsi')
  p.select(null)
}

describe('defect 1: a chart under hide-all is not "already shown"', () => {
  it('"bring them back" planned as a show of one indicator brings the chart back, and says everything came back', async () => {
    const { say, h } = p.mount(...ONE('AAPL'))
    const v = withHideAll(h)
    await withRsi(say)
    v.hidden.set('c', true)
    p.st.envelopes.push(planIs('indicator.show', 'ixe:c', { instance: 'rsi' }))
    const text = await say('ok bring them back')
    expect(v.hidden.get('c')).toBe(false)
    expect(text).toMatch(/Brought back every indicator and Volume/)
    expect(text).not.toMatch(/already shown|Nothing to change/)
  }, 40000)
  it('its Undo puts the hide-all back', async () => {
    const { say, h } = p.mount(...ONE('AAPL'))
    const v = withHideAll(h)
    await withRsi(say)
    v.hidden.set('c', true)
    p.st.envelopes.push(planIs('indicator.show', 'ixe:c', { instance: 'rsi' }))
    await say('unhide everything on the AAPL chart')
    expect(await say('undo')).toMatch(/Hid every indicator and Volume/)
    expect(v.hidden.get('c')).toBe(true)
  }, 40000)
  it('an indicator hidden by its own eye AND by hide-all: both are cleared, and Undo restores both', async () => {
    const { say, h, board } = p.mount(...ONE('AAPL'))
    const v = withHideAll(h)
    await withRsi(say)
    p.st.envelopes.push(planIs('indicator.hide', 'ixe:c', { instance: 'rsi' }))
    await say('hide the rsi')
    v.hidden.set('c', true)
    p.st.envelopes.push(planIs('indicator.show', 'ixe:c', { instance: 'rsi' }))
    const text = await say('show the rsi')
    expect(v.hidden.get('c')).toBe(false)
    expect(text).toMatch(/Showed RSI/)
    expect(text).toMatch(/Brought back every indicator/)
    expect(p.instancesOn(board, 'c').find(r => r.defId === 'rsi').hidden).toBeFalsy()
    await say('undo')
    expect(v.hidden.get('c')).toBe(true)
    expect(p.instancesOn(board, 'c').find(r => r.defId === 'rsi').hidden).toBe(true)
  }, 40000)
  it('Volume and the moving averages read the same flag', async () => {
    const { say, h } = p.mount(...ONE('AAPL'))
    const v = withHideAll(h)
    v.hidden.set('c', true)
    p.st.envelopes.push(planIs('volume.setState', 'c', { state: 'visible' }))
    expect(await say('show volume please')).toMatch(/Brought back every indicator and Volume/)
    expect(v.hidden.get('c')).toBe(false)
    expect(await say('undo')).not.toMatch(/nothing/i)
    expect(v.hidden.get('c')).toBe(true)
    p.st.envelopes.push(planIs('chartSetup.setMovingAverages', 'c', { visible: true }))
    expect(await say('show my moving averages')).toMatch(/Brought back every indicator and Volume/)
    expect(v.hidden.get('c')).toBe(false)
  }, 40000)
  it('hide-all itself still reads the same flag both ways', async () => {
    const { say, h } = p.mount(...ONE('AAPL'))
    const v = withHideAll(h)
    v.hidden.set('c', true)
    p.st.envelopes.push(planIs('chartSetup.setIndicatorsHidden', 'c', { hidden: true }))
    expect(await say('hide all my indicators')).toMatch(/already hidden/)
    p.st.envelopes.push(planIs('chartSetup.setIndicatorsHidden', 'c', { hidden: false }))
    expect(await say('show all my indicators')).toMatch(/Brought back every indicator/)
    expect(v.hidden.get('c')).toBe(false)
  }, 40000)
  it('a list of what is hidden does not call a hide-all chart clean', async () => {
    const { say, h } = p.mount(...ONE('AAPL'))
    const v = withHideAll(h)
    await withRsi(say)
    v.hidden.set('c', true)
    const text = await say('what indicators are hidden')
    expect(text).toMatch(/RSI/)
    expect(text).not.toMatch(/Nothing is hidden/)
  }, 40000)
  it('NEGATIVE: a chart that is not under hide-all keeps the truthful "already shown", and no control is touched', async () => {
    const { say, h } = p.mount(...ONE('AAPL'))
    const v = withHideAll(h)
    await withRsi(say)
    p.st.envelopes.push(planIs('indicator.show', 'ixe:c', { instance: 'rsi' }))
    expect(await say('show the rsi')).toMatch(/already shown/)
    expect(v.calls).toEqual([])
  }, 40000)
  it('NEGATIVE: hide-all on the left chart says nothing about the right one', async () => {
    const { say, h } = p.mount(...TWO('AAPL', 'NVDA'))
    const v = withHideAll(h)
    await withRsi(say, 'cl')
    await withRsi(say, 'cr')
    v.hidden.set('cl', true)
    p.select('cr')
    p.st.envelopes.push(planIs('indicator.show', 'ixe:cr', { instance: 'rsi' }))
    expect(await say('show the rsi on this one')).toMatch(/already shown/)
    expect(v.hidden.get('cl')).toBe(true)
    expect(v.calls).toEqual([])
  }, 40000)
  it('NEGATIVE: hiding one indicator under hide-all does not bring the chart back', async () => {
    const { say, h, board } = p.mount(...ONE('AAPL'))
    const v = withHideAll(h)
    await withRsi(say)
    v.hidden.set('c', true)
    p.st.envelopes.push(planIs('indicator.hide', 'ixe:c', { instance: 'rsi' }))
    await say('hide the rsi')
    expect(v.hidden.get('c')).toBe(true)
    expect(p.instancesOn(board, 'c').find(r => r.defId === 'rsi').hidden).toBe(true)
  }, 40000)
  it('a chart that does not take the change never earns a receipt', async () => {
    const { say, h } = p.mount(...ONE('AAPL'))
    const v = withHideAll(h, { land: false })
    await withRsi(say)
    v.hidden.set('c', true)
    p.st.envelopes.push(planIs('indicator.show', 'ixe:c', { instance: 'rsi' }))
    const text = await say('bring them back')
    expect(text).not.toMatch(/Brought back/)
    expect(text).toMatch(/did not confirm/)
  }, 40000)
})

describe('defect 2: an action with one possible target has nothing to choose', () => {
  const half = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: {} }], { 'N:c': 'AAPL' }]
  const types = (board) => board.state.widgets.map(w => w.type)
  it.each(['watchlistLibrary', 'watchlist', 'board', 'chart'])('widget.add aimed at the %s entry adds the widget', async (kind) => {
    const { say, h, board } = p.mount(...half(), { watchlists: lists() })
    const ref = refOfKind(h, kind)
    expect(ref, kind).toBeTruthy()
    p.st.envelopes.push(planIs('widget.add', ref, { type: 'watchlist', as: null }))
    const text = await say('add a watchlist widget to the board')
    expect(text).not.toMatch(/not on the workspace/)
    expect(types(board)).toEqual(['chart', 'watchlist'])
  }, 40000)
  it('the news add, aimed right, is unchanged', async () => {
    const { say, h, board } = p.mount(...half())
    p.st.envelopes.push(planIs('widget.add', refOfKind(h, 'workspace'), { type: 'news', as: null }))
    await say('add the news widget')
    expect(types(board)).toEqual(['chart', 'news'])
  }, 40000)
  it('a step on the new widget that the request cannot do leaves the add standing, and says so', async () => {
    const { say, h, board } = p.mount(...half(), { watchlists: lists() })
    p.st.envelopes.push(p.env('apply', [
      { action: 'widget.add', target: refOfKind(h, 'workspace'), args: { type: 'watchlist', as: 'new1' } },
      { action: 'widget.showList', target: 'new1', args: { widget: 'new1', list: 'm1' } },
    ]))
    const text = await say('open a watchlist next to the charts')
    expect(types(board)).toEqual(['chart', 'watchlist'])
    expect(text).toMatch(/can’t set it up in the request that adds it/)
    expect(text).not.toMatch(/not on the workspace/)
  }, 40000)
  it('NEGATIVE: an action on a chart is not re-aimed: a chart is one of several', async () => {
    const { say, h, board } = p.mount(...TWO('AAPL', 'NVDA'))
    p.st.envelopes.push(planIs('chart.setTimeframe', refOfKind(h, 'workspace'), { timeframe: 'W' }))
    expect(await say('make it weekly')).toMatch(/not on the workspace|Which/)
    expect(board.state.widgets.every(w => !w.opts?.tf || w.opts.tf === 'D')).toBe(true)
  }, 40000)
  it('NEGATIVE: a chart that is configurable keeps its follow-up step', async () => {
    const { say, h, board } = p.mount(...half())
    p.st.envelopes.push(p.env('apply', [
      { action: 'widget.add', target: refOfKind(h, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'TSLA' } },
    ]))
    expect(await say('add a chart of tsla')).not.toMatch(/can’t set it up/)
    expect(board.state.widgets.length).toBe(2)
  }, 40000)
})

describe('defect 3: a pending card is resolved by itself', () => {
  async function tfThenCard(say) {
    await withRsi(say)
    await say('set it to weekly')
    p.st.envelopes.push(planIs('indicator.remove', 'ixe:c', { instance: 'rsi' }))
    await say('take the rsi off please')
    expect(p.proposals().length).toBe(1)
  }
  const tfOf = (board) => board.state.widgets.find(w => w.id === 'c').opts.tf
  it.each(['actually undo that', 'undo', 'undo that', 'revert that', 'undo all of that', 'wait, undo that'])('"%s" withdraws the card and leaves the earlier change', async (words) => {
    const { say, board } = p.mount(...ONE('AAPL'))
    await tfThenCard(say)
    const text = await say(words)
    expect(text).toMatch(/Withdrew that proposal/)
    expect(text).not.toMatch(/Undid/)
    expect(tfOf(board)).toBe('W')
    await say('do it')
    expect(tfOf(board)).toBe('W')
    expect(p.instancesOn(board, 'c').some(r => r.defId === 'rsi')).toBe(true)
  }, 40000)
  it('the model planning agent.undo over a card does the same', async () => {
    const { say, board } = p.mount(...ONE('AAPL'))
    await tfThenCard(say)
    p.st.envelopes.push(planIs('agent.undo', 'self', { scope: 'last', about: null }))
    expect(await say('hmm scratch that one')).toMatch(/Withdrew that proposal/)
    expect(tfOf(board)).toBe('W')
  }, 40000)
  it('with the card gone, the next Undo takes back the older change', async () => {
    const { say, board } = p.mount(...ONE('AAPL'))
    await tfThenCard(say)
    await say('undo')
    await say('undo')
    expect(tfOf(board) ?? 'D').toBe('D')
  }, 40000)
  it('NEGATIVE: with no card waiting, an Undo undoes', async () => {
    const { say, board } = p.mount(...ONE('AAPL'))
    await say('set it to weekly')
    expect(tfOf(board)).toBe('W')
    expect(await say('undo')).toMatch(/Undid/)
    expect(tfOf(board) ?? 'D').toBe('D')
  }, 40000)
  it('NEGATIVE: an Undo that names another change still undoes it, and the card goes with the state it was made for', async () => {
    const { say, board } = p.mount(...ONE('AAPL'))
    await tfThenCard(say)
    const text = await say('undo the timeframe change')
    expect(text).toMatch(/Undid/)
    expect(text).toMatch(/I withdrew the proposal above/)
    expect(tfOf(board) ?? 'D').toBe('D')
  }, 40000)
})

describe('defect 4: a question reaches the panel only with its options', () => {
  const clarify = (text, choices = [], extra = {}) => ({ disposition: 'clarify', reply: '', question: { text, choices }, ops: [], unsupported_category: null, ...extra })
  const questions = () => screen.queryAllByTestId('agent-question')
  it('the server\'s empty "which one?" on the board says nothing changed and what to say instead', async () => {
    const { say } = p.mount(...TWO('AAPL', 'NVDA'))
    p.st.envelopes.push(clarify('Which one do you mean?', [], { unplaced_actions: ['chart.setTimeframe'] }))
    expect(await say('sort this one out for me')).toMatch(/couldn’t tell which one you meant/)
    expect(questions().length).toBe(0)
  }, 40000)
  it('a model question that has options is still a question with its buttons', async () => {
    const { say } = p.mount(...TWO('AAPL', 'NVDA'))
    p.st.envelopes.push(clarify('Which chart?', ['Left', 'Right']))
    await say('sort this one out for me')
    expect(questions().length).toBe(1)
    expect(screen.getByRole('button', { name: 'Left' })).toBeTruthy()
  }, 40000)
  it('a model question with no options is a plain line, and the next message still answers it', async () => {
    const { say } = p.mount(...ONE('AAPL'))
    p.st.envelopes.push(clarify('What level should the alert use?'))
    expect(await say('set an alert for me')).toMatch(/What level should the alert use\? Tell me in your next message; nothing has changed yet\./)
    expect(questions().length).toBe(0)
    await say('150')
    expect(p.lastTurnBody().message).toMatch(/150/)
  }, 40000)
  it('a local question that lost its options is a plain line too', () => {
    expect(withOptionsOrPlain({ role: 'question', text: 'Which one?', choices: [] }).role).toBe('agent')
    expect(withOptionsOrPlain({ role: 'question', text: 'Which one?', choices: [{ label: 'A' }] }).role).toBe('question')
    expect(withOptionsOrPlain({ role: 'question', text: 'Which?', authoring: true }).role).toBe('question')
  })
  describe('on the grid, a board change is refused by name', () => {
    const grid = { multiChart: true, charts: { grid: () => ({ maximized: () => null, groupsMode: () => false }) } }
    it.each([['widget.add'], ['widget.remove'], ['widget.arrange']])('%s', (action) => {
      expect(noOptionRefusal({ question: { text: 'Which one do you mean?' }, unplaced_actions: [action] }, grid, [])).toMatch(/hidden while Multi Chart is on/)
    })
    it('NEGATIVE: a chart action there is no board refusal', () => {
      expect(noOptionRefusal({ question: { text: 'Which one do you mean?' }, unplaced_actions: ['chart.setTimeframe'] }, grid, [])).toMatch(/couldn’t tell which one/)
    })
    it('NEGATIVE: a real question is left alone', () => {
      expect(noOptionRefusal({ question: { text: 'Which timeframe?' } }, grid, [])).toBe(null)
      expect(noOptionRefusal({ question: { text: 'Which one do you mean?' } }, grid, [{ label: 'A' }])).toBe(null)
    })
    it('the board is named in the model\'s context, so a plan for it has a real target; the planner refuses it, and no repair is paid for', () => {
      const h = { ...p.mount(...ONE('AAPL')).h, multiChart: true, widgets: undefined, charts: { ...grid.charts, list: () => [] } }
      const { refMap } = buildContext(h, { surface: 'charts', message: '' })
      expect(Object.values(refMap).filter(v => v.kind === 'workspace' || v.kind === 'board').map(v => v.ref).sort()).toEqual(['board', 'workspace'])
      expect(preflightRefusals(h, [{ action: 'widget.add', target: 'workspace', args: { type: 'news', as: null } }])).toEqual([])
    })
  })
})

describe('defect 5: chart tabs', () => {
  const widgetOf = (board, id = 'c') => board.state.widgets.find(w => w.id === id)
  const planTabs = (...tfs) => p.env('apply', tfs.map(timeframe => ({ action: 'chart.addTab', target: 'board', args: { widget: 'c', timeframe, name: null } })))
  it('a tab on a NOT LINKED chart starts on the chart\'s own key, as the tab strip\'s "+" stores it', async () => {
    const { say, board } = p.mount(...ONE('AAPL'))
    p.st.envelopes.push(planTabs('W'))
    await say('open a new tab on this chart at weekly')
    const { opts } = widgetOf(board)
    expect(opts.chartTabs[0].color).toBe('N:c')
    expect(addChartTab({}, { color: 'N:c', tf: 'W' }).chartTabs[0].color).toBe(opts.chartTabs[0].color)
    expect(board.state.groupSyms[opts.chartTabs[0].color]).toBe('AAPL')
  }, 40000)
  it('two tabs in one request: the receipt names both, and only the last says it is showing', async () => {
    const { say } = p.mount(...ONE('AAPL'))
    p.st.envelopes.push(planTabs('60', 'W'))
    const text = await say('open a new tab on this chart at 1 hour, and a weekly one too')
    expect(text).toMatch(/Added a chart tab “1h”/)
    expect(text).toMatch(/Added a chart tab “1W” .* and switched to it/)
    expect(text).not.toMatch(/“1h”[^“]* and switched to it/)
  }, 40000)
  it('a second tab starts on the same key as the first', async () => {
    const { say, board } = p.mount(...ONE('AAPL'))
    p.st.envelopes.push(planTabs('60', 'W'))
    await say('open a new tab at 1 hour and a weekly tab too')
    expect(widgetOf(board).opts.chartTabs.map(t => t.color)).toEqual(['N:c', 'N:c'])
  }, 40000)
  it('two tabs alike are counted, and a named tab is named', async () => {
    const { say, board } = p.mount(...ONE('AAPL'))
    p.st.envelopes.push(p.env('apply', [
      { action: 'chart.addTab', target: 'board', args: { widget: 'c', timeframe: null, name: 'Swing' } },
      { action: 'chart.addTab', target: 'board', args: { widget: 'c', timeframe: 'W', name: null } },
    ]))
    const text = await say('add a tab called Swing and a weekly tab')
    expect(text).toMatch(/“Swing”/)
    expect(text).toMatch(/“1W”/)
    expect(widgetOf(board).opts.chartTabs.length).toBe(2)
  }, 40000)
  it('NEGATIVE: a chart in a link group keeps its group, so its tab follows the group', async () => {
    const { say, board } = p.mount([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'B', opts: {} }], { B: 'MSFT' })
    p.st.envelopes.push(planTabs('W'))
    await say('open a new tab at weekly')
    expect(widgetOf(board).opts.chartTabs[0].color).toBe('B')
  }, 40000)
})
