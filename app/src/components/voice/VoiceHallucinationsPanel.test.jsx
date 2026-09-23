import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VoiceHallucinationsPanel from './VoiceHallucinationsPanel'

// Packet AD CP2 — Hallucination Audit panel. Mocks global.fetch and routes
// by URL + method, mirroring AiSearchInsightsPanel.test.jsx's convention.

const FLAG = {
  id: 1,
  session_id: 42,
  turn_text: 'Your win rate on this setup is 87%.',
  suspect_number: 87,
  suspect_unit: '%',
  evidence: '5 tool numbers checked',
  confidence: 0.6,
  created_at: '2026-09-20T14:30:00Z',
}

const SESSION = { id: 42, started_at: '2026-09-20T14:00:00Z', page_context: 'coach' }

function mockFetch({ flags = [FLAG], sessions = [SESSION], auditResponse } = {}) {
  const postCalls = []
  global.fetch = vi.fn((url, opts) => {
    const u = String(url)
    if (opts && opts.method === 'POST' && u.includes('/api/voice/hallucinations/audit/')) {
      postCalls.push(u)
      if (auditResponse === null) return Promise.resolve({ ok: false, status: 500 })
      return Promise.resolve({
        ok: true,
        json: async () => auditResponse || { turns_examined: 4, suspect_count: 1, flagged: [] },
      })
    }
    if (u.includes('/api/voice/hallucinations')) {
      return Promise.resolve({ ok: true, json: async () => ({ flags }) })
    }
    if (u.includes('/api/voice/sessions')) {
      return Promise.resolve({ ok: true, json: async () => ({ sessions }) })
    }
    return Promise.resolve({ ok: false, status: 404 })
  })
  return postCalls
}

describe('VoiceHallucinationsPanel (Packet AD CP2)', () => {
  afterEach(() => { delete global.fetch })

  it('renders flagged claims with session, suspect number/unit, evidence and confidence', async () => {
    mockFetch()
    render(<VoiceHallucinationsPanel />)

    await waitFor(() => expect(screen.getByText(/Session #42/)).toBeInTheDocument())
    expect(screen.getByText(/Your win rate on this setup is 87%/)).toBeInTheDocument()
    expect(screen.getByText('87')).toBeInTheDocument()
    expect(screen.getByText('5 tool numbers checked')).toBeInTheDocument()
    // confidence 0.6 -> 60%
    expect(screen.getByText(/confidence 60%/)).toBeInTheDocument()
  })

  it('shows the exact empty-state copy when there are no flags', async () => {
    mockFetch({ flags: [] })
    render(<VoiceHallucinationsPanel />)

    await waitFor(() => expect(
      screen.getByText("No flagged claims — Compass hasn't said anything that didn't match its own tool data.")
    ).toBeInTheDocument())
  })

  it('populates the session dropdown and fires a POST re-audit for the selected session, then refreshes the flag list', async () => {
    const postCalls = mockFetch({
      auditResponse: { turns_examined: 6, suspect_count: 2, flagged: [] },
    })
    const user = userEvent.setup()
    render(<VoiceHallucinationsPanel />)

    await waitFor(() => expect(screen.getByLabelText(/session to re-audit/i)).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText(/session to re-audit/i), '42')
    await user.click(screen.getByRole('button', { name: /re-audit now/i }))

    await waitFor(() => expect(postCalls).toEqual(['/api/voice/hallucinations/audit/42']))
    expect(await screen.findByText(/Examined 6 turns, flagged 2\./)).toBeInTheDocument()
  })

  it('the re-audit button stays disabled until a session is chosen', async () => {
    mockFetch()
    render(<VoiceHallucinationsPanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: /re-audit now/i })).toBeDisabled())
  })
})
