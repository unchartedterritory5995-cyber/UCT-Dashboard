// NLM-1 D2 + D3 — multi-step plans with references, and conversational context, replayed through the REAL panel with
// NLM-1 ON (both keys) and asserted on the FINAL WORKSPACE STATE and on Undo restoring it exactly (the capreg
// golden-workflow format). No model call anywhere (modelTurns 0).
//   nlm1/baseline/workflows.json   the first set (D2 18, D3 22)
//   nlm1/baseline/workflows2.json  the GENERALISATION set (AUDIT's sealed-set categories a–f; written after them)
//   nlm1/baseline/workflows4.json  the IN-PLAN SHAPE set (AUDIT's third report: 7 shapes × ≥3 surface variants, written before D3.3)
//   nlm1/baseline/workflows3.json  the ROBUSTNESS set (AUDIT's second report: A in-plan, B cross-turn on varied boards / prior
//                                  turns, C Undo after a by-ticker add removed by "it")
// NLM1_WF_MODE=off      the same cases with NLM-1 OFF (the v1 baseline measurement; not a gate)
// NLM1_WF_MODE=planner  PLANNER-ASSISTED: each step with a `canonical` plan gets that plan as the model's answer (scripted,
//                       faithful) and its `routes` are checked against routing v2 — a pass means routing + binding +
//                       executor are right and only a deterministic reader is missing; a fail means something is WRONG
// NLM1_WF_SET=1 | 2 | 3 | 1,3 …  those sets only.
import { describe, it, vi, afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { replay } from '../qa/capabilityRegression/testing/run'
import { pinClock } from '../qa/capabilityRegression/testing/clock'
import { gapIt } from '../qa/capabilityRegression/testing/corpus'
import data from './baseline/workflows.json'
import data2 from './baseline/workflows2.json'
import data3 from './baseline/workflows3.json'
import data4 from './baseline/workflows4.json'
import { mountCase } from '../qa/capabilityRegression/testing/harness'
import { loadAgentConfig } from '../agentClient'
import { routingV2Active } from './flag'
import { inplanOn } from './inplan'

pinClock()
vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const MODE = globalThis.process?.env?.NLM1_WF_MODE || 'on'
const OFF = MODE === 'off'
const PLANNER = MODE === 'planner'
const only = globalThis.process?.env?.NLM1_WF_ONLY || ''
// the IN-PLAN key (nlm1/inplan.js, default OFF in the product): ON here unless NLM1_WF_INPLAN=0 — ON reproduces the head the
// sets were measured on (36957ddf7a); NLM1_WF_INPLAN=0 measures NLM-1 as it ships (D1 + the cross-turn mechanisms)
const INPLAN = !OFF && globalThis.process?.env?.NLM1_WF_INPLAN !== '0'

/** planner mode: the canonical plan answers the step; the model-turn bound no longer applies to that step */
const plannerSteps = (steps) => steps.map(s => (s.canonical ? { ...s, model: { ops: s.canonical.ops }, routes: s.canonical.routes, expect: { ...s.expect, modelTurns: undefined } } : s))

describe(`NLM-1 workflows (${OFF ? 'flag OFF — baseline' : PLANNER ? 'flag ON, planner-assisted' : 'flag ON'}, in-plan key ${INPLAN ? 'ON' : 'OFF'})`, () => {
  const set = globalThis.process?.env?.NLM1_WF_SET || 'all'
  const sets = { 1: data.workflows, 2: data2.workflows, 3: data3.workflows, 4: data4.workflows }
  let all = set === 'all' ? [...data.workflows, ...data2.workflows, ...data3.workflows, ...data4.workflows] : set.split(',').flatMap(k => sets[k] || [])
  // the run is what it says it is: the harness clears the browser key unless a case is seeded nlm1 — so a flag-ON run that
  // silently scored flag OFF (or the reverse) fails HERE, first
  it(`the run really is flag ${OFF ? 'OFF' : 'ON'}, in-plan key ${INPLAN ? 'ON' : 'OFF'}`, async () => {
    mountCase('ONE', { seed: { nlm1: !OFF, nlm1Inplan: INPLAN } })
    await loadAgentConfig()
    expect(routingV2Active()).toBe(!OFF)
    expect(inplanOn()).toBe(INPLAN)
  })
  if (PLANNER) all = all.filter(w => w.steps.some(s => s.canonical))
  for (const w of all) {
    if (only && !w.id.startsWith(only)) continue
    // a recorded gap must fail exactly as recorded (capreg gapIt) — with NLM-1 on; flag-off baseline runs every case plainly
    const { run, tag } = OFF || PLANNER ? { run: it, tag: '' } : gapIt(w.gap)
    const steps = PLANNER ? plannerSteps(w.steps) : w.steps
    run(`${w.id}${tag}`, async () => { await replay({ ...w, steps, seed: { ...(w.seed || {}), nlm1: !OFF, nlm1Inplan: INPLAN } }, w.id) }, 60000)
  }
})
