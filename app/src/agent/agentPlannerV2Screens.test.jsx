// ── dark train #786: planner v2 runs v1's plan SCREENS on every step (v1 parity) ──────────────────────────────────
//
// v1 screens every model plan against the member's own words before anything runs (useAgent model path):
// scopeChartOps (#771: which chart a chart-scoped indicator alert is for) and screenModelOps (authoring rules: an
// explicit "create a custom indicator …" is built, saved and added; a new draft with no chart on a board of several
// asks which chart). v2 steps now go through the same screens (steps.js runGroup). The corpus parity rail covers the two
// owner cases (indicatorAlert.ma-cross-multichart, indicator.draft-create); this pins the ASK path, which has no corpus
// case: the question reaches the member, the step is refused, nothing is built.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { waitFor, screen, cleanup } from '@testing-library/react'
import { registerCatalog } from './qa/capabilityRegression/testing/registry'
import { mountCase, resolveTarget } from './qa/capabilityRegression/testing/harness'
import { _resetAgentConfig, loadAgentConfig } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

describe('v2 runs v1 plan screens', () => {
  it('a NEW indicator draft with no chart on a board of several: the member is asked which chart; the step is refused', async () => {
    const draft = (c) => ({ action: 'indicator.draft', target: resolveTarget('$indicatorDrafts{new}', c.body),
      args: { message: 'Create a custom indicator: the 9 ema minus the 20 ema as a percentage, in its own pane.', chart: null, edit: null }, mode: 'apply' })
    const m = mountCase('AUTHOR_TWO', { stepScript: [draft, { reply: '' }] })
    _resetAgentConfig()
    await loadAgentConfig()
    await m.say('Create a custom indicator: the 9 ema minus the 20 ema as a percentage, in its own pane.')
    await waitFor(() => { if (screen.queryByTestId('agent-typing') || m.srv.stream) throw new Error('busy') }, { timeout: 15000 })
    expect(m.srv.results.map(r => r.status)).toEqual(['refused'])
    expect(m.srv.results[0].refusal).toMatch(/^UCT asked the member first: Which chart is this indicator for/)
    expect(m.p.transcript()).toMatch(/Which chart is this indicator for\?/)
  }, 30000)
})
