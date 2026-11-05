// CHARTS OUTCOME — the Options Flow widget's own filter chips (C3-166; F-16 widened by the owner 2026-11-10), as rows of the one
// widget-control layer (widget.setOption → filters.minPrem / cp / type / dir, exactly as its chips write them). Over the REAL
// OptionsFlowWidget, mounted in its WidgetDoorContext slot beside the real Agent panel: the end state is read from the widget's
// stored opts AND from the prints it draws; the chart and every other widget stay byte-identical; Undo is exact. A request that
// sets two chips of one single-select group is refused with the UI's choices; with two Options Flow widgets and nothing naming
// one, the Agent ASKS and lists both. Held-out phrasings: agentFlowFiltersHeldOut.test.js (committed before the change).
//
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness). Prints are invented fixture rows; no data is fetched, no trade is placed (the widget
// has no order path). Evidence: LOCAL native Windows Node, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow, refusals } from './outcomeHarness'
import { WidgetDoorContext } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { AuthContext } from '../../../context/AuthContext'
import { FLOW_SET_HELD_OUT, FLOW_RESET_HELD_OUT, FLOW_REFUSE_HELD_OUT, FLOW_TWO_WIDGETS_HELD_OUT } from '../../agentFlowFiltersHeldOut.test.js'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }), parsePref: (raw, fallback) => fallback }))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => null }))
// fixture prints, one per chip combination worth telling apart (invented tickers and numbers)
const PRINT = (id, ticker, cp, type, dir, prem) => ({ id, ticker, cp, strike: 10, exp: '2026-12-18', dte: 30, alertPremium: prem, spot: 10, _type: type, _direction: dir, grade: '', timestamp: 1 })
const PRINTS = [PRINT(1, 'AAA', 'C', 'SWEEP', 'BULL', 300000), PRINT(2, 'BBB', 'P', 'SWEEP', 'BEAR', 1200000), PRINT(3, 'CCC', 'C', 'BLOCK', 'BEAR', 600000),
  PRINT(4, 'DDD', 'P', 'BLOCK', 'BEAR', 260000), PRINT(5, 'EEE', 'C', 'ML', 'BULL', 100000)]
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (key) => ({ data: key ? { kind: 'alerts', alerts: PRINTS } : null, error: null, isLoading: false }) }))

const OptionsFlowWidget = (await import('../../../pages/charts/widgets/OptionsFlowWidget')).default
await outcomeSuite()

function Live({ board }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10); return () => clearInterval(t) }, [])
  const onOpts = (id) => (opts) => { board.state.widgets = board.state.widgets.map(x => (x.id === id ? { ...x, opts } : x)) }
  const ws = { groupSyms: { N: 'AAA' }, setGroupSym: () => {}, groupTfs: {}, activeWatchlistRef: { current: null } }
  return (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 1, role: 'user' } }}>
        <WorkspaceContext.Provider value={ws}>
          {board.state.widgets.filter(w => w.type === 'optionsflow').map(w => (
            <div key={w.id} data-testid={`w-${w.id}`}><WidgetDoorContext.Provider value={w.id}><OptionsFlowWidget color={w.color} opts={w.opts} onOptsChange={onOpts(w.id)} /></WidgetDoorContext.Provider></div>
          ))}
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}
const flow = (id, opts = {}, x = 12) => ({ id, type: 'optionsflow', x, y: 0, w: 6, h: 20, color: 'N', opts })
function board(widgets) {
  const m = open([chart('c1', 0, 0, 12, 20), ...widgets], { 'N:c1': 'AAA' })
  render(<Live board={m.board} />)
  return m
}
const UI = { minPrem: 0, cp: 'all', type: 'all', dir: 'all' }
const filtersOf = (m, id = 'of') => ({ ...UI, ...(m.board.state.widgets.find(w => w.id === id).opts?.filters || {}) })
const optsOf = (m, id = 'of') => JSON.stringify(m.board.state.widgets.find(w => w.id === id).opts)
const drawn = (id = 'of') => [...document.querySelector(`[data-testid="w-${id}"]`).querySelectorAll('[class*="rowSym"]')].map(e => e.textContent)
// what the widget's own client-side filter keeps (OptionsFlowWidget `view`), from the fixture prints
const kept = (f) => PRINTS.filter(r => (!f.minPrem || r.alertPremium >= f.minPrem) && (f.cp === 'all' || r.cp === f.cp)
  && (f.type === 'all' || r._type === f.type) && (f.dir === 'all' || r._direction === f.dir)).map(r => r.ticker).sort()
const idOf = (c, pos) => {
  const ws = (c.board?.[0]?.widgets || []).filter(w => w.type === 'optionsflow')
  return must(pos ? ws.find(w => String(w.position || '').includes(pos)) : ws[0], `an options flow widget${pos ? ` (${pos})` : ''}`).id
}
function plan(ops, { pos = null, seen = {} } = {}) {
  return (c, body) => {
    seen.first ??= (body.capabilities || []).some(x => x.name === 'widget.setOption')
    const widget = idOf(c, pos)
    return ops.map(o => ({ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget, key: o.key, value: o.value } }))
  }
}
const chartOf = (m) => JSON.stringify(m.board.state.widgets.find(w => w.id === 'c1'))
const said = (out) => `${out} ${refusals().map(r => r.textContent).join(' ')}`

afterEach(() => { afterEachOutcome(); cleanup() })

describe('C3-166: the Options Flow widget\'s own chips, as its UI sets them', () => {
  it.each(FLOW_SET_HELD_OUT.map(c => [c.text, c]))('held-out "%s": the filters the chips hold, the prints the widget draws, the chart untouched; Undo exact', async (text, c) => {
    const m = board([flow('of')])
    await waitFor(() => expect(drawn().length).toBe(PRINTS.length))
    const was = optsOf(m), chartWas = chartOf(m)
    const seen = {}
    const out = await m.say(text, plan(c.ops, { seen }))
    await waitFor(() => expect(filtersOf(m), out).toEqual(c.want))
    await waitFor(() => expect(drawn().sort()).toEqual(kept(c.want)))
    expect(chartOf(m)).toBe(chartWas)
    expect(seen.first, 'the first request offered widget.setOption: no refusal before the model, no reroute').toBe(true)
    await m.say('undo')
    await waitFor(() => expect(optsOf(m)).toBe(was))
  }, 60000)
  it.each(FLOW_RESET_HELD_OUT.map(c => [c.text, c]))('held-out "%s": each group back on its own All / Any chip; Undo puts the chips back exactly', async (text, c) => {
    const m = board([flow('of', { filters: { ...UI, ...c.from } })])
    await waitFor(() => expect(drawn().sort()).toEqual(kept({ ...UI, ...c.from })))
    const was = optsOf(m)
    await m.say(text, plan(c.ops))
    await waitFor(() => expect(filtersOf(m)).toEqual(c.want))
    await m.say('undo')
    await waitFor(() => expect(optsOf(m)).toBe(was))
  }, 60000)
})

describe('NEGATIVE: what the chips do not allow is refused in the UI\'s own words; nothing is written', () => {
  it.each(FLOW_REFUSE_HELD_OUT.map(c => [c.text, c]))('held-out "%s" (%s)', async (text, c) => {
    const m = board([flow('of')])
    await waitFor(() => expect(drawn().length).toBe(PRINTS.length))
    const was = optsOf(m)
    const out = await m.say(text, plan(c.ops))
    expect(said(out)).toMatch(c.refuse)
    expect(optsOf(m)).toBe(was)
    expect(proposalsNow()).toHaveLength(0)
  }, 60000)
})

describe('two Options Flow widgets: the one meant, or ASK', () => {
  it.each(FLOW_TWO_WIDGETS_HELD_OUT.map(c => [c.text, c]))('held-out "%s"', async (text, c) => {
    const m = board([flow('of', {}, 12), flow('of2', {}, 18)])
    await waitFor(() => expect(drawn('of2').length).toBe(PRINTS.length))
    const a = optsOf(m, 'of'), b = optsOf(m, 'of2')
    const ops = /puts/.test(text) ? [{ key: 'callPut', value: 'Puts' }] : /bear/.test(text) ? [{ key: 'direction', value: 'Bear' }] : [{ key: 'printType', value: 'Sweep' }]
    // the planner picks the first widget whenever nothing names one: the guard, not the planner, has to catch it
    const out = await m.say(text, plan(ops, { pos: c.which }))
    if (c.which == null) {
      expect(out).toMatch(/Which Options Flow/i)
      expect(optsOf(m, 'of')).toBe(a)
      expect(optsOf(m, 'of2')).toBe(b)
      const choices = [...document.querySelectorAll('[data-testid="agent-panel"] button')].filter(x => /Options Flow/.test(x.textContent))
      expect(choices.map(x => x.textContent)).toHaveLength(2)
      fireEvent.click(choices.find(x => /right/.test(x.textContent)))
      await waitFor(() => expect(optsOf(m, 'of2')).not.toBe(b))
      expect(optsOf(m, 'of')).toBe(a)
      return
    }
    const target = c.which === 'left' ? 'of' : 'of2', other = target === 'of' ? 'of2' : 'of'
    await waitFor(() => expect(optsOf(m, target)).not.toBe(target === 'of' ? a : b))
    expect(optsOf(m, other)).toBe(other === 'of' ? a : b)
    void screen
  }, 60000)
})
