// NLM-1 · STEP RESULTS ON PLANNER v2 (owner 11-05: structured multi-step work goes on the v2 tool-calling path).
// No model, no paid call: the scripted STEP-1 server (testing/stepServer.js) plays the planner's tool calls through the
// REAL panel (steps.js createStepRunner → the ordinary executor). A step whose instance is an indicator an EARLIER step
// added names it by the short ref that step reported in "New refs" (ind1, …), found by state after the step ran; a ref no
// step reported is refused, said; a turn of several changes is read back from the board; the turn is ONE Undo group.
// Planner v2 stays OFF in production — only this file's scripted config says 'v2'.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, waitFor, screen } from '@testing-library/react'
import { registerCatalog } from './qa/capabilityRegression/testing/registry'
import { pinClock } from './qa/capabilityRegression/testing/clock'
import { mountCase, chartsOf, boardState } from './qa/capabilityRegression/testing/harness'
import { _resetAgentConfig, loadAgentConfig } from './agentClient'
import { bindInstanceRef } from './steps'

pinClock()
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const MA21 = { defId: 'movingAverage', inputs: [{ key: 'period', value: 21 }, { key: 'maType', value: 'ema' }] }
const addedOf = (c, i, kind) => (c.results[i]?.added || []).find(a => a.kind === kind)?.ref
const ctxRef = (c, section, i = 0) => (c.body.context[section] || [])[i]?.ref

// `words`: what the member typed for the scripted plan. ⛔ AUDIT #1247: a plan that CHANGES an existing indicator needs the
// member's own words for it (the state rail) — a test of that plan says them; the placeholder stays for every other plan
async function v2(board, script, { nlm1 = true, words = '«scripted v2 turn»' } = {}) {
  const m = mountCase(board, { seed: { nlm1 }, stepScript: script })
  _resetAgentConfig()
  await loadAgentConfig()
  const start = boardState(m.board)
  await m.say(words)
  await waitFor(() => { if (screen.queryByTestId('agent-typing') || m.srv.stream) throw new Error('busy') }, { timeout: 15000 })
  return { m, start, said: () => String(m.p.transcript()) }
}
const chartOf = (m, sym) => chartsOf(m.board).find(w => m.h.charts.read(w.id)?.symbol === sym)
const briefOf = (m, sym) => { const w = chartOf(m, sym); return w ? m.p.brief(m.board, w.id) : null }
const rowsOf = (m, sym) => { const w = chartOf(m, sym); return (m.h.charts.read(w.id)?.cs?.indicatorInstances || []) }

describe('planner v2: an indicator a step added is a result the next step can name', () => {
  it('unit: an ind ref binds to the instance its step reported; one no step reported is refused', () => {
    const refMap = { ind1: { kind: 'indicatorInstance', ref: 'inst:abc', chart: 'w1' }, c1: { kind: 'chart', ref: 'w1' }, c2: { kind: 'chart', ref: 'w2' } }
    expect(bindInstanceRef({ action: 'indicatorStyle.set', target: 'c1', args: { instance: 'ind1' } }, refMap).op.args.instance).toBe('inst:abc')
    // the ref is (chart, instance): on another chart it is refused; with no target it is bound to its own chart
    expect(bindInstanceRef({ action: 'indicatorStyle.set', target: 'c2', args: { instance: 'ind1' } }, refMap).refusal).toMatch(/not on this step's target/)
    expect(bindInstanceRef({ action: 'indicatorStyle.set', target: null, args: { instance: 'ind1' } }, refMap).op.target).toMatch(/w1/)
    expect(bindInstanceRef({ action: 'indicatorStyle.set', args: { instance: 'ind2' } }, refMap).refusal).toMatch(/not an indicator an earlier step of this turn added/)
    expect(bindInstanceRef({ action: 'indicatorStyle.set', args: { instance: 'c1' } }, refMap).op.args.instance).toBe('c1')   // not an ind ref: as before
    expect(bindInstanceRef({ action: 'indicatorStyle.set', args: { instance: '#21:ema' } }, refMap).op.args.instance).toBe('#21:ema')
  })

  it('the 5-step AMD request: a new chart, weekly, the 21 EMA and RSI, then the EMA orange — read back, ONE Undo', async () => {
    const script = [
      (c) => ({ action: 'widget.add', target: ctxRef(c, 'workspace'), args: { type: 'chart', as: 'new1' } }),
      (c) => ({ action: 'chart.setSymbol', target: addedOf(c, 0, 'chart'), args: { symbol: 'AMD' } }),
      (c) => ({ action: 'chart.setTimeframe', target: addedOf(c, 0, 'chart'), args: { timeframe: 'W' } }),
      (c) => ({ action: 'indicator.add', target: addedOf(c, 0, 'indicatorEdits'), args: MA21 }),
      (c) => ({ action: 'indicator.add', target: addedOf(c, 0, 'indicatorEdits'), args: { defId: 'rsi', inputs: null } }),
      (c) => ({ action: 'indicatorStyle.set', target: addedOf(c, 0, 'indicatorEdits'), args: { instance: addedOf(c, 3, 'indicatorInstance'), property: 'color', value: 'orange', output: null } }),
      { reply: '' },
    ]
    const { m, start, said } = await v2('HALF', script, { words: 'open a chart for AMD on the weekly with the 21 EMA and RSI, and make the EMA orange' })
    // the EMA step reported its instance; the style step named it and ran
    expect(addedOf({ results: m.srv.results }, 3, 'indicatorInstance')).toBe('ind1')
    expect(m.srv.results.map(r => r.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
    expect(m.h.charts.read(chartOf(m, 'AMD').id)?.tf).toBe('W')
    expect(briefOf(m, 'AMD')).toEqual(expect.arrayContaining(['movingAverage(21 ema)', 'rsi(14)']))
    // a new chart carries default moving-average overlays: the EMA the step added is the 21 EMA
    const ema = rowsOf(m, 'AMD').find(r => r.defId === 'movingAverage' && String(r.inputs?.period) === '21' && r.inputs?.maType === 'ema')
    expect(JSON.stringify(ema)).toMatch(/orange|#f[0-9a-f]{2}|#ff/i)
    expect(briefOf(m, 'NVDA')).toEqual([])                       // the existing chart is never touched
    expect(said()).toMatch(/Checked on your board: all 4 checked steps that ran here are in place/)
    // ONE Undo takes the whole turn back
    await m.say('undo all of that')
    await m.p.idle()
    await waitFor(() => expect(boardState(m.board)).toBe(start), { timeout: 6000 })
  }, 60000)

  it('indicator then style on an existing chart: the style lands on the instance the step added, never a guess', async () => {
    const script = [
      (c) => ({ action: 'indicator.add', target: ctxRef(c, 'indicatorEdits'), args: MA21 }),
      (c) => ({ action: 'indicatorStyle.set', target: ctxRef(c, 'indicatorEdits'), args: { instance: addedOf(c, 0, 'indicatorInstance'), property: 'color', value: 'orange', output: null } }),
      { reply: '' },
    ]
    const { m } = await v2('ONE', script, { words: 'add a 21 EMA to this chart, then make the EMA orange' })
    expect(m.srv.results.map(r => r.status)).toEqual(['done', 'done'])
    const ema = rowsOf(m, 'NVDA').find(r => r.defId === 'movingAverage')
    expect(JSON.stringify(ema)).toMatch(/orange|#f[0-9a-f]{2}|#ff/i)
  }, 60000)

  it('a refused step mid-plan: what reached the board is read back, and a later step naming its result is refused, said', async () => {
    const script = [
      (c) => ({ action: 'chart.setTimeframe', target: ctxRef(c, 'charts'), args: { timeframe: 'W' } }),
      (c) => ({ action: 'indicator.add', target: ctxRef(c, 'indicatorEdits'), args: { defId: 'zigzagDoesNotExist', inputs: null } }),
      (c) => ({ action: 'indicatorStyle.set', target: ctxRef(c, 'indicatorEdits'), args: { instance: 'ind1', property: 'color', value: 'orange', output: null } }),
      { reply: '' },
    ]
    const { m, said } = await v2('ONE', script)
    const st = m.srv.results.map(r => r.status)
    expect(st[0]).toBe('done')
    expect(st[1]).not.toBe('done')                               // the executor refused the unknown indicator
    expect(st[2]).toBe('refused')                                // "ind1" was never reported: refused, never guessed
    expect(m.srv.results[2].refusal).toMatch(/not an indicator an earlier step of this turn added/)
    expect(m.h.charts.read(chartsOf(m.board)[0].id)?.tf).toBe('W')
    // review nit (a): the refused step never ran — it is not read back as "not in place" (its refusal was said)
    expect(said()).toMatch(/Checked on your board: all 1 checked steps that ran here are in place/)
    expect(said()).not.toMatch(/Not in place: step 2/)
  }, 60000)

  // ⛔ review BLOCKER: instance ids are per CHART (inst:<defId>:<n>), so two charts share them — a ref is (chart, instance)
  const ieOf = (c, sym) => (c.body.context.indicatorEdits || []).find(e => e.symbol === sym)?.ref
  const SMA50 = { defId: 'movingAverage', inputs: [{ key: 'period', value: 50 }, { key: 'maType', value: 'sma' }] }
  const ORANGE = '#f59e0b'                                   // the colour family 'orange' resolves to
  const styled = (r) => String(r?.inputs?.color || '').toLowerCase() === ORANGE
  it('review repro: ind1 (NVDA\'s EMA) aimed at AMD, whose SMA shares its id → refused; neither indicator changes', async () => {
    const script = [
      (c) => ({ action: 'indicator.add', target: ieOf(c, 'NVDA'), args: MA21 }),
      (c) => ({ action: 'indicator.add', target: ieOf(c, 'AMD'), args: SMA50 }),
      (c) => ({ action: 'indicatorStyle.set', target: ieOf(c, 'AMD'), args: { instance: addedOf(c, 0, 'indicatorInstance'), property: 'color', value: 'orange', output: null } }),
      { reply: '' },
    ]
    const { m, said } = await v2('TWO', script)
    expect(m.srv.results.map(r => r.status)).toEqual(['done', 'done', 'refused'])
    expect(m.srv.results[2].refusal).toMatch(/not on this step's target/)
    const ema = rowsOf(m, 'NVDA').find(r => r.defId === 'movingAverage')
    const sma = rowsOf(m, 'AMD').find(r => r.defId === 'movingAverage')
    expect(ema.instanceId).toBe(sma.instanceId)                  // the premise: the two charts DO share the id
    expect(styled(sma)).toBe(false)                              // the wrong-target write is gone
    expect(styled(ema)).toBe(false)
    expect(said()).toMatch(/all 2 checked steps that ran here are in place/)
  }, 60000)

  it('same-chart control: ind1 aimed at its own chart (NVDA) styles NVDA\'s EMA, never AMD\'s SMA', async () => {
    const script = [
      (c) => ({ action: 'indicator.add', target: ieOf(c, 'NVDA'), args: MA21 }),
      (c) => ({ action: 'indicator.add', target: ieOf(c, 'AMD'), args: SMA50 }),
      (c) => ({ action: 'indicatorStyle.set', target: ieOf(c, 'NVDA'), args: { instance: addedOf(c, 0, 'indicatorInstance'), property: 'color', value: 'orange', output: null } }),
      { reply: '' },
    ]
    const { m } = await v2('TWO', script, { words: 'add a 21 EMA on NVDA and a 50 SMA on AMD, then make the NVDA EMA orange' })
    expect(addedOf({ results: m.srv.results }, 1, 'indicatorInstance')).toBe('ind2')   // AMD's SMA: its own ref (chart + id)
    expect(styled(rowsOf(m, 'NVDA').find(r => r.defId === 'movingAverage'))).toBe(true)
    expect(styled(rowsOf(m, 'AMD').find(r => r.defId === 'movingAverage'))).toBe(false)
  }, 60000)

  it('review nit (b): the same indicator added in two steps (two charts, or one chart twice) reads back as in place', async () => {
    const two = await v2('TWO', [
      (c) => ({ action: 'indicator.add', target: ieOf(c, 'NVDA'), args: { defId: 'rsi', inputs: null } }),
      (c) => ({ action: 'indicator.add', target: ieOf(c, 'AMD'), args: { defId: 'rsi', inputs: null } }),
      { reply: '' },
    ])
    expect(two.said()).toMatch(/all 2 checked steps that ran here are in place/)
    cleanup()
    const one = await v2('ONE', [
      (c) => ({ action: 'indicator.add', target: ctxRef(c, 'indicatorEdits'), args: { defId: 'rsi', inputs: null } }),
      (c) => ({ action: 'indicator.add', target: ctxRef(c, 'indicatorEdits'), args: { defId: 'rsi', inputs: null } }),
      { reply: '' },
    ])
    if (one.m.srv.results.every(r => r.status === 'done')) expect(one.said()).toMatch(/all 2 checked steps that ran here are in place/)
    expect(one.said()).not.toMatch(/more than one indicator like it|Not in place/)
  }, 60000)

  // ⛔ review 2 (72fdec3b2d): an add that added NOTHING inside an otherwise-successful group, on a chart that already has an
  // EMA 21, read back as "in place" (the group's status + presence). Each step is now judged by its OWN result and by the
  // instance IT added; presence counts only for a step whose own result was an explicit "already there" no-op.
  const ema21Count = (m) => rowsOf(m, 'NVDA').filter(r => !r.deleted && r.defId === 'movingAverage' && String(r.inputs?.period) === '21' && r.inputs?.maType === 'ema').length
  it('review probe: an add that added nothing, in a group, on a chart that already had an EMA 21 → never read back as in place', async () => {
    const { m, said } = await v2('ONE', [
      (c) => ({ action: 'indicator.add', target: ctxRef(c, 'indicatorEdits'), args: MA21 }),
      (c) => ({ group: [
        { action: 'chart.setTimeframe', target: ctxRef(c, 'charts'), args: { timeframe: 'W' } },
        { action: 'indicator.add', target: ctxRef(c, 'indicatorEdits'), args: MA21 },
      ] }),
      { reply: '' },
    ])
    // the premise: the group's second EMA 21 added nothing (its own result: not run), the chart keeps ONE EMA 21
    expect(ema21Count(m)).toBe(1)
    expect(m.srv.results.map(r => r.status)).toEqual(['done', 'done', 'refused'])
    expect(said()).not.toMatch(/all 3 checked steps/)            // the false success receipt is gone
    expect(said()).not.toMatch(/step 3 .*in place|Already there before, so nothing was added: step 3/)
    expect(said()).toMatch(/all 2 checked steps that ran here are in place/)
  }, 60000)

  it('an explicit no-op step on its own (the indicator already there) is read back as already there, never as added', async () => {
    const { said } = await v2('ONE', [
      (c) => ({ action: 'indicator.add', target: ctxRef(c, 'indicatorEdits'), args: { defId: 'rsi', inputs: null } }),
      (c) => ({ action: 'indicator.add', target: ctxRef(c, 'indicatorEdits'), args: { defId: 'rsi', inputs: null } }),
      { reply: '' },
    ])
    expect(said()).toMatch(/already on Chart \(NVDA\)/i)           // the step's own result: nothing to add
    expect(said()).toMatch(/Already there before, so nothing was added: step 2/)
  }, 60000)

  it('kill switch: the v2 runner is exactly as before — no ind refs, no read-back', async () => {
    const script = [
      (c) => ({ action: 'indicator.add', target: ctxRef(c, 'indicatorEdits'), args: MA21 }),
      (c) => ({ action: 'chart.setTimeframe', target: ctxRef(c, 'charts'), args: { timeframe: 'W' } }),
      { reply: '' },
    ]
    const { m, said } = await v2('ONE', script, { nlm1: false })
    expect(m.srv.results.map(r => r.status)).toEqual(['done', 'done'])
    expect(JSON.stringify(m.srv.results)).not.toMatch(/indicatorInstance|"ind\d/)
    expect(said()).not.toMatch(/Checked on your board/)
  }, 60000)
})
