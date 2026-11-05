// The chart's own view controls, as vertical slices through the REAL panel (scripted model): request → the chart named →
// the control's writer → read-back from the view → the state, and Undo where one exists. The stand-in chart below keeps a
// view the way getDateMeta reports it, so a control that does not land is a control the Agent cannot claim.
// StockChart's half (the read-back itself) is the real-browser check: PR body.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE } from './testing/panelHarness'
import { getCapability } from './capabilities'
import { CHART_DEFAULTS } from '../components/chart/chartDefaults'
import { RANGE_OPTS } from '../components/chart/rangeOptions'
import { anyMovingAverageOn, withMovingAverages } from '../components/chart/movingAverageVisibility'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const op = (action, args) => p.env('apply', [{ action, target: 'c', args }])

/** The chart's view on the fixture board: `viewDo` is the chart's own control, `land: false` a control that did nothing. */
function withView(h, start = {}) {
  const v = { activeRange: null, atDefaultView: false, indicatorsHidden: false, land: true, calls: [], ...start }
  const meta = () => ({ firstMs: 0, lastMs: 1, rightMs: 1, activeRange: v.activeRange, atDefaultView: v.atDefaultView, indicatorsHidden: v.indicatorsHidden })
  const base = h.charts
  const read = base.read, list = base.list
  h.charts = {
    ...base,
    read: (ref) => { const s = read(ref); return s && { ...s, view: meta() } },
    list: () => list().map(s => ({ ...s, view: meta() })),
    viewDo: (ref, o, arg) => {
      v.calls.push([ref, o, arg])
      if (!v.land) return true
      if (o === 'applyRange') { v.activeRange = arg; v.atDefaultView = false }
      if (o === 'resetView') { v.activeRange = null; v.atDefaultView = true }
      if (o === 'setIndicatorsHidden') v.indicatorsHidden = arg
      return true
    },
  }
  return v
}

describe('chartSetup.setRange: the range bar', () => {
  it('offers exactly the buttons the bar has: each one reaches the chart\'s applyRange with the bar\'s own value and is read back', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withView(h)
    for (const [label, val] of RANGE_OPTS) {
      p.st.envelopes.push(op('chartSetup.setRange', { range: label.toLowerCase() }))
      await say(`frame the chart on ${label.toLowerCase()}`)
      expect(v.activeRange, label).toBe(val)
    }
    expect(v.calls.map(c => c[2])).toEqual(RANGE_OPTS.map(([, val]) => val))
  }, 60000)

  it('a span with no button refuses and moves nothing', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withView(h)
    p.st.envelopes.push(op('chartSetup.setRange', { range: '2Y' }))
    expect(await say('show two years')).toMatch(/The range buttons are 3M, 6M, YTD, 1Y, 5Y, Origin/)
    expect(v.calls).toEqual([])
  }, 40000)

  it('a range the chart already shows is a no-op', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withView(h, { activeRange: 12 })
    p.st.envelopes.push(op('chartSetup.setRange', { range: '1Y' }))
    expect(await say('show one year')).toMatch(/Already showing 1Y/)
    expect(v.calls).toEqual([])
  }, 40000)

  it('⛔ a chart that did not land on the range gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withView(h, { land: false })
    const realNow = Date.now
    let t = realNow()
    vi.spyOn(Date, 'now').mockImplementation(() => { t += 2000; return t })       // the 10s wait passes at once
    p.st.envelopes.push(op('chartSetup.setRange', { range: '1Y' }))
    const out = await say('show one year')
    expect(out).not.toMatch(/Showing 1Y/)
    expect(v.activeRange).toBe(null)
  }, 40000)

  it('no view to read yet: refuses, the chart is not told to move', async () => {
    const { say } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push(op('chartSetup.setRange', { range: '1Y' }))
    expect(await say('show one year')).toMatch(/hasn.t finished loading/)
  }, 40000)

  it('says it has no Undo rather than offering one it cannot honour', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    withView(h)
    p.st.envelopes.push(op('chartSetup.setRange', { range: '1Y' }))
    expect(await say('show one year')).toMatch(/has no Undo/)
  }, 40000)
})

describe('chartSetup.resetView: right-click → Reset view', () => {
  it('reaches the chart\'s reset and is read back; settings are untouched', async () => {
    const { say, h, board } = p.mount(...ONE('NVDA'))
    const v = withView(h, { activeRange: 12 })
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(op('chartSetup.resetView', {}))
    await say('reset the view')
    expect(v.atDefaultView).toBe(true)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
  it('already at the default view: a no-op', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withView(h, { atDefaultView: true })
    p.st.envelopes.push(op('chartSetup.resetView', {}))
    expect(await say('reset the view')).toMatch(/already at its default view/)
    expect(v.calls).toEqual([])
  }, 40000)
})

describe('chartSetup.setIndicatorsHidden: Alt+Shift+I', () => {
  it('hides, reads back, Undo brings them back; nothing is stored', async () => {
    const { say, h, board } = p.mount(...ONE('NVDA'))
    const v = withView(h)
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(op('chartSetup.setIndicatorsHidden', { hidden: true }))
    await say('hide all my indicators')
    expect(v.indicatorsHidden).toBe(true)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    await say('undo')
    expect(v.indicatorsHidden).toBe(false)
  }, 40000)
})

describe('chartSetup.setMovingAverages: Ctrl+M\'s writer', () => {
  const avg = (id, extra = {}) => ({ id, defId: 'movingAverage', inputs: {}, ...extra })
  const other = (id) => ({ id, defId: 'rsi', inputs: {} })
  const REG = (defId) => (defId === 'movingAverage' ? { meta: { appearance: {} } } : { meta: {} })

  it('the shared writer: live overlay slots and average instances flip, tombstones and other indicators do not', () => {
    const cs = { overlays: [{ enabled: true }, { removed: true, enabled: false }], indicatorInstances: [avg('a'), avg('d', { deleted: true }), other('r')] }
    expect(anyMovingAverageOn(cs, REG)).toBe(true)
    const off = withMovingAverages(cs, false, REG)
    expect(off.overlays).toEqual([{ enabled: false }, { removed: true, enabled: false }])
    expect(off.indicatorInstances).toEqual([avg('a', { hidden: true }), avg('d', { deleted: true }), other('r')])
    expect(anyMovingAverageOn(off, REG)).toBe(false)
    expect(withMovingAverages(off, true, REG).indicatorInstances[0].hidden).toBe(false)
  })

  it('through the panel: every moving average hidden in the stored chart (the overlay slots are adopted instances); Undo restores it byte for byte', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    const w = () => board.state.widgets.find(x => x.id === 'c')
    w().opts.settings = { ...w().opts.settings, overlays: CHART_DEFAULTS.overlays.map(o => ({ ...o, enabled: true })) }
    const before = JSON.stringify(w().opts.settings)
    p.st.envelopes.push(op('chartSetup.setMovingAverages', { visible: false }))
    await say('hide my moving averages')
    const averages = w().opts.settings.indicatorInstances.filter(i => i.defId === 'movingAverage')
    expect(averages.length).toBe(CHART_DEFAULTS.overlays.length)
    expect(averages.every(i => i.hidden === true)).toBe(true)
    await say('undo')
    expect(JSON.stringify(w().opts.settings)).toBe(before)
  }, 40000)

  it('a chart with none refuses', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(op('chartSetup.setMovingAverages', { visible: false }))
    expect(await say('hide my moving averages')).toMatch(/no moving averages/)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
})

it('each new capability is local, on /charts, and reaches the chart target', () => {
  for (const name of ['chartSetup.setRange', 'chartSetup.resetView', 'chartSetup.setIndicatorsHidden', 'chartSetup.setMovingAverages']) {
    expect(getCapability(name)?.target, name).toBe('chart')
    expect(getCapability(name).surfaces).toEqual(['charts'])
  }
})
