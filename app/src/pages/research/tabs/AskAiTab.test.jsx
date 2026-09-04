import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AskAiTab from './AskAiTab'

// AI-Native Research Assistant Slice 1 (I1, owner-authorized narrow slice,
// 2026-09-04). "Explain", not "ask anything" -- see ticker_explain.py.

function mockFetchOnce(status, body) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

describe('AskAiTab', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows suggestion chips and an idle hint before any question is asked', () => {
    render(<AskAiTab sym="AAPL" />)
    expect(screen.getByText('What changed with this company recently?')).toBeInTheDocument()
    expect(screen.getByText(/does not give buy\/sell\/hold advice/)).toBeInTheDocument()
  })

  it('posts the question to the explain endpoint scoped to the current security', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: { status: 'resolved', entityId: 'e1' },
      summary: 'Analysts turned more positive on AAPL.',
      key_facts: [{ statement: 'Goldman Sachs upgraded from Hold to Buy.', evidence_id: 'E1' }],
      interpretation: 'This may suggest improving sentiment.',
      citations: [{ id: 'E1', type: 'analyst_action', date: '2026-08-30', source: 'Goldman Sachs', url: null }],
      insufficient_evidence: false, insufficient_evidence_reason: '', model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/research/explain/AAPL',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ question: 'What changed?' }),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('ask-ai-answer')).toBeInTheDocument())
    expect(screen.getByText('Analysts turned more positive on AAPL.')).toBeInTheDocument()
    expect(screen.getByText(/Goldman Sachs upgraded/)).toBeInTheDocument()
    expect(screen.getByText('This may suggest improving sentiment.')).toBeInTheDocument()
    expect(screen.getByText(/Goldman Sachs · 2026-08-30/)).toBeInTheDocument()
  })

  it('clicking a suggestion chip asks that exact question immediately', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, summary: 'x', key_facts: [], interpretation: '',
      citations: [], insufficient_evidence: false, insufficient_evidence_reason: '',
      model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="AAPL" />)
    fireEvent.click(screen.getByText('Summarize the important evidence I should investigate.'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.question).toBe('Summarize the important evidence I should investigate.')
  })

  it('renders the insufficient-evidence state honestly, not a fabricated answer', async () => {
    mockFetchOnce(200, {
      sym: 'QUIET', entity: { status: 'resolved', entityId: 'e2' }, summary: '', key_facts: [],
      interpretation: '', citations: [], insufficient_evidence: true,
      insufficient_evidence_reason: 'No recent UCT-verified news or analyst activity found for QUIET.',
      model: null, error: null,
    })
    render(<AskAiTab sym="QUIET" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-insufficient')).toBeInTheDocument())
    expect(screen.getByText(/No recent UCT-verified news/)).toBeInTheDocument()
    expect(screen.queryByTestId('ask-ai-answer')).not.toBeInTheDocument()
  })

  it('shows an entity-unresolved note without hiding the answer', async () => {
    mockFetchOnce(200, {
      sym: 'ZZZ', entity: { status: 'not_found', entityId: null }, summary: 'x', key_facts: [],
      interpretation: '', citations: [], insufficient_evidence: false, insufficient_evidence_reason: '',
      model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="ZZZ" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('entity-unresolved-note')).toBeInTheDocument())
  })

  it('shows an error state on a failed request rather than hanging silently', async () => {
    mockFetchOnce(500, {})
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-error')).toBeInTheDocument())
  })

  it('the Ask button is disabled while a question is empty or a request is in flight', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, summary: 'x', key_facts: [], interpretation: '',
      citations: [], insufficient_evidence: false, insufficient_evidence_reason: '',
      model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="AAPL" />)
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    expect(screen.getByRole('button', { name: 'Ask' })).not.toBeDisabled()
  })

  it('never renders a numeric sentiment badge (no fabricated UCT sentiment model)', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, summary: 'Neutral update.', key_facts: [], interpretation: '',
      citations: [], insufficient_evidence: false, insufficient_evidence_reason: '',
      model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-answer')).toBeInTheDocument())
    expect(screen.queryByText(/bullish|bearish/i)).not.toBeInTheDocument()
  })
})
