// NLM-1 · STRUCTURED STEP PLANS — the NO-MODEL SCRIPTED-PLAN HARNESS over the PRODUCTION path (nlm1/stepPlans.js; feeds
// AUDIT's separate planner eval). Each case (nlm1/baseline/stepplans.json) scripts a CORRECT planner answer in the
// step-reference schema and replays it through the REAL panel as the model's answer to an opaque line (+ the words that
// name its target chart), with NLM-1 ON and the in-plan key OFF. Asserted: final workspace state, what the panel said
// (the read-back line, a step it did not run and why), then grouped Undo restoring the board exactly.
// Unit checks of (a) validation / preparation and (b) results-by-state come first.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { replay } from '../qa/capabilityRegression/testing/run'
import { pinClock } from '../qa/capabilityRegression/testing/clock'
import { isStepPlan, prepareStepPlan, producesOf, addedInstance } from './stepPlans'
import { indicatorEditsRef } from '../capabilities/indicatorEdits'
import data from './baseline/stepplans.json'

pinClock()
vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

describe('(a) produces + validation (pure)', () => {
  it('what each kind of op produces', () => {
    expect(producesOf({ action: 'widget.add', args: { type: 'chart' } })).toEqual({ chart: 'created' })
    expect(producesOf({ action: 'chart.setTimeframe', args: {} })).toEqual({ chart: 'target' })
    expect(producesOf({ action: 'indicator.add', args: {} })).toEqual({ chart: 'target', indicator: true })
    expect(producesOf({ action: 'alert.create', args: {} })).toEqual({})
  })
  it('a plain plan is not a step plan (v1 behaviour untouched)', () => {
    expect(isStepPlan([{ action: 'chart.setTimeframe', target: 'c1', args: { timeframe: 'W' } }])).toBe(false)
    expect(isStepPlan([{ id: 's1', action: 'chart.setTimeframe', target: 'c1', args: {} }])).toBe(true)
  })
  it('prepares: a create\'s id is the runtime alias, "$id.chart" its alias or its own chart, indicator ops on the chart\'s entry', () => {
    const p = prepareStepPlan([
      { id: 'n', action: 'widget.add', target: 'workspace', args: { type: 'chart' } },
      { action: 'chart.setSymbol', target: '$n.chart', args: { symbol: 'AMD' } },
      { action: 'indicator.add', target: '$n.chart', args: { defId: 'rsi' } },
      { id: 'x', action: 'chart.setSymbol', target: 'c1', args: { symbol: 'TSLA' } },
      { action: 'indicator.add', target: '$x.chart', args: { defId: 'macd' } },
    ])
    expect(p.error).toBeUndefined()
    expect(p.ops[0].args.as).toBe('n')
    expect(p.ops[1].target).toBe('n')
    expect(p.ops[2].target).toBe('n')
    expect(p.ops[4].target).toBe(indicatorEditsRef('c1'))
  })
  it('refuses the WHOLE plan: forward / unknown refs, duplicate ids, a field the producer lacks, a consumer of the wrong kind', () => {
    expect(prepareStepPlan([{ action: 'chart.setTimeframe', target: '$x.chart', args: {} }]).error[0]).toMatch(/no earlier step/)
    expect(prepareStepPlan([{ id: 'a', action: 'chart.setSymbol', target: 'c1', args: { symbol: 'A' } }, { id: 'a', action: 'chart.setSymbol', target: 'c1', args: { symbol: 'B' } }]).error[0]).toMatch(/used twice/)
    expect(prepareStepPlan([{ id: 't', action: 'chart.setTimeframe', target: 'c1', args: {} }, { action: 'indicatorStyle.set', target: 'ixe:c1', args: { instance: '$t.indicator' } }]).error[0]).toMatch(/adds no indicator/)
    expect(prepareStepPlan([{ id: 'n', action: 'widget.add', target: 'workspace', args: { type: 'chart' } }, { action: 'alert.create', target: '$n.chart', args: {} }]).error[0]).toMatch(/does not act on a chart/)
  })
})

describe('(b) results by state (pure)', () => {
  it('the one NEW instance that matches what the step added', () => {
    const rows = [{ instanceId: 'old', defId: 'movingAverage', inputs: { period: 21, maType: 'ema' } }, { instanceId: 'new', defId: 'movingAverage', inputs: { period: 21, maType: 'ema' } }]
    const host = { charts: { list: () => [{ ref: 'c1' }], read: () => ({ cs: { indicatorInstances: rows } }) } }
    const step = { args: { defId: 'movingAverage', inputs: [{ key: 'period', value: 21 }, { key: 'maType', value: 'ema' }] } }
    expect(addedInstance(host, step, new Map([['c1', new Set(['old'])]]))).toMatchObject({ ok: true, instanceId: 'new' })
    expect(addedInstance(host, step, new Map([['c1', new Set(['old', 'new'])]]))).toMatchObject({ ok: false, why: 'it did not take effect' })
    expect(addedInstance(host, step, new Map([['c1', new Set()]]))).toMatchObject({ ok: false, why: 'more than one indicator like it was added' })
  })
})

describe('scripted step plans through the real panel (final state, what was said, grouped Undo)', () => {
  for (const c of data.cases) {
    it(c.id, async () => {
      const steps = c.steps.map(s => (s.plan
        // an OPAQUE line (+ the words naming its target): no deterministic reader can take the step before the planner
        ? { ...s, say: `«scripted plan ${c.id}»${s.names ? ` (${s.names})` : ''}`, model: s.plan }
        : s))
      await replay({ board: c.board, steps, seed: { nlm1: true, nlm1Inplan: false } }, c.id)
    }, 60000)
  }
})
