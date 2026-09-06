import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ComparisonAskAi from './ComparisonAskAi'

// Shared Multi-Security Grounding Architecture V1 (owner authorization,
// Phase B). See api/services/research/comparison_ai_adapter.py -- the
// comparison page's "Ask AI" panel, single-turn only.

function mockFetchOnce(status, body) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

describe('ComparisonAskAi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows suggestion chips and an idle hint before any question is asked', () => {
    render(<ComparisonAskAi symA="NVDA" symB="AMD" />)
    expect(screen.getByText('How do their valuations compare?')).toBeInTheDocument()
    expect(screen.getByText(/does not give buy\/sell\/hold advice/)).toBeInTheDocument()
  })

  it('posts the question to the two-security explain endpoint', async () => {
    mockFetchOnce(200, {
      sym_a: 'NVDA', sym_b: 'AMD', entity_a: null, entity_b: null,
      response_state: 'answer',
      summary: 'NVDA trades at a richer multiple than AMD.',
      key_facts: [
        { statement: 'NVDA trades at 45x trailing earnings.', evidence_id: 'E1', sym: 'NVDA' },
        { statement: 'AMD trades at 30x trailing earnings.', evidence_id: 'E2', sym: 'AMD' },
      ],
      interpretation: 'This may suggest the market prices in faster growth for NVDA.',
      caveat: '', clarification_question: '',
      citations: [
        { id: 'E1', sym: 'NVDA', source: 'UCT Fundamentals', date: 'current snapshot' },
        { id: 'E2', sym: 'AMD', source: 'UCT Fundamentals', date: 'current snapshot' },
      ],
      insufficient_evidence: false, insufficient_evidence_reason: '', model: 'claude-sonnet-5', error: null,
    })
    render(<ComparisonAskAi symA="NVDA" symB="AMD" />)
    fireEvent.change(screen.getByTestId('comparison-ask-ai-input'), { target: { value: 'How do their valuations compare?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/research/compare/NVDA/AMD/explain',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ question: 'How do their valuations compare?' }),
      }),
    )
    await waitFor(() => expect(screen.getByTestId('comparison-ask-ai-answer')).toBeInTheDocument())
    expect(screen.getByText('NVDA trades at a richer multiple than AMD.')).toBeInTheDocument()
    expect(screen.getByText(/NVDA trades at 45x trailing earnings\./)).toBeInTheDocument()
    expect(screen.getByText(/AMD trades at 30x trailing earnings\./)).toBeInTheDocument()
  })

  it('clicking a suggestion chip asks that exact question immediately', async () => {
    mockFetchOnce(200, {
      sym_a: 'NVDA', sym_b: 'AMD', response_state: 'answer', summary: 'x', key_facts: [],
      interpretation: '', caveat: '', clarification_question: '', citations: [],
      insufficient_evidence: false, insufficient_evidence_reason: '', model: 'claude-sonnet-5', error: null,
    })
    render(<ComparisonAskAi symA="NVDA" symB="AMD" />)
    fireEvent.click(screen.getByText('Which one does UCT rate higher, and why?'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.question).toBe('Which one does UCT rate higher, and why?')
  })

  it('renders an honest refusal without pretending to answer', async () => {
    mockFetchOnce(200, {
      sym_a: 'NVDA', sym_b: 'AMD', response_state: 'refuse', summary: '', key_facts: [],
      interpretation: '', caveat: '', clarification_question: '', citations: [],
      insufficient_evidence: true,
      insufficient_evidence_reason: "I don't have enough verified UCT data to answer that reliably.",
      model: 'claude-sonnet-5', error: null,
    })
    render(<ComparisonAskAi symA="NVDA" symB="AMD" />)
    fireEvent.change(screen.getByTestId('comparison-ask-ai-input'), { target: { value: 'Which is the better trade?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('comparison-ask-ai-insufficient')).toBeInTheDocument())
    expect(screen.queryByTestId('comparison-ask-ai-answer')).not.toBeInTheDocument()
  })

  it('shows an error state when the request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    render(<ComparisonAskAi symA="NVDA" symB="AMD" />)
    fireEvent.change(screen.getByTestId('comparison-ask-ai-input'), { target: { value: 'compare them' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('comparison-ask-ai-error')).toBeInTheDocument())
  })

  it('the Ask button is disabled until a question is typed', () => {
    render(<ComparisonAskAi symA="NVDA" symB="AMD" />)
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    fireEvent.change(screen.getByTestId('comparison-ask-ai-input'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: 'Ask' })).not.toBeDisabled()
  })
})
