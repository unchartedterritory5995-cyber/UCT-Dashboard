// CAPABILITY REGRESSION · the GOLDEN WORKFLOWS (data/goldenWorkflows.json: previously verified successful workflows)
// and the corpus REFUSAL cases, replayed through the REAL panel. A baseline: removing or weakening one needs a
// recorded decision (docs/agent/COMPATIBILITY-DECISIONS.md; baseline.lock.json).
import { describe, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from './lib/registry'
import { corpus, golden, gapIt } from './lib/corpus'
import { replay } from './lib/run'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

describe('golden workflows', () => {
  for (const w of golden.workflows) {
    const { run, tag } = gapIt(w.gap)
    run(`${w.id} (${w.source})${tag}`, async () => { await replay(w, w.id) }, 60000)
  }
})
describe('refusals (the corpus)', () => {
  for (const r of corpus.refusals) {
    const { run, tag } = gapIt(r.gap)
    run(`${r.id}${tag}`, async () => { await replay(r, r.id) }, 40000)
  }
})
