// ROOT CAUSE · BUG B (owner live test, production ebde0bd402): "Exit Replay Mode. On my SPY chart, change the 20 EMA to a 50 EMA
// and make its line blue. Leave my other indicators alone." → replay exited, EMA 20→50, then "the indicator was no longer on
// SPY"; the 50 EMA stays, NOT blue. Through the REAL panel (panelHarness) on the REAL board writer; the model plan scripted in
// the shapes a model writes (the instance by its context id, or by its length "#20:ema" — both documented in the hints).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// one SPY chart with the product's default indicators (EMA 9, EMA 20, SMA 50, SMA 200)
const ONE_SPY = () => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }], { 'N:c': 'SPY' }]
// (the replay exit is left out: it ran correctly live, and the fixture board has no replay on)
const ASK = 'On my SPY chart, change the 20 EMA to a 50 EMA and make its line blue. Leave my other indicators alone.'
const ixeOf = (b) => b.context.indicatorEdits[0].ref
const ema20Of = (b) => {
  // the chart's indicators list (context.indicators[].indicators: {name, id}) — the id the hints tell the model to use
  return b.context.indicators[0].indicators.find(i => i.name === 'EMA 20').id
}
const plan = (instanceOf) => (b) => {
  if (process.env.DUMP) console.log('CTX>>', Object.keys(b.context).join(','), JSON.stringify(Object.fromEntries(Object.entries(b.context).filter(([k]) => /indic/i.test(k)))).slice(0,1500))
  const inst = instanceOf(b)
  return p.env('apply', [
    { action: 'indicator.update', target: ixeOf(b), args: { instance: inst, inputs: [{ key: 'period', value: 50 }] } },
    { action: 'indicatorStyle.set', target: ixeOf(b), args: { instance: inst, property: 'color', value: 'blue', output: null } },
  ])
}
const emas = (m) => p.instancesOn(m.board, 'c').filter(i => i.defId === 'movingAverage').map(i => ({ id: i.instanceId, period: i.inputs?.period, type: i.inputs?.maType, color: i.inputs?.color }))

describe('BUG B · edit an indicator, then edit the SAME indicator in the next step', () => {
  it.each([['its context id', ema20Of], ['its length "#20:ema"', () => '#20:ema']])('the model names the EMA by %s → it ends a BLUE 50 EMA, one receipt chain, no "no longer there"', async (_how, instanceOf) => {
    const m = p.mount(...ONE_SPY())
    p.st.envelopes.push(plan(instanceOf))
    const out = await m.say(ASK)
    if (process.env.DUMP) console.log('OUT>>', out, JSON.stringify(emas(m)))
    const after = emas(m)
    expect(after.filter(e => e.period === 50 && e.type === 'ema'), out).toHaveLength(1)
    expect(after.some(e => e.period === 20 && e.type === 'ema'), out).toBe(false)
    expect(after.find(e => e.period === 50 && e.type === 'ema').color, out).toBe('#2962ff')        // normalizeColor('blue')
    expect(out).not.toMatch(/no longer|isn['’]t there any more|No indicator on/i)
  }, 40000)
})
