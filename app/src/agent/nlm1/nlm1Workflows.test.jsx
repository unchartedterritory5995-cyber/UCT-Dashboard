// NLM-1 D2 + D3 — multi-step plans with references, and conversational context, replayed through the REAL panel with
// NLM-1 ON (both keys) and asserted on the FINAL WORKSPACE STATE and on Undo restoring it exactly
// (nlm1/baseline/workflows.json, the capreg golden-workflow format). No model call anywhere (modelTurns 0).
// NLM1_WF_MODE=off replays the same cases with NLM-1 OFF (the v1 baseline measurement; not a gate).
import { describe, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { replay } from '../qa/capabilityRegression/testing/run'
import { pinClock } from '../qa/capabilityRegression/testing/clock'
import data from './baseline/workflows.json'

pinClock()
vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const OFF = globalThis.process?.env?.NLM1_WF_MODE === 'off'
const only = globalThis.process?.env?.NLM1_WF_ONLY || ''

describe(`NLM-1 workflows (${OFF ? 'flag OFF — baseline' : 'flag ON'})`, () => {
  for (const w of data.workflows) {
    if (only && !w.id.startsWith(only)) continue
    it(`${w.id}`, async () => { await replay({ ...w, seed: { ...(w.seed || {}), nlm1: !OFF } }, w.id) }, 60000)
  }
})
