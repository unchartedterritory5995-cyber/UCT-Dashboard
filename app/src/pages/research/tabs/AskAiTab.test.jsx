import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

// Each call in `bodies` order returns the next {status, body} pair -- for
// multi-turn tests where turn 2's request/response differs from turn 1's.
function mockFetchSequence(bodies) {
  const impl = vi.fn()
  bodies.forEach(({ status, body }) => {
    impl.mockImplementationOnce(() => Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }))
  })
  global.fetch = impl
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
        body: JSON.stringify({ question: 'What changed?', history: [] }),
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

  // ── GATE-I1 slice 2: the Sources block composes S8's <Provenance> ────────
  //
  // ⛔ THE MANDATORY GATE CONDITION. The Sources block was rebuilt on S8's
  // primitive; the one thing that rebuild could silently break is the [E#]
  // mapping — a citation dropped or duplicated on the way through the new
  // markup. `ticker_explain.py::_result` emits `citations` as exactly the
  // evidence items whose ids `key_facts` cite, so the rendered count is a
  // 1:1 assertion against the payload, not an eyeball.

  const EIGHT_SOURCE_PAYLOAD = {
    sym: 'AAPL', entity: null, response_state: 'answer',
    summary: 'Several things moved at once.',
    key_facts: [
      { statement: 'Goldman Sachs upgraded from Hold to Buy.', evidence_id: 'E1' },
      { statement: 'Q2 2026 revenue was $94.5B.', evidence_id: 'E4' },
    ],
    interpretation: '', caveat: '', clarification_question: '',
    citations: [
      { id: 'E1', type: 'analyst_action', date: '2026-08-30', source: 'Goldman Sachs', url: null },
      { id: 'E2', type: 'news', date: '2026-08-29', source: 'Reuters', url: 'https://example.com/a' },
      // Two items from the SAME source on the same day — a de-dupe that
      // collapsed rows by source would lose one and still look plausible.
      { id: 'E3', type: 'news', date: '2026-08-29', source: 'Reuters', url: 'https://example.com/b' },
      { id: 'E4', type: 'financials_quarter', date: 'Q2 2026 (calendar-quarter label -- may not match fiscal)', source: 'UCT Financials (yfinance)', url: null },
      { id: 'E5', type: 'ratings_summary', date: 'current snapshot', source: 'FMP, via UCT Analyst Ratings', url: null },
      { id: 'E6', type: 'ownership', date: 'current snapshot', source: 'UCT Ownership (yfinance)', url: null },
      { id: 'E7', type: 'insider', date: '2026-07-14', source: 'SEC Form 4, via UCT Ownership', url: null },
      { id: 'E8', type: 'estimates', date: 'FY2027 (relative label, no absolute anchoring date)', source: 'UCT Estimates (yfinance)', url: null },
    ],
    insufficient_evidence: false, insufficient_evidence_reason: '',
    model: 'claude-sonnet-5', error: null,
  }

  async function askAndSettle(payload, sym = 'AAPL') {
    mockFetchOnce(200, payload)
    render(<AskAiTab sym={sym} />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-answer')).toBeInTheDocument())
  }

  it('renders exactly one source row per payload citation, with every evidence id once', async () => {
    await askAndSettle(EIGHT_SOURCE_PAYLOAD)

    const rows = screen.getAllByTestId('ask-ai-source')
    expect(rows).toHaveLength(EIGHT_SOURCE_PAYLOAD.citations.length)

    // Not just the count — the SET, in payload order. A count alone survives
    // one citation dropped and another rendered twice.
    expect(rows.map(r => r.getAttribute('data-evidence-id')))
      .toEqual(EIGHT_SOURCE_PAYLOAD.citations.map(c => c.id))

    // And the visible [E#] marks are the same ids, so the footnote a member
    // reads still points at the fact that cites it.
    expect(rows.map(r => within(r).getByText(/^\[E\d+\]$/).textContent))
      .toEqual(EIGHT_SOURCE_PAYLOAD.citations.map(c => `[${c.id}]`))
  })

  it('is a real control — zero citations renders zero source rows, not an empty Sources heading', async () => {
    // Non-vacuity for the assertion above: if `ask-ai-source` were never
    // rendered at all, a length check against a payload that also had none
    // would pass over nothing.
    await askAndSettle({ ...EIGHT_SOURCE_PAYLOAD, citations: [] })
    expect(screen.queryAllByTestId('ask-ai-source')).toHaveLength(0)
    expect(screen.queryByTestId('ask-ai-sources')).not.toBeInTheDocument()
    expect(screen.queryByText('Sources')).not.toBeInTheDocument()
  })

  it('each source row shows source · date through S8 <Provenance>, and keeps its link', async () => {
    await askAndSettle(EIGHT_SOURCE_PAYLOAD)
    const rows = screen.getAllByTestId('ask-ai-source')

    // The S8 affordance, not a locally-drawn one: every row is a
    // <Provenance> in its present state with a real detail disclosure.
    expect(screen.getAllByTestId('provenance-present'))
      .toHaveLength(EIGHT_SOURCE_PAYLOAD.citations.length)

    // Source and date stay VISIBLE — the affordance changed, what a member
    // can read at a glance did not.
    expect(within(rows[0]).getByText('Goldman Sachs · 2026-08-30')).toBeInTheDocument()

    // The link survives where the payload has one, and is not invented where
    // it does not.
    const link = within(rows[1]).getByRole('link', { name: 'source' })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(rows[0]).queryByRole('link')).not.toBeInTheDocument()
  })

  it('the source detail disclosure opens and names the source', async () => {
    await askAndSettle(EIGHT_SOURCE_PAYLOAD)
    const row = screen.getAllByTestId('ask-ai-source')[0]
    fireEvent.click(within(row).getByTestId('provenance-detail-toggle'))
    expect(within(row).getByTestId('provenance-detail-panel'))
      .toHaveTextContent('Source: Goldman Sachs')
  })

  it('never turns a label-shaped evidence date into a confident wall-clock time', async () => {
    // `date` is frequently a LABEL, not an instant ("current snapshot",
    // "Q2 2026 (...)"). It is deliberately not passed to <Provenance> as a
    // `timestamp`, because formatEtTime would render a date-only string as a
    // precise ET time that is simply wrong.
    await askAndSettle(EIGHT_SOURCE_PAYLOAD)
    const rows = screen.getAllByTestId('ask-ai-source')
    fireEvent.click(within(rows[0]).getByTestId('provenance-detail-toggle'))
    expect(within(rows[0]).getByTestId('provenance-detail-panel'))
      .not.toHaveTextContent(/Observed:/)
    expect(within(rows[4]).getByText(/current snapshot/)).toBeInTheDocument()
  })

  // ── Security Research Q&A Slice 2: the three new response states ─────────

  it('renders an answer_with_caveat response with the caveat text visible', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, response_state: 'answer_with_caveat',
      summary: 'Apple beat earnings estimates on strong Mac sales.',
      key_facts: [{ statement: 'Apple beat earnings estimates.', evidence_id: 'E1' }],
      interpretation: '', caveat: 'This is the most recent available evidence, several days old -- not from today.',
      clarification_question: '', citations: [], insufficient_evidence: false,
      insufficient_evidence_reason: '', model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What happened today?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-answer')).toBeInTheDocument())
    expect(screen.getByTestId('ask-ai-caveat')).toHaveTextContent(/not from today/)
    expect(screen.getByText('Apple beat earnings estimates on strong Mac sales.')).toBeInTheDocument()
  })

  it('renders a partially_answer response with the unsupported portion named', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, response_state: 'partially_answer',
      summary: 'Q2 2026 revenue was $94.5B, EPS $1.52.',
      key_facts: [{ statement: 'Q2 2026 revenue was $94.5B.', evidence_id: 'E1' }],
      interpretation: '',
      caveat: 'The 10-Q\'s body text (e.g. supply-chain risk commentary) is not available to me.',
      clarification_question: '',
      citations: [{ id: 'E1', type: 'financials_quarter', date: 'Q2 2026', source: 'UCT Financials', url: null }],
      insufficient_evidence: false, insufficient_evidence_reason: '',
      model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What were Q2 financials and what does the 10-Q say?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-answer')).toBeInTheDocument())
    expect(screen.getByText('Q2 2026 revenue was $94.5B, EPS $1.52.')).toBeInTheDocument()
    expect(screen.getByTestId('ask-ai-unsupported')).toHaveTextContent(/10-Q's body text/)
  })

  it('renders an ask_for_clarification response as a question, not a fabricated answer', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, response_state: 'ask_for_clarification',
      summary: '', key_facts: [], interpretation: '', caveat: '',
      clarification_question: 'Did you mean analyst sentiment, forward estimates, or reported financials?',
      citations: [], insufficient_evidence: true,
      insufficient_evidence_reason: 'Did you mean analyst sentiment, forward estimates, or reported financials?',
      model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'How has the outlook changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-clarification')).toBeInTheDocument())
    expect(screen.getByTestId('ask-ai-clarification')).toHaveTextContent(/Did you mean analyst sentiment/)
    expect(screen.queryByTestId('ask-ai-answer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ask-ai-insufficient')).not.toBeInTheDocument()
  })

  it('renders a caveat the model attached to a plain "answer" state (not just answer_with_caveat)', async () => {
    // Live-validation finding: the model can honestly populate `caveat`
    // while still choosing response_state "answer" -- the UI must not
    // silently drop that text just because the state isn't literally
    // "answer_with_caveat".
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, response_state: 'answer',
      summary: 'Institutional investors own approximately 66.37% of AAPL.',
      key_facts: [{ statement: 'Institutional ownership is 66.37%.', evidence_id: 'E1' }],
      interpretation: '',
      caveat: 'This figure and the 13F data are on different clocks and should not be treated as the same moment in time.',
      clarification_question: '', citations: [], insufficient_evidence: false,
      insufficient_evidence_reason: '', model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What percentage is owned by institutions?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-answer')).toBeInTheDocument())
    expect(screen.getByTestId('ask-ai-caveat')).toHaveTextContent(/different clocks/)
  })

  it('still renders a pre-Slice-2 payload with no response_state field correctly (backward compat)', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, summary: 'Analysts turned more positive.',
      key_facts: [{ statement: 'Goldman Sachs upgraded from Hold to Buy.', evidence_id: 'E1' }],
      interpretation: '', citations: [{ id: 'E1', type: 'analyst_action', date: '2026-08-30', source: 'Goldman Sachs', url: null }],
      insufficient_evidence: false, insufficient_evidence_reason: '', model: 'claude-sonnet-5', error: null,
    })
    render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-answer')).toBeInTheDocument())
    expect(screen.getByText('Analysts turned more positive.')).toBeInTheDocument()
    expect(screen.queryByTestId('ask-ai-caveat')).not.toBeInTheDocument()
  })

  // ── Security Research Q&A Slice 3: bounded multi-turn conversation ───────

  it('renders a second turn as its own thread entry, alongside the first', async () => {
    mockFetchSequence([
      { status: 200, body: {
        sym: 'AAPL', entity: null, response_state: 'answer',
        summary: 'Apple beat earnings estimates.',
        key_facts: [{ statement: 'EPS came in at $1.64 vs $1.52 expected.', evidence_id: 'E1' }],
        interpretation: '', caveat: '', clarification_question: '',
        citations: [], insufficient_evidence: false, insufficient_evidence_reason: '',
        model: 'claude-sonnet-5', error: null,
        turn_state: { sym: 'AAPL', question: 'What changed?', response_state: 'answer',
                      domains: ['financials'], summary: 'Apple beat earnings estimates.' },
      } },
      { status: 200, body: {
        sym: 'AAPL', entity: null, response_state: 'answer',
        summary: 'The beat was driven by Mac and Services growth.',
        key_facts: [{ statement: 'Services revenue grew 14% year over year.', evidence_id: 'E2' }],
        interpretation: '', caveat: '', clarification_question: '',
        citations: [], insufficient_evidence: false, insufficient_evidence_reason: '',
        model: 'claude-sonnet-5', error: null,
        turn_state: { sym: 'AAPL', question: 'Why does that matter?', response_state: 'answer',
                      domains: ['financials'], summary: 'The beat was driven by Mac and Services growth.' },
      } },
    ])
    render(<AskAiTab sym="AAPL" />)

    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getAllByTestId('ask-ai-turn')).toHaveLength(1))
    await waitFor(() => expect(screen.getByText('Apple beat earnings estimates.')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'Why does that matter?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getAllByTestId('ask-ai-turn')).toHaveLength(2))

    const turns = screen.getAllByTestId('ask-ai-turn')
    expect(within(turns[0]).getByTestId('ask-ai-turn-question')).toHaveTextContent('What changed?')
    expect(within(turns[0]).getByText('Apple beat earnings estimates.')).toBeInTheDocument()
    expect(within(turns[1]).getByTestId('ask-ai-turn-question')).toHaveTextContent('Why does that matter?')
    expect(within(turns[1]).getByText('The beat was driven by Mac and Services growth.')).toBeInTheDocument()

    // the second request carries the first turn's server-returned turn_state
    // as history -- never the client's own guess at what happened
    const secondCallBody = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect(secondCallBody.history).toEqual([
      { sym: 'AAPL', question: 'What changed?', response_state: 'answer',
        domains: ['financials'], summary: 'Apple beat earnings estimates.' },
    ])
  })

  it('the New Conversation button appears only after the first turn, and resets the thread', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, response_state: 'answer', summary: 'x', key_facts: [],
      interpretation: '', caveat: '', clarification_question: '', citations: [],
      insufficient_evidence: false, insufficient_evidence_reason: '',
      model: 'claude-sonnet-5', error: null,
      turn_state: { sym: 'AAPL', question: 'What changed?', response_state: 'answer',
                    domains: ['news'], summary: 'x' },
    })
    render(<AskAiTab sym="AAPL" />)
    expect(screen.queryByTestId('ask-ai-new-conversation')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getByTestId('ask-ai-new-conversation')).toBeInTheDocument())
    expect(screen.getAllByTestId('ask-ai-turn')).toHaveLength(1)

    fireEvent.click(screen.getByTestId('ask-ai-new-conversation'))
    expect(screen.queryByTestId('ask-ai-turn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ask-ai-new-conversation')).not.toBeInTheDocument()
  })

  it('changing the security resets the thread and clears in-flight state (entity isolation)', async () => {
    mockFetchOnce(200, {
      sym: 'AAPL', entity: null, response_state: 'answer', summary: "Apple's context.",
      key_facts: [], interpretation: '', caveat: '', clarification_question: '', citations: [],
      insufficient_evidence: false, insufficient_evidence_reason: '',
      model: 'claude-sonnet-5', error: null,
      turn_state: { sym: 'AAPL', question: 'What changed?', response_state: 'answer',
                    domains: ['news'], summary: "Apple's context." },
    })
    const { rerender } = render(<AskAiTab sym="AAPL" />)
    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getAllByTestId('ask-ai-turn')).toHaveLength(1))

    mockFetchOnce(200, {
      sym: 'NVDA', entity: null, response_state: 'answer', summary: "NVDA's context.",
      key_facts: [], interpretation: '', caveat: '', clarification_question: '', citations: [],
      insufficient_evidence: false, insufficient_evidence_reason: '',
      model: 'claude-sonnet-5', error: null,
      turn_state: { sym: 'NVDA', question: 'What changed?', response_state: 'answer',
                    domains: ['news'], summary: "NVDA's context." },
    })
    rerender(<AskAiTab sym="NVDA" />)

    // the prior security's thread is gone -- switching routes/securities is
    // a hard reset, not a carried-forward conversation
    expect(screen.queryByTestId('ask-ai-turn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ask-ai-new-conversation')).not.toBeInTheDocument()
    expect(screen.getByTestId('ask-ai-input').value).toBe('')

    fireEvent.change(screen.getByTestId('ask-ai-input'), { target: { value: 'What changed?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await waitFor(() => expect(screen.getAllByTestId('ask-ai-turn')).toHaveLength(1))

    // NVDA's request never carries AAPL's history -- client-side half of
    // entity isolation (the server independently enforces this too)
    const lastCallBody = JSON.parse(global.fetch.mock.calls[global.fetch.mock.calls.length - 1][1].body)
    expect(lastCallBody.history).toEqual([])
  })
})
