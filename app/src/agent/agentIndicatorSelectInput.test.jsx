// Phase 1 (Charts operator), inventory C2-025: a SELECT-type indicator input (an `enum`: moving-average type) changed through the real
// panel, and read back from the chart's stored settings: the same instance, only that input, exact Undo. No paid model call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getDefinition } from '../components/chart/engine/nativeRegistry'
import { setupPanel, ONE } from './testing/panelHarness'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

describe('a select-type input, final state', () => {
  let p, m
  const ma = () => p.instancesOn(m.board, 'c').filter(i => i.defId === 'movingAverage')
  beforeEach(async () => {
    p = setupPanel()
    m = p.mount(...ONE('QQQ'))
    await m.say('add a 20 ema')
    expect(ma()).toMatchObject([{ inputs: { period: 20, maType: 'ema' } }])
  })
  afterEach(() => { cleanup() })

  it('maType is a declared select input', () => {
    expect(getDefinition('movingAverage').inputs.find(i => i.key === 'maType').type).toBe('enum')
  })
  it('"change that to an SMA": the same instance is now an SMA, its length untouched, with no model call and no second copy', async () => {
    const [{ instanceId }] = ma()
    await m.say('change that to an sma')
    await waitFor(() => expect(ma()[0].inputs.maType).toBe('sma'))
    expect(ma()).toHaveLength(1)
    expect(ma()[0].instanceId).toBe(instanceId)
    expect(ma()[0].inputs.period).toBe(20)
    expect(p.turns()).toBe(0)
  })
  it('Undo puts the select back', async () => {
    await m.say('change that to an sma')
    await waitFor(() => expect(ma()[0].inputs.maType).toBe('sma'))
    await m.say('undo')
    await waitFor(() => expect(ma()[0].inputs.maType).toBe('ema'))
    expect(ma()[0].inputs.period).toBe(20)
  })
  it('a planned change takes any listed option (scripted model: Hull)', async () => {
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'indicator.update', target: body.context.indicatorEdits[0].ref, args: { instance: '#20', inputs: [{ key: 'maType', value: 'hma' }] } }]))
    await m.say('use a hull average for the 20 instead')
    await waitFor(() => expect(ma()[0].inputs.maType).toBe('hma'))
  })
  it('a value the select does not offer changes nothing', async () => {
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'indicator.update', target: body.context.indicatorEdits[0].ref, args: { instance: '#20', inputs: [{ key: 'maType', value: 'zigzag' }] } }]))
    await m.say('use a zigzag average for the 20 instead')
    expect(ma()).toMatchObject([{ inputs: { period: 20, maType: 'ema' } }])
  })
})
