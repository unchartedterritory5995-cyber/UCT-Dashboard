// Charts family: headerValue.set (marker: 'headerValue.set') — an indicator line's latest value in the chart header, the legend
// chip's "Value in header" row — through the REAL panel on the fixture board, the model scripted (no paid call), plus the
// member's own obvious words on the fast path. The write is the product's: engine/infoValues.js addInfoValue / removeInfoValue
// with infoValueOutputExists (StockChart handleChipInfoValue's exact arguments), a REFERENCE under header.infoValues only;
// read back; exact Undo. The indicator itself (instances, inputs, style) is never touched; the other charts stay byte-identical.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans through the real panel.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { getCapability } from './capabilities'
import { wordsSelect, groupOfAction } from './routing'
import { fastParse } from './fastPath'
import { withInstances, removeInstance } from '../components/chart/engine/instanceControls'
import * as registry from '../components/chart/engine/nativeRegistry'
import { addInfoValue, infoValuesOf, MAX_INFO_VALUES } from '../components/chart/engine/infoValues'
import { infoValueOutputExists } from '../components/chart/engine/infoValueResolve'
import { HEADER_VALUE_ACTION, instanceOfWords, valueLinesOf, headerValueRequest } from './capabilities/headerValue'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const HV = HEADER_VALUE_ACTION
const defOf = (id) => registry.getDefinition(id)
const W = 12, H = 10
const IDS = ['c0', 'c1', 'c2', 'c3']
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', A: 'NVDA', B: 'TSLA' }
const RSI = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false }
const RSI7 = { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: { period: 7 }, hidden: false }
const MACD = { instanceId: 'inst:macd:1', defId: 'macd', inputs: {}, hidden: false }
const SMA50 = { instanceId: 'inst:movingAverage:1', defId: 'movingAverage', inputs: { period: 50, maType: 'sma' }, hidden: false }
const EMA20 = { instanceId: 'inst:movingAverage:2', defId: 'movingAverage', inputs: { period: 20, maType: 'ema' }, hidden: false }
const withList = (list, header = null) => {
  const base = bareSettings()
  let cs = withInstances(base, [...(base.indicatorInstances || []), ...list], registry)
  if (header) cs = header(cs)
  return JSON.parse(JSON.stringify(cs))
}
const STD = () => withList([RSI, MACD, SMA50, EMA20])
const cell = (id, i, color, settings) => ({ id, type: 'chart', x: (i % 2) * W, y: Math.floor(i / 2) * H, w: W, h: H, color, opts: { settings } })
const COLORS = ['N', 'N', 'A', 'B']

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

function mountOn(clicked, settings = {}) {
  const widgets = IDS.map((id, i) => cell(id, i, COLORS[i], settings[id] || STD()))
  const m = p.mount(widgets, SYMS, { decorate: (s) => (s ? { ...s, label: `Chart (${s.ref})` } : s) })
  if (clicked) p.select(clicked)
  return m
}
const stored = (b, id) => b.state.widgets.find(w => w.id === id).opts.settings
const hv = (b, id) => infoValuesOf(stored(b, id)).map(o => `${o.instanceId}::${o.plotKey}${o.severed ? '!' : ''}`)
const others = (b, id) => JSON.stringify(b.state.widgets.filter(w => w.id !== id).map(w => w.opts))
const instancesJson = (b, id) => JSON.stringify(stored(b, id).indicatorInstances || [])
const refOf = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
const plan = (...ops) => (body) => p.env('apply', ops.map(([id, args]) => ({ action: HV, target: refOf(body, id), args: { instance: null, output: null, show: true, all: null, ...args } })))
const undoButton = () => screen.queryByRole('button', { name: 'Undo' })
const transcript = () => screen.getByTestId('agent-transcript').textContent
const withHeader = (...refs) => (cs) => refs.reduce((c, r) => addInfoValue(c, { ...r, format: 'auto' }, defOf, infoValueOutputExists), cs)

describe('P1 · show a value: the chip\'s own writer, a reference only; read back; exact Undo', () => {
  // [phrasing, the reference it writes] — class-generated over verbs, value words, possessives and the ways a member names a line
  const SHOW = [
    ['show the rsi value in the header', 'inst:rsi:1::rsi'],
    ['put the RSI value in the header', 'inst:rsi:1::rsi'],
    ["add rsi's latest value to the header", 'inst:rsi:1::rsi'],
    ['pin the rsi reading to the chart header', 'inst:rsi:1::rsi'],
    ['display the current rsi value in the header', 'inst:rsi:1::rsi'],
    ['show rsi in the header', 'inst:rsi:1::rsi'],
    ['show the 50 sma value in the header', 'inst:movingAverage:1::ma'],
    ['put the 20 ema in the header', 'inst:movingAverage:2::ma'],
    ['show the 50 in the header', 'inst:movingAverage:1::ma'],
    ['add the relative strength index value to the header', 'inst:rsi:1::rsi'],
    ['show the latest 20 ema reading in the header.', 'inst:movingAverage:2::ma'],
    ['stick the rsi value up in the header', 'inst:rsi:1::rsi'],
  ]
  it.each(SHOW)('"%s" (fast path, no model): the clicked chart gains %s; instances untouched; others byte-identical; Undo exact', async (t, ref) => {
    const { say, board: b } = mountOn('c2')
    const before = others(b, 'c2')
    const blob = JSON.stringify(stored(b, 'c2'))
    const inst = instancesJson(b, 'c2')
    const out = await say(t)
    expect(out, transcript()).toMatch(/Showing .*latest value in the chart header/)
    expect(p.turns()).toBe(0)
    expect(hv(b, 'c2')).toEqual([ref])
    expect(instancesJson(b, 'c2')).toBe(inst)                      // ⛔ the indicator itself is never touched
    expect(others(b, 'c2')).toBe(before)                           // wrong-target control
    await say('undo')
    expect(JSON.stringify(stored(b, 'c2'))).toBe(blob)
  }, 40000)
  it('the write IS the chip\'s: the same blob handleChipInfoValue makes (addInfoValue + infoValueOutputExists)', () => {
    const cs = STD()
    const st = { cs, symbol: 'SPY' }
    const next = getCapability(HV).apply(st, { instance: 'rsi', output: null, show: true, all: null })
    expect(next.cs).toEqual(addInfoValue(cs, { instanceId: 'inst:rsi:1', plotKey: 'rsi', format: 'auto' }, defOf, infoValueOutputExists))
    expect(next.cs.indicatorInstances).toEqual(cs.indicatorInstances)
  })
  it('a commit the chart did not keep is never a success (read-back): nothing claimed, no Undo', async () => {
    const { say, board: b, h } = mountOn('c0')
    const real = h.charts.commit
    h.charts.commit = () => true
    const out = await say('show the rsi value in the header')
    h.charts.commit = real
    expect(out).not.toMatch(/Showing/)
    expect(hv(b, 'c0')).toEqual([])
    expect(undoButton()).toBeNull()
  }, 40000)
})

describe('P2 · several lines: asked with the real choices, or the one named', () => {
  it('"show the macd value in the header": MACD draws three value lines — asked, nothing written, no model call', async () => {
    const { say, board: b } = mountOn('c0')
    const was = JSON.stringify(b.state.widgets)
    const out = await say('show the macd value in the header')
    expect(out).toMatch(/MACD.* draws more than one line — which one’s value should go in the header: MACD, Signal or Histogram\?/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
    expect(p.turns()).toBe(0)
  }, 40000)
  it.each([['signal', 'signal'], ['the signal line', 'signal'], ['Histogram', 'histogram'], ['hist', 'histogram'], ['macd', 'macd']])(
    'output "%s" (scripted plan) → MACD\'s %s line', async (o, key) => {
      const { say, board: b } = mountOn('c0')
      p.st.envelopes.push(plan(['c0', { instance: 'macd', output: o }]))
      expect(await say('put the macd signal in the header please')).toMatch(/Showing/)
      expect(hv(b, 'c0')).toEqual([`inst:macd:1::${key}`])
    }, 40000)
  it('a guide line (RSI\'s 70 / 30 bands) is not a value: refused with the real lines, nothing written', async () => {
    const { say, board: b } = mountOn('c0')
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(['c0', { instance: 'rsi', output: 'bands' }]))
    expect(await say('put the rsi bands in the header please')).toMatch(/has no “bands” line with a value/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('value lines come from the definition (guides excluded)', () => {
    expect(valueLinesOf('rsi').map(l => l.key)).toEqual(['rsi'])
    expect(valueLinesOf('macd').map(l => l.key)).toEqual(['macd', 'signal', 'histogram'])
  })
})

describe('P3 · which indicator: never a guess', () => {
  it('two RSIs on the chart: asked by their legend names, nothing written', async () => {
    const { say, board: b } = mountOn('c0', { c0: withList([RSI, RSI7]) })
    const was = JSON.stringify(b.state.widgets)
    const out = await say('show the rsi value in the header')
    expect(out).toMatch(/More than one indicator on the SPY chart matches that/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('an indicator that is not on the chart: said, with the way to add it; nothing written', async () => {
    const { say, board: b } = mountOn('c0', { c0: withList([MACD]) })
    const was = JSON.stringify(b.state.widgets)
    expect(await say('show the rsi value in the header')).toMatch(/There’s no rsi on the SPY chart, so there is no value of it to put in the header/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it.each(['show volume in the header', 'show the market cap in the header', 'add rvol to the header', 'show the close value in the header'])(
    '"%s": the header\'s own stats / Bar info — never claimed by this action on the fast path', (t) => {
      const r = fastParse(t)
      const ops = r?.ops || []
      expect(ops.some(o => o.action === HV)).toBe(false)
    })
  it('words → instance argument', () => {
    expect(instanceOfWords('the 50 sma')).toBe('#50:sma')
    expect(instanceOfWords('20 ema')).toBe('#20:ema')
    expect(instanceOfWords('the 50')).toBe('#50')
    expect(instanceOfWords('rsi')).toBe('rsi')
    expect(instanceOfWords('volume')).toBe(null)
    expect(instanceOfWords('market cap')).toBe(null)
  })
})

describe('P4 · take a value out; already / not there is an honest receipt', () => {
  const on = (...refs) => withList([RSI, MACD, SMA50, EMA20], withHeader(...refs))
  it.each(['remove the rsi value from the header', 'take the rsi value out of the header', 'hide rsi from the header', 'remove rsi from the header'])(
    '"%s": the RSI reference goes, the 50 SMA\'s stays; the indicator stays on the chart; Undo exact', async (t) => {
      const { say, board: b } = mountOn('c1', { c1: on({ instanceId: 'inst:rsi:1', plotKey: 'rsi' }, { instanceId: 'inst:movingAverage:1', plotKey: 'ma' }) })
      const blob = JSON.stringify(stored(b, 'c1'))
      const inst = instancesJson(b, 'c1')
      expect(await say(t)).toMatch(/Took .*value out of the chart header \(the indicator stays on the chart\)/)
      expect(hv(b, 'c1')).toEqual(['inst:movingAverage:1::ma'])
      expect(instancesJson(b, 'c1')).toBe(inst)
      await say('undo')
      expect(JSON.stringify(stored(b, 'c1'))).toBe(blob)
    }, 40000)
  it('two MACD values in the header and "remove the macd value": asked which, nothing written', async () => {
    const { say, board: b } = mountOn('c1', { c1: on({ instanceId: 'inst:macd:1', plotKey: 'macd' }, { instanceId: 'inst:macd:1', plotKey: 'signal' }) })
    const was = JSON.stringify(b.state.widgets)
    expect(await say('remove the macd value from the header')).toMatch(/has 2 values in the header \(MACD, Signal\) — remove which one, or all of them\?/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it('"remove every value from the header": all of them, a broken one too (its indicator deleted); Undo exact', async () => {
    const cs = removeInstance(on({ instanceId: 'inst:rsi:1', plotKey: 'rsi' }, { instanceId: 'inst:macd:1', plotKey: 'signal' }), 'inst:rsi:1', registry)
    const { say, board: b } = mountOn('c0', { c0: JSON.parse(JSON.stringify(cs)) })
    expect(hv(b, 'c0')).toEqual(['inst:rsi:1::rsi!', 'inst:macd:1::signal'])
    const blob = JSON.stringify(stored(b, 'c0'))
    expect(await say('remove every value from the header')).toMatch(/Took .*out of the chart header/)
    expect(hv(b, 'c0')).toEqual([])
    await say('undo')
    expect(JSON.stringify(stored(b, 'c0'))).toBe(blob)
  }, 40000)
  it('removing the value of a DELETED indicator by name: the broken value is named, never silently retargeted', async () => {
    const cs = removeInstance(on({ instanceId: 'inst:rsi:1', plotKey: 'rsi' }), 'inst:rsi:1', registry)
    const { say, board: b } = mountOn('c0', { c0: JSON.parse(JSON.stringify(cs)) })
    const was = JSON.stringify(b.state.widgets)
    expect(await say('remove the rsi value from the header')).toMatch(/There’s no rsi on the SPY chart\. The header has one value whose indicator was removed .*remove every value from the header/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
  it.each([
    ['show the rsi value in the header', () => on({ instanceId: 'inst:rsi:1', plotKey: 'rsi' }), /value is already in the header of the SPY chart/],
    ['remove the rsi value from the header', () => STD(), /That value isn’t in the header of the SPY chart/],
    ['remove every value from the header', () => STD(), /There are no indicator values in the header of the SPY chart/],
  ])('"%s": no write, no Undo', async (t, s, re) => {
    const { say, board: b } = mountOn('c0', { c0: s() })
    const was = JSON.stringify(b.state.widgets)
    expect(await say(t)).toMatch(re)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
    expect(undoButton()).toBeNull()
  }, 40000)
  it(`the header's cap (${MAX_INFO_VALUES}): said, nothing written`, () => {
    const many = Array.from({ length: MAX_INFO_VALUES }, (_, i) => ({ instanceId: `inst:movingAverage:${i + 1}`, defId: 'movingAverage', inputs: { period: 10 + i, maType: 'sma' }, hidden: false }))
    const cs = withList([...many, RSI], withHeader(...many.map(m => ({ instanceId: m.instanceId, plotKey: 'ma' }))))
    expect(infoValuesOf(cs)).toHaveLength(MAX_INFO_VALUES)
    expect(headerValueRequest({ cs, symbol: 'SPY' }, { instance: 'rsi', output: null, show: true, all: null }).why).toMatch(/at most 12 values/)
  })
})

describe('P5 · targeting: a named chart, every chart, exceptions; a plan one chart cannot take is refused whole', () => {
  it('"show the rsi value in the header on the NVDA chart" (c0 clicked): only NVDA\'s chart', async () => {
    const { say, board: b } = mountOn('c0')
    const before = others(b, 'c2')
    p.st.envelopes.push(plan(['c2', { instance: 'rsi' }]))
    await say('show the rsi value in the header on the NVDA chart')
    expect(hv(b, 'c2')).toEqual(['inst:rsi:1::rsi'])
    expect(others(b, 'c2')).toBe(before)
  }, 40000)
  it('every chart: all four; one Undo takes all four back', async () => {
    const { say, board: b } = mountOn(null)
    const blobs = IDS.map(id => JSON.stringify(stored(b, id)))
    p.st.envelopes.push(plan(...IDS.map(id => [id, { instance: 'rsi' }])))
    await say('show the rsi value in the header on every chart')
    expect(IDS.map(id => hv(b, id))).toEqual(IDS.map(() => ['inst:rsi:1::rsi']))
    await say('undo')
    expect(IDS.map(id => JSON.stringify(stored(b, id)))).toEqual(blobs)
  }, 40000)
  it.each([
    ['show the rsi value in the header on every chart except mine', 'c1'],
    ['show the rsi value in the header on every chart except the NVDA one', 'c2'],
  ])('"%s": a plan that also names the excluded chart is never run on it', async (t, excluded) => {
    const { say, board: b } = mountOn('c1')
    const keep = JSON.stringify(b.state.widgets.find(w => w.id === excluded).opts)
    p.st.envelopes.push(plan(...IDS.map(id => [id, { instance: 'rsi' }])))
    await say(t)
    expect(JSON.stringify(b.state.widgets.find(w => w.id === excluded).opts), transcript()).toBe(keep)
  }, 40000)
  it('every chart, but one has no RSI: refused whole — no chart is half-done', async () => {
    const { say, board: b } = mountOn(null, { c3: withList([MACD]) })
    const was = JSON.stringify(b.state.widgets)
    p.st.envelopes.push(plan(...IDS.map(id => [id, { instance: 'rsi' }])))
    const out = await say('show the rsi value in the header on every chart')
    expect(out).toMatch(/There’s no rsi on the TSLA chart/)
    expect(JSON.stringify(b.state.widgets)).toBe(was)
  }, 40000)
})

describe('P6 · routing: its own words-only group', () => {
  it('the action is in the headerValue group', () => {
    expect(groupOfAction(HV)).toBe('headerValue')
  })
  it.each(['show the rsi value in the header', 'remove the macd reading from the header', 'put the 50 sma in the header'])('"%s" selects the group', (t) => {
    expect(wordsSelect('headerValue', t)).toBe(true)
  })
  it.each(['show the rsi', 'add a header color', 'make the header title gold', 'show the rsi value'])('"%s" does not', (t) => {
    expect(wordsSelect('headerValue', t)).toBe(false)
  })
})
