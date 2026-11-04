// NLM-1 · STRUCTURED STEP PLANS — the NO-MODEL SCRIPTED-PLAN HARNESS (feeds AUDIT's separate planner eval).
// Each case (nlm1/baseline/stepplans.json) scripts a CORRECT planner answer in the proposed step-reference schema; it is
// desugared onto today's executor (nlm1/stepPlan.js: a create's id = the runtime alias; "$id.chart" = that alias or the
// op's own chart; explicit targets never re-targeted) and replayed through the REAL panel as the model's answer
// (harness `faithful`), with NLM-1 ON and the in-plan key OFF (as NLM-1 would ship). Asserted: the FINAL WORKSPACE STATE,
// then grouped Undo restoring the board exactly. A plan the runtime cannot carry yet must be REPORTED as unsupported
// (`expectUnsupported`), never approximated. Unit checks of the desugaring come first.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { replay } from '../qa/capabilityRegression/testing/run'
import { pinClock } from '../qa/capabilityRegression/testing/clock'
import { desugarStepPlan } from './stepPlan'
import data from './baseline/stepplans.json'

pinClock()
vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

describe('desugarStepPlan (pure)', () => {
  it('a create\'s id becomes the runtime alias; "$id.chart" resolves to it; indicator ops on existing charts aim at the indicator entry', () => {
    const r = desugarStepPlan({ ops: [
      { id: 's1', action: 'widget.add', target: '$workspace', args: { type: 'chart' } },
      { action: 'chart.setTimeframe', target: '$s1.chart', args: { timeframe: 'W' } },
      { id: 's3', action: 'chart.setSymbol', target: '$charts[1]', args: { symbol: 'TSLA' } },
      { action: 'indicator.add', target: '$s3.chart', args: { defId: 'rsi' } },
    ] })
    expect(r.ops[0].args.as).toBe('s1')
    expect(r.ops[1].target).toBe('s1')
    expect(r.ops[3].target).toBe('$indicatorEdits[1]')
  })
  it('refuses forward references, unknown ids, duplicate ids and results the runtime does not carry', () => {
    expect(desugarStepPlan({ ops: [{ action: 'chart.setTimeframe', target: '$x.chart', args: {} }] }).unsupported[0]).toMatch(/no EARLIER step/)
    expect(desugarStepPlan({ ops: [{ id: 'a', action: 'widget.add', target: '$workspace', args: { type: 'chart' } }, { id: 'a', action: 'widget.add', target: '$workspace', args: { type: 'chart' } }] }).unsupported[0]).toMatch(/used twice/)
    expect(desugarStepPlan({ ops: [{ id: 'e', action: 'indicator.add', target: '$charts[0]', args: {} }, { action: 'indicatorStyle.set', target: '$charts[0]', args: { instance: '$e.indicator' } }] }).unsupported[0]).toMatch(/indicator result/)
  })
})

describe('scripted step plans through the real panel (final state + grouped Undo)', () => {
  for (const c of data.cases) {
    it(c.id, async () => {
      const steps = []
      for (const s of c.steps) {
        if (!s.plan) { steps.push(s); continue }
        const d = desugarStepPlan(s.plan)
        if (s.expectUnsupported) {
          expect(d.unsupported, `${c.id}: the plan is reported unsupported`).toBeTruthy()
          for (const why of s.expectUnsupported) expect(d.unsupported.join(' | ')).toContain(why)
          return
        }
        expect(d.unsupported, `${c.id}: ${(d.unsupported || []).join(' | ')}`).toBeUndefined()
        // the plan answers an OPAQUE line, so no deterministic reader can take the step before the scripted planner does
        // (the natural-language request stays in the case file, for the eval); the step must be the model's
        // (`names`: the words a real request names its target chart with — the panel never acts on an unnamed chart of a
        // multi-chart board, and that screen stays in force here)
        steps.push({ ...s, say: `«scripted plan ${c.id}»${s.names ? ` (${s.names})` : ""}`, model: { ops: d.ops }, expect: { ...s.expect, receipt: true } })
      }
      await replay({ board: c.board, steps, seed: { nlm1: true, nlm1Inplan: false } }, c.id)
    }, 60000)
  }
})
