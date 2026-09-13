// GATE-I1 slice 2 — the FIXTURE answer both screenshots render.
//
// ⛔ SEEDED, NEVER LIVE. No model call, no /api/research/explain request leaves
// this harness: `main.jsx` replaces `window.fetch` with a resolver over this
// object. The shape is exactly what `api/services/ticker_explain.py::_result`
// returns — `citations` is the evidence list filtered to the ids `key_facts`
// cite, which is why the [E#] marks below are a subset of the source ids.
export const FIXTURE_ANSWER = {
  sym: 'AAPL',
  entity: { status: 'resolved', entityId: 'e-aapl' },
  response_state: 'answer',
  summary:
    'Analyst posture on AAPL firmed up over the past week while the most recent '
    + 'reported quarter came in ahead of consensus on both revenue and EPS.',
  key_facts: [
    { statement: 'Goldman Sachs moved AAPL from Hold to Buy.', evidence_id: 'E1' },
    { statement: 'Q2 2026 revenue was $94.5B against a $92.1B consensus.', evidence_id: 'E4' },
    { statement: 'Institutions hold approximately 66.4% of shares outstanding.', evidence_id: 'E6' },
  ],
  interpretation:
    'This may suggest the sell side is catching up to a quarter the tape had '
    + 'already partly discounted.',
  caveat: '',
  clarification_question: '',
  citations: [
    { id: 'E1', type: 'analyst_action', date: '2026-08-30', source: 'Goldman Sachs', url: null },
    { id: 'E2', type: 'news', date: '2026-08-29', source: 'Reuters', url: 'https://example.com/a' },
    { id: 'E3', type: 'news', date: '2026-08-29', source: 'Reuters', url: 'https://example.com/b' },
    {
      id: 'E4',
      type: 'financials_quarter',
      date: 'Q2 2026 (calendar-quarter label -- may not match fiscal)',
      source: 'UCT Financials (yfinance)',
      url: null,
    },
    { id: 'E5', type: 'ratings_summary', date: 'current snapshot', source: 'FMP, via UCT Analyst Ratings', url: null },
    { id: 'E6', type: 'ownership', date: 'current snapshot', source: 'UCT Ownership (yfinance)', url: null },
    { id: 'E7', type: 'insider', date: '2026-07-14', source: 'SEC Form 4, via UCT Ownership', url: null },
    {
      id: 'E8',
      type: 'estimates',
      date: 'FY2027 (relative label, no absolute anchoring date)',
      source: 'UCT Estimates (yfinance)',
      url: null,
    },
  ],
  insufficient_evidence: false,
  insufficient_evidence_reason: '',
  model: 'claude-sonnet-5 (FIXTURE — no model was called)',
  error: null,
  turn_state: {
    sym: 'AAPL',
    question: 'What changed in analyst sentiment or ratings?',
    response_state: 'answer',
    domains: ['ratings', 'financials', 'ownership'],
    summary: 'Analyst posture firmed up; the last quarter beat.',
  },
}
