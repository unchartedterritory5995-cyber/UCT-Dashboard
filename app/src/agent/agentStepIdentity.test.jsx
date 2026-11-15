// ⛔ STEP IDENTITY (2026-11-14, owner live test BUG B; AUDIT probe 43) — through the REAL panel (panelHarness: AgentPanel +
// useAgent + registry, planner, policy, runtime, receipts and Undo) on the REAL board writer and the REAL Indicators interface.
// Stand-in: the Agent model, scripted in the shapes a model writes. An object changed by one step and then changed AGAIN by the
// next step of the same request is the SAME object in both — whatever its words described before the first change.
//   INDICATOR  (queued steps, agent/stepIdentity.js + indicatorEdits pinIdentity): change × reference form × follow-up change
//   CHART / LIST (one plan over stable refs): re-symbol then re-timeframe, rename then add — the same target throughout
//   PARTIAL    a step that does not run after one that did: the receipt says the change above stands and names why this part
//              didn't run — never "I didn't change anything", never "the rest of your request was done"
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { PARTIAL_LEAD, partialStepText } from './useAgent'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// one SPY chart with the product's default indicators: EMA 9 (ovl:0), EMA 20 (ovl:1), SMA 50 (ovl:2), SMA 200 (ovl:3)
const ONE_SPY = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }], { 'N:c': 'SPY' }]
const ixe = (b) => b.context.indicatorEdits[0].ref
const live = (m) => Object.fromEntries(p.instancesOn(m.board, 'c').map(i => [i.instanceId, { period: i.inputs?.period, type: i.inputs?.maType, color: i.inputs?.color, hidden: !!i.hidden, width: i.presentation?.lineWidth ?? i.inputs?.lineWidth ?? null, raw: process.env.DUMP ? JSON.stringify(i) : undefined }]))
const NOT_THERE = /isn['’]t on Chart \(SPY\) any more|No indicator on Chart \(SPY\) shows/
const NEVER = /I didn['’]t change anything|The rest of your request was done/

// the first step: what it changes on the EMA 20 (ovl:1), and what the EMA is afterwards
const FIRST = {
  'length 20 → 50': { op: { action: 'indicator.update', args: { inputs: [{ key: 'period', value: 50 }] } }, after: { period: 50, type: 'ema' } },
  'type EMA → SMA': { op: { action: 'indicator.update', args: { inputs: [{ key: 'maType', value: 'sma' }] } }, after: { period: 20, type: 'sma' } },
  'hidden': { op: { action: 'indicator.hide', args: {} }, after: { period: 20, type: 'ema', hidden: true } },
}
// how the plan names the EMA 20 — in BOTH steps (as written before anything ran)
const FORMS = { 'its id': 'ovl:1', '"#20:ema"': '#20:ema', '"#20"': '#20', '"EMA 20"': 'EMA 20' }
// the second step, and what it leaves on the same EMA
const SECOND = {
  'colour blue': { op: { action: 'indicatorStyle.set', args: { property: 'color', value: 'blue', output: null } }, check: (e) => expect(e.color).toBe('#2962ff') },
  'line width 3': { op: { action: 'indicatorStyle.set', args: { property: 'lineWidth', value: 3, output: null } }, check: (e) => expect(e.width).toBe(3) },
  'hidden': { op: { action: 'indicator.hide', args: {} }, check: (e) => expect(e.hidden).toBe(true) },
}
const CASES = Object.keys(FIRST).flatMap(f => Object.keys(FORMS).flatMap(r => Object.keys(SECOND).filter(s => !(f === 'hidden' && s === 'hidden')).map(s => [f, r, s])))

describe('INDICATOR · edit it, then edit the SAME indicator in the next step', () => {
  it.each(CASES)('first %s, named by %s in both steps, then %s → both land on the EMA (ovl:1), nothing else changes', async (f, r, s) => {
    const m = p.mount(...ONE_SPY())
    const before = live(m)
    const inst = FORMS[r]
    p.st.envelopes.push(b => p.env('apply', [
      { ...FIRST[f].op, target: ixe(b), args: { instance: inst, ...FIRST[f].op.args } },
      { ...SECOND[s].op, target: ixe(b), args: { instance: inst, ...SECOND[s].op.args } },
    ]))
    const out = await m.say('change the 20 EMA, then change it again')
    const after = live(m)
    expect(out).not.toMatch(NOT_THERE)
    expect(out).not.toMatch(NEVER)
    expect(after['ovl:1'], out).toMatchObject(FIRST[f].after)
    if (process.env.DUMP) console.log('W>>', JSON.stringify(after['ovl:1']))
    SECOND[s].check(after['ovl:1'])
    for (const id of ['ovl:0', 'ovl:2', 'ovl:3']) expect(after[id], `${id} must not change`).toEqual(before[id])
  }, 40000)
})

describe('INDICATOR · the words mean another indicator after the first step → that step does not run (asked, never guessed)', () => {
  it('EMA 20 → 50, then "#50" (the SMA 50 before; the SMA 50 AND the new EMA 50 now) → no colour on either, said honestly', async () => {
    const m = p.mount(...ONE_SPY())
    p.st.envelopes.push(b => p.env('apply', [
      { action: 'indicator.update', target: ixe(b), args: { instance: '#20:ema', inputs: [{ key: 'period', value: 50 }] } },
      { action: 'indicatorStyle.set', target: ixe(b), args: { instance: '#50', property: 'color', value: 'blue', output: null } },
    ]))
    const out = await m.say('change the 20 EMA to a 50 and make the 50 blue')
    const after = live(m)
    expect(after['ovl:1']).toMatchObject({ period: 50, type: 'ema' })
    expect(after['ovl:1'].color).not.toBe('#2962ff')
    expect(after['ovl:2'].color).not.toBe('#2962ff')
    expect(out).toContain(PARTIAL_LEAD)
    expect(out).toMatch(/could mean a different indicator/)
    expect(out).not.toMatch(NEVER)
  }, 40000)
})

describe('INDICATOR · the next step is about what the step before MADE (nothing to pin) → it runs on the live state', () => {
  it('add RSI, then make the RSI line width 3', async () => {
    const m = p.mount(...ONE_SPY())
    p.st.envelopes.push(b => p.env('apply', [
      { action: 'indicator.add', target: ixe(b), args: { defId: 'rsi', inputs: null } },
      { action: 'indicatorStyle.set', target: ixe(b), args: { instance: 'rsi', property: 'lineWidth', value: 3, output: null } },
    ]))
    const out = await m.say('add RSI and make its line thicker')
    const rsi = p.instancesOn(m.board, 'c').find(i => i.defId === 'rsi')
    expect(rsi, out).toBeTruthy()
    expect(out).not.toMatch(NEVER)
  }, 40000)
})

describe('PARTIAL · a step that cannot run after one that did', () => {
  it('remove the EMA 20, then colour "#20:ema" — truly gone: the honest partial receipt, the removal stands', async () => {
    const m = p.mount(...ONE_SPY())
    p.st.envelopes.push(b => p.env('apply', [
      { action: 'indicator.remove', target: ixe(b), args: { instance: '#20:ema' } },
      { action: 'indicatorStyle.set', target: ixe(b), args: { instance: '#20:ema', property: 'color', value: 'blue', output: null } },
    ]))
    let out = await m.say('could you remove the 20 EMA for me, and after that i would like it in blue')
    expect(p.turns(), 'the model planned it (the words ask for the removal: #1247 state rail)').toBe(1)
    if (p.proposals().length) out += await m.say('do it')
    if (process.env.DUMP) console.log('RM>>', out, JSON.stringify(live(m)['ovl:1']))
    expect(live(m)['ovl:1']).toBeUndefined()
    expect(out).toContain(PARTIAL_LEAD)
    expect(out).not.toMatch(NEVER)
  }, 40000)
  it.each([
    ["I didn't change anything: That indicator isn't on Chart (SPY) any more.", `${PARTIAL_LEAD} That indicator isn't on Chart (SPY) any more.`],
    ['I didn’t change anything: x', `${PARTIAL_LEAD} x`],
    ['Which setting should I change?', `${PARTIAL_LEAD} Which setting should I change?`],
    [`${PARTIAL_LEAD} y`, `${PARTIAL_LEAD} y`],
  ])('partialStepText(%j)', (t, out) => { expect(partialStepText(t)).toBe(out) })
})

describe('CHART / LIST · edit, then edit the same target in one plan (stable refs)', () => {
  it('re-symbol a chart, then change ITS timeframe', async () => {
    const m = p.mount(...ONE_SPY())
    p.st.envelopes.push(b => p.env('apply', [
      { action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: 'NVDA' } },
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
    ]))
    const out = await m.say('change my SPY chart to NVDA and make it weekly')
    const c = m.h.charts.read('c')
    expect([c.symbol, c.tf], out).toEqual(['NVDA', 'W'])
  }, 40000)
  it('rename a list, then add to the SAME list', async () => {
    const m = p.mount(...ONE_SPY(), { watchlists: [{ id: 'm1', name: 'Momentum', symbols: ['SPY'] }] })
    p.st.envelopes.push(b => {
      const list = Object.values(b.context || {}).flat().find(e => /Momentum/.test(String(e?.label || e?.name || '')))
      return p.env('apply', [
        { action: 'watchlist.rename', target: list.ref, args: { name: 'Leaders' } },
        { action: 'watchlist.add', target: list.ref, args: { symbols: ['AMD'] } },
      ])
    })
    let out = await m.say('could you rename Momentum to Leaders for me, and after that AMD should be in it')
    expect(p.turns(), 'the model planned it (the words ask for the rename: #1247 state rail)').toBe(1)
    if (p.proposals().length) out += await m.say('do it')
    const l = m.board.state.server.lists.find(x => x.id === 'm1')
    expect(l?.name, out).toBe('Leaders')
    expect((l?.items || []).map(i => i.sym), out).toContain('AMD')
  }, 40000)
})
