// The defects of the first REAL-MODEL production verification (2026-11-05), each as a slice through the REAL panel with a
// scripted model: what these prove is that a plan runs and is receipted truthfully. Whether a real model picks that plan is
// the next real-model run's question, not this file's.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, ONE, TWO } from './testing/panelHarness'

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
