// Two more of the chart's own view controls, as vertical slices through the REAL panel (scripted model): the price axis
// menu's Auto-scale (C1-025) and the Time Navigator's ◀ / ▶ one-bar steps (C1-032). Request → the chart named → the
// control's own writer → read-back from the view (getDateMeta) → the receipt, and Undo where one exists. The stand-in
// chart keeps a view the way getDateMeta reports it, so a control that does not land is one the Agent cannot claim.
// StockChart's half (the shared writer and the read-back) is read from the source below.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO } from './testing/panelHarness'
import { getCapability } from './capabilities'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const op = (action, args, target = 'c') => p.env('apply', [{ action, target, args }])
const here = dirname(fileURLToPath(import.meta.url))
const src = (rel) => readFileSync(resolve(here, rel), 'utf8')

/** Each chart's view on the fixture board, by ref. `viewDo` is the chart's own control; `land: false` = it did nothing. */
function withViews(h, start = {}) {
  const views = {}
  const viewOf = (ref) => (views[ref] ||= { priceAuto: false, land: true, calls: [], fromRight: 150, toRight: -9, locked: false, lock: null, activeRange: null, ...start })
  const meta = (ref) => {
    const v = viewOf(ref)
    return { firstMs: 0, lastMs: 1, rightMs: 1, activeRange: v.activeRange, atDefaultView: false, indicatorsHidden: false,
      ...(v.noPrice ? {} : { priceAuto: v.priceAuto }),
      frame: v.noFrame ? null : { fromRight: v.fromRight, toRight: v.toRight, activeRange: v.activeRange, locked: v.locked, lock: v.lock } }
  }
  const base = h.charts
  const read = base.read, list = base.list
  h.charts = {
    ...base,
    read: (ref) => { const s = read(ref); return s && { ...s, view: meta(ref) } },
    list: () => list().map(s => ({ ...s, view: meta(s.ref) })),
    viewDo: (ref, o, arg) => {
      const v = viewOf(ref)
      v.calls.push([o, arg])
      if (!v.land) return true
      // as the real stepBar: the logical window moves by `arg` bars (from + arg, to + arg), so right-relative it moves by −arg
      if (o === 'stepBar') { v.fromRight -= arg; v.toRight -= arg; v.activeRange = null }
      if (o === 'autoScale') v.priceAuto = true
      if (o === 'restoreView') { v.fromRight = arg.fromRight; v.toRight = arg.toRight; v.activeRange = arg.activeRange; v.locked = arg.locked; v.lock = arg.lock }
      return true
    },
  }
  return viewOf
}
const fastClock = () => {
  const realNow = Date.now
  let t = realNow()
  vi.spyOn(Date, 'now').mockImplementation(() => { t += 2000; return t })   // the 10s read-back wait passes at once
}

describe('chartSetup.stepBars: the Time Navigator\'s ◀ / ▶', () => {
  it('one bar forward reaches the chart\'s own stepBar with +1 and is read back from the window', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h)('c')
    p.st.envelopes.push(op('chartSetup.stepBars', { direction: 'forward', bars: 1 }))
    expect(await say('step the chart forward one bar')).toMatch(/Moved this chart 1 bar forward/)
    expect(v.calls).toEqual([['stepBar', 1]])
    expect([v.fromRight, v.toRight]).toEqual([149, -10])
  }, 40000)

  it('five bars back is ONE call with −5 (the same writer, the same arithmetic as five clicks)', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h)('c')
    p.st.envelopes.push(op('chartSetup.stepBars', { direction: 'back', bars: 5 }))
    expect(await say('go back 5 bars')).toMatch(/Moved this chart 5 bars back/)
    expect(v.calls).toEqual([['stepBar', -5]])
    expect([v.fromRight, v.toRight]).toEqual([155, -4])
  }, 40000)

  it('Undo puts back the exact window and view lock it moved from', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const lock = { anchorFrac: 0.7, width: 90, tf: 'D', top: 0.1, bottom: 0.8 }
    const v = withViews(h, { fromRight: 88.25, toRight: -3.5, locked: true, lock })('c')
    p.st.envelopes.push(op('chartSetup.stepBars', { direction: 'back', bars: 3 }))
    const out = await say('step back three bars')
    expect(out).not.toMatch(/has no Undo|can't be undone/)
    await say('undo')
    expect(v.calls.at(-1)[0]).toBe('restoreView')
    expect({ from: v.fromRight, to: v.toRight, locked: v.locked, lock: v.lock }).toEqual({ from: 88.25, to: -3.5, locked: true, lock })
  }, 60000)

  it('a member who panned since keeps their view: Undo refuses as stale and moves nothing', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h)('c')
    p.st.envelopes.push(op('chartSetup.stepBars', { direction: 'back', bars: 2 }))
    await say('step back two bars')
    Object.assign(v, { fromRight: 40, toRight: -20 })       // the member's own pan
    const calls = v.calls.length
    await say('undo')
    expect(document.body.textContent).toMatch(/has changed since/)
    expect(v.calls.length).toBe(calls)
    expect(v.fromRight).toBe(40)
  }, 60000)

  it('⛔ a chart whose window did not move gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h, { land: false })('c')
    fastClock()
    p.st.envelopes.push(op('chartSetup.stepBars', { direction: 'forward', bars: 1 }))
    expect(await say('step forward a bar')).not.toMatch(/Moved this chart/)
    expect(v.calls).toEqual([['stepBar', 1]])
  }, 40000)

  it('⛔ a window that moved by the WRONG number of bars gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const get = withViews(h)
    const v = get('c')
    const real = h.charts.viewDo
    h.charts.viewDo = (ref, o, arg) => real(ref, o, o === 'stepBar' ? arg * 2 : arg)   // a chart that stepped twice as far
    fastClock()
    p.st.envelopes.push(op('chartSetup.stepBars', { direction: 'back', bars: 4 }))
    expect(await say('back four bars')).not.toMatch(/Moved this chart/)
    expect(v.fromRight).toBe(158)
  }, 40000)

  it('a window it cannot read: refuses, and the chart is not told to move', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h, { noFrame: true })('c')
    p.st.envelopes.push(op('chartSetup.stepBars', { direction: 'back', bars: 1 }))
    expect(await say('step back a bar')).toMatch(/hasn.t finished loading/)
    expect(v.calls).toEqual([])
  }, 40000)

  it('a step outside 1–100 bars refuses and points at a date; nothing moves', async () => {
    for (const bars of [0, 101]) {
      const { say, h } = p.mount(...ONE('NVDA'))
      const v = withViews(h)('c')
      p.st.envelopes.push(op('chartSetup.stepBars', { direction: 'back', bars }))
      expect(await say(`step back ${bars} bars`)).toMatch(/1 to 100 bars at a time/)
      expect(v.calls).toEqual([])
      cleanup()
    }
  }, 60000)

  it('wrong-target control: with two charts, only the chart named moves', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const get = withViews(h)
    const left = get('cl'), right = get('cr')
    p.st.envelopes.push(op('chartSetup.stepBars', { direction: 'forward', bars: 2 }, 'cr'))
    await say('step the AMD chart forward two bars')
    expect(right.calls).toEqual([['stepBar', 2]])
    expect(left.calls).toEqual([])
    expect([left.fromRight, left.toRight]).toEqual([150, -9])
  }, 40000)
})

describe('chartSetup.autoScale: the price axis menu → Auto-scale', () => {
  it('a hand-set price scale goes back to auto, read back from the price scale; the receipt says there is no Undo', async () => {
    const { say, h, board } = p.mount(...ONE('NVDA'))
    const v = withViews(h)('c')
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(op('chartSetup.autoScale', {}))
    const out = await say('auto scale the price axis')
    expect(out).toMatch(/price scale back on auto-scale/)
    expect(out).toMatch(/Auto-scale has no Undo/)
    expect(v.calls).toEqual([['autoScale', undefined]])
    expect(v.priceAuto).toBe(true)
    expect([v.fromRight, v.toRight]).toEqual([150, -9])          // the time window is not touched
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(getCapability('chartSetup.autoScale').undo).toBe('none')
  }, 40000)

  it('already on auto-scale: a no-op, the chart is not called', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h, { priceAuto: true })('c')
    p.st.envelopes.push(op('chartSetup.autoScale', {}))
    expect(await say('auto scale')).toMatch(/already on auto-scale/)
    expect(v.calls).toEqual([])
  }, 40000)

  it('⛔ a price scale it cannot read is unavailable, never "already auto": nothing is called', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h, { noPrice: true })('c')
    p.st.envelopes.push(op('chartSetup.autoScale', {}))
    const out = await say('auto scale')
    expect(out).toMatch(/can.t read this chart.s price scale/)
    expect(out).not.toMatch(/already on auto-scale/)
    expect(v.calls).toEqual([])
  }, 40000)

  it('⛔ a price scale that stayed hand-set gets no success', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const v = withViews(h, { land: false })('c')
    fastClock()
    p.st.envelopes.push(op('chartSetup.autoScale', {}))
    expect(await say('auto scale')).not.toMatch(/price scale back on auto-scale/)
    expect(v.priceAuto).toBe(false)
  }, 40000)

  it('wrong-target control: with two charts, only the chart named is auto-scaled', async () => {
    const { say, h } = p.mount(...TWO('NVDA', 'AMD'))
    const get = withViews(h)
    const left = get('cl'), right = get('cr')
    p.st.envelopes.push(op('chartSetup.autoScale', {}, 'cl'))
    await say('auto scale the NVDA chart')
    expect(left.priceAuto).toBe(true)
    expect(right.calls).toEqual([])
    expect(right.priceAuto).toBe(false)
  }, 40000)
})

describe('the chart\'s half: one writer for the menu and the Agent, and the read-back', () => {
  it('the price axis menu\'s Auto-scale and the Agent call the SAME doAutoScale, which releases the hand-set pin', () => {
    const s = src('../components/StockChart.jsx')
    const body = s.slice(s.indexOf('const doAutoScale = () => {'), s.indexOf('autoScaleRef.current = doAutoScale'))
    expect(body).toMatch(/priceManualRef\.current = false/)
    expect(body).toMatch(/priceManualRangeRef\.current = null/)
    expect(body).toMatch(/vertMarginsRef\.current = null/)
    expect(body).toMatch(/autoScale: true/)
    expect(s).toMatch(/const autoScale = \(\) => autoScaleRef\.current\?\.\(\)/)
    expect(s).toMatch(/autoScale: \(\) => autoScaleRef\.current\?\.\(\)/)
    // the read-back asks the price scale itself, and the ◀ / ▶ buttons' stepBar is the one the Agent reaches
    expect(s).toMatch(/priceAuto[,:]/)
    const pane = src('../components/chart/pane/ChartPane.jsx')
    expect(pane).toMatch(/\['applyRange', 'restoreView', 'resetView', 'setIndicatorsHidden', 'stepBar', 'autoScale', 'zoom', 'positionCalc'\]/)      // drawing extras: + the Position Calculator (drawing.positionCalculator)
    expect(src('../pages/charts/widgets/ChartDateNav.jsx')).toMatch(/paneRef\?\.current\?\.stepBar\?\.\(-1\)/)
  })
})
