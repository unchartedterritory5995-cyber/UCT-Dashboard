import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

  // ── TERM-050 (FB-I1-01): the Sources block composes S8's <Provenance> ────
  // This door used to draw its own citation list through three local classes
  // (the same defect AskAiTab carried until GATE-I1 slice 2). The boundary rail
  // (`pages/research/i1S8Boundary.test.js`) proves no local renderer is left;
  // these prove the S8 one is actually SHOWN, one per citation, with the
  // footnote ids intact — a component imported is not a component rendered.
  const THREE_SOURCE_PAYLOAD = {
    sym_a: 'NVDA', sym_b: 'AMD', entity_a: null, entity_b: null,
    response_state: 'answer',
    summary: 'NVDA trades at a richer multiple than AMD.',
    key_facts: [
      { statement: 'NVDA trades at 45x trailing earnings.', evidence_id: 'E1', sym: 'NVDA' },
      { statement: 'AMD trades at 30x trailing earnings.', evidence_id: 'E2', sym: 'AMD' },
      { statement: 'UCT rates NVDA 91.', evidence_id: 'E4', sym: 'NVDA' },
    ],
    interpretation: '', caveat: '', clarification_question: '',
    citations: [
      { id: 'E1', sym: 'NVDA', source: 'UCT Fundamentals', date: 'current snapshot' },
      { id: 'E2', sym: 'AMD', source: 'UCT Fundamentals', date: 'current snapshot' },
      { id: 'E4', sym: 'NVDA', source: 'UCT Composite Rating', date: '2026-09-25' },
    ],
    insufficient_evidence: false, insufficient_evidence_reason: '', model: 'claude-sonnet-5', error: null,
  }

  async function askAndSettle(payload) {
    mockFetchOnce(200, payload)
    render(<ComparisonAskAi symA="NVDA" symB="AMD" />)
    fireEvent.change(screen.getByTestId('comparison-ask-ai-input'), { target: { value: 'compare them' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('comparison-ask-ai-answer')).toBeInTheDocument())
  }

  it('renders one source row per citation, ids 1:1 with the payload, in order', async () => {
    await askAndSettle(THREE_SOURCE_PAYLOAD)
    const rows = screen.getAllByTestId('comparison-ask-ai-source')
    expect(rows).toHaveLength(THREE_SOURCE_PAYLOAD.citations.length)
    // The SET in payload order, not just a count: a count survives one
    // citation dropped and another rendered twice.
    expect(rows.map(r => r.getAttribute('data-evidence-id')))
      .toEqual(THREE_SOURCE_PAYLOAD.citations.map(c => c.id))
    expect(rows.map(r => within(r).getByText(/^\[E\d+\]$/).textContent))
      .toEqual(THREE_SOURCE_PAYLOAD.citations.map(c => `[${c.id}]`))
  })

  it('each source row is S8 <Provenance> in its present state, with sym · source · date visible', async () => {
    await askAndSettle(THREE_SOURCE_PAYLOAD)
    const rows = screen.getAllByTestId('comparison-ask-ai-source')
    expect(screen.getAllByTestId('provenance-present'))
      .toHaveLength(THREE_SOURCE_PAYLOAD.citations.length)
    for (const r of rows) expect(within(r).getByTestId('provenance-present')).toBeInTheDocument()
    // What a member reads at a glance is unchanged: which security, which
    // source, which date.
    expect(within(rows[1]).getByText('AMD · UCT Fundamentals · current snapshot')).toBeInTheDocument()
    expect(within(rows[2]).getByText('NVDA · UCT Composite Rating · 2026-09-25')).toBeInTheDocument()
  })

  it('the detail disclosure names the source and never invents an observed time', async () => {
    // `date` is often a LABEL ("current snapshot"), so it is never passed to
    // <Provenance> as a timestamp — formatTimeEt would render a date-only
    // string as a confident, wrong ET wall-clock time.
    await askAndSettle(THREE_SOURCE_PAYLOAD)
    const row = screen.getAllByTestId('comparison-ask-ai-source')[2]
    fireEvent.click(within(row).getByTestId('provenance-detail-toggle'))
    const panel = within(row).getByTestId('provenance-detail-panel')
    expect(panel).toHaveTextContent('Source: UCT Composite Rating')
    expect(panel).not.toHaveTextContent(/Observed:/)
  })

  it('is a real control — zero citations renders no Sources block at all', async () => {
    await askAndSettle({ ...THREE_SOURCE_PAYLOAD, citations: [] })
    expect(screen.queryAllByTestId('comparison-ask-ai-source')).toHaveLength(0)
    expect(screen.queryByTestId('comparison-ask-ai-sources')).not.toBeInTheDocument()
    expect(screen.queryByText('Sources')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('provenance-present')).toHaveLength(0)
  })

  it('the Ask button is disabled until a question is typed', () => {
    render(<ComparisonAskAi symA="NVDA" symB="AMD" />)
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    fireEvent.change(screen.getByTestId('comparison-ask-ai-input'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: 'Ask' })).not.toBeDisabled()
  })
})
