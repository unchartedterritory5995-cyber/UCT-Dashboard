import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import VoiceTelemetryPanel from './VoiceTelemetryPanel'

// Packet AD CP1 — reward-variants catalog added to VoiceTelemetryPanel.
// Mocks global.fetch and routes by URL, mirroring
// AiSearchInsightsPanel.test.jsx's convention.

const REWARD_CONTEXTS = [
  'global', 'analyst', 'risk_officer', 'coach', 'scout', 'orchestrator', 'train_me',
]

const EMPTY_OK = { ok: true, json: async () => ({}) }

function mockFetch({ variantsByContext = {}, scoreboardRows = [] } = {}) {
  const calls = []
  global.fetch = vi.fn((url) => {
    calls.push(String(url))
    const u = String(url)
    if (u.includes('/api/voice/reward/variants')) {
      const ctx = new URL(u, 'http://x').searchParams.get('context')
      const variants = variantsByContext[ctx]
      if (variants === undefined) return Promise.resolve({ ok: false, status: 404 })
      return Promise.resolve({ ok: true, json: async () => ({ context: ctx, variants }) })
    }
    if (u.includes('/api/voice/reward/scoreboard')) {
      return Promise.resolve({ ok: true, json: async () => ({ days: 30, rows: scoreboardRows }) })
    }
    if (u.includes('/api/voice/tool-call-stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ by_tool: [], recent_failures: [] }) })
    }
    if (u.includes('/api/voice/feedback/corrections')) {
      return Promise.resolve({ ok: true, json: async () => ({ corrections: [] }) })
    }
    if (u.includes('/api/voice/feedback')) {
      return Promise.resolve({ ok: true, json: async () => ({ feedback: [] }) })
    }
    if (u.includes('/api/voice/failure-patterns')) {
      return Promise.resolve({ ok: true, json: async () => ({ patterns: [] }) })
    }
    if (u.includes('/api/voice/agents/stats')) {
      return Promise.resolve({ ok: true, json: async () => ({ rows: [] }) })
    }
    if (u.includes('/api/voice/cost')) {
      return Promise.resolve({ ok: false, status: 404 })
    }
    return Promise.resolve(EMPTY_OK)
  })
  return calls
}

describe('VoiceTelemetryPanel — reward-variants catalog (Packet AD CP1)', () => {
  afterEach(() => { delete global.fetch })

  it('fetches exactly the seven registry contexts, one request per context', async () => {
    const calls = mockFetch({
      variantsByContext: {
        global: [{ id: 'v1', weight: 1, description: 'Baseline' }],
      },
    })
    render(<VoiceTelemetryPanel />)
    await waitFor(() => expect(screen.getByText('Prompt variant catalog')).toBeInTheDocument())

    const variantCalls = calls.filter((u) => u.includes('/api/voice/reward/variants'))
    expect(variantCalls).toHaveLength(7)
    const contextsRequested = variantCalls.map(
      (u) => new URL(u, 'http://x').searchParams.get('context')
    )
    // Exact set, order-independent, and no duplicate/invented context.
    expect(new Set(contextsRequested)).toEqual(new Set(REWARD_CONTEXTS))
  })

  it('renders the catalog grouped by context, with id/weight/description, and cross-references usage by variant_id', async () => {
    mockFetch({
      variantsByContext: {
        global: [
          { id: 'v1', weight: 1.0, description: 'Baseline (no modifications).' },
          { id: 'v1_concise', weight: 1.0, description: 'Tighter, more clipped replies.' },
        ],
        analyst: [{ id: 'analyst_v1', weight: 1.0, description: 'Baseline analyst.' }],
      },
      scoreboardRows: [
        { variant_id: 'v1', total_sessions: 42, thumbs_up: 10, thumbs_down: 1, score: 0.9 },
      ],
    })
    render(<VoiceTelemetryPanel />)

    await waitFor(() => expect(screen.getByText('v1_concise')).toBeInTheDocument())
    expect(screen.getByText('analyst_v1')).toBeInTheDocument()
    expect(screen.getByText('Baseline (no modifications).')).toBeInTheDocument()

    // Scope into the "global" context group to check the cross-reference —
    // "42" and "no sessions yet" also legitimately appear elsewhere on the
    // page (the existing usage scoreboard table above renders v1's 42 too).
    const globalGroup = screen.getByText('global').parentElement
    // v1 has 30-day usage (42 sessions) in the scoreboard — cross-referenced.
    expect(within(globalGroup).getByText('42')).toBeInTheDocument()
    // v1_concise has never run — rendered honestly, not as a zero.
    expect(within(globalGroup).getByText('no sessions yet')).toBeInTheDocument()

    const analystGroup = screen.getByText('analyst').parentElement
    expect(within(analystGroup).getByText('no sessions yet')).toBeInTheDocument()
  })

  it('never renders the catalog section when every context fetch fails', async () => {
    mockFetch({ variantsByContext: {} })
    render(<VoiceTelemetryPanel />)

    await waitFor(() => expect(screen.getByText(/no voice activity yet/i)).toBeInTheDocument())
    expect(screen.queryByText('Prompt variant catalog')).toBeNull()
  })
})
