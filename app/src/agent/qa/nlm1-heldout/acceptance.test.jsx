// NLM-1 ACCEPTANCE — in-plan references and cross-turn context (acceptance.json), through the REAL panel with the capreg
// harness (fixture boards, state predicates, grouped Undo). PENDING: runs only with NLM1_ACCEPT=1 — never in master CI
// until NLM-1 lands (agent/qa/nlm1-heldout is not merged). No model plan is scripted: what is measured is NLM-1's own
// reading of references and context.
//   NLM1_ACCEPT=1 npx vitest run src/agent/qa/nlm1-heldout/acceptance.test.jsx
import { describe, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from '../capabilityRegression/testing/registry'
import { replay } from '../capabilityRegression/testing/run'
import { pinClock } from '../capabilityRegression/testing/clock'
import acceptance from './acceptance.json'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const ENABLED = globalThis.process?.env?.NLM1_ACCEPT === '1'
pinClock()
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

describe.skipIf(!ENABLED)('NLM-1 acceptance (pending until NLM-1 lands)', () => {
  for (const [set, cases] of [['in-plan references', acceptance.inPlan], ['cross-turn context', acceptance.crossTurn]]) {
    describe(set, () => {
      for (const c of cases) it(`${c.id}: ${c.steps.map(s => s.say).join(' → ')}`, async () => { await replay(c, c.id) }, 60000)
    })
  }
})
