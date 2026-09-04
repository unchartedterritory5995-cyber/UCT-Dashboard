import { useState } from 'react'
import styles from '../ResearchPage.module.css'

// AI-Native Research Assistant Slice 1 + Security Research Q&A Slice 2 (I1
// Intelligence Layer, owner-authorized, 2026-09-04). "Explain", not "ask
// anything" -- see api/services/ticker_explain.py's module docstring for
// the full contract this tab renders. Deliberately a fresh, minimal
// component (NOT AiSearchWidget.jsx, the general-purpose multi-mode chat
// surface used elsewhere) so this tab's tight scope -- one backend
// endpoint, no decisive-verdict language, no tool selection beyond the six
// canonical composers Slice 2 authorizes -- can never drift by inheriting a
// broader surface's capabilities.
const SUGGESTIONS = [
  'What changed with this company recently?',
  'What changed in analyst sentiment or ratings?',
  'Summarize the important evidence I should investigate.',
]

// Backward-compatible with pre-Slice-2 payloads that only ever set the
// boolean `insufficient_evidence` (never `response_state`) -- falls back to
// the old two-way split so nothing that already renders correctly changes.
function responseStateOf(data) {
  return data.response_state || (data.insufficient_evidence ? 'refuse' : 'answer')
}

export default function AskAiTab({ sym }) {
  const [question, setQuestion] = useState('')
  const [state, setState] = useState({ status: 'idle' }) // idle | loading | done | error

  async function ask(q) {
    const text = (q ?? question).trim()
    if (!text || !sym) return
    setState({ status: 'loading' })
    try {
      const r = await fetch(`/api/research/explain/${encodeURIComponent(sym)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      })
      if (!r.ok) {
        setState({ status: 'error' })
        return
      }
      const data = await r.json()
      setState({ status: 'done', data })
    } catch {
      setState({ status: 'error' })
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    ask()
  }

  const data = state.status === 'done' ? state.data : null
  const responseState = data ? responseStateOf(data) : null
  const isAnswer = responseState === 'answer' || responseState === 'answer_with_caveat'
                   || responseState === 'partially_answer'

  return (
    <div className={styles.finWrap}>
      <section className={styles.card}>
        <div className={styles.ct}>Ask AI — {sym}</div>
        <div className={styles.explainSuggestions}>
          {SUGGESTIONS.map(s => (
            <button key={s} type="button" className={styles.explainChip}
                    onClick={() => { setQuestion(s); ask(s) }}>{s}</button>
          ))}
        </div>
        <form className={styles.explainForm} onSubmit={onSubmit}>
          <textarea
            className={styles.explainInput}
            placeholder={`Ask about ${sym}'s recent news, financials, estimates, ownership, analyst activity, or filings…`}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            data-testid="ask-ai-input"
          />
          <button type="submit" className={styles.explainBtn}
                  disabled={state.status === 'loading' || !question.trim()}>
            {state.status === 'loading' ? 'Asking…' : 'Ask'}
          </button>
        </form>

        {state.status === 'loading' && (
          <div className={styles.fnote} data-testid="ask-ai-loading">Reading UCT's canonical research data…</div>
        )}
        {state.status === 'error' && (
          <div className={styles.fnote} data-testid="ask-ai-error">The AI assistant is temporarily unavailable. Try again shortly.</div>
        )}

        {data && responseState === 'refuse' && (
          <div className={styles.explainInsufficient} data-testid="ask-ai-insufficient">
            {data.insufficient_evidence_reason || "I don't have enough verified UCT data to establish that."}
          </div>
        )}

        {data && responseState === 'ask_for_clarification' && (
          <div className={styles.explainClarification} data-testid="ask-ai-clarification">
            {data.clarification_question || data.insufficient_evidence_reason}
          </div>
        )}

        {data && isAnswer && (
          <div data-testid="ask-ai-answer">
            {data.entity && data.entity.status !== 'resolved' && (
              <div className={styles.muted} style={{ fontSize: 11, marginBottom: 6 }} data-testid="entity-unresolved-note">
                Symbol not yet linked to a canonical identity ({data.entity.status}).
              </div>
            )}

            {responseState !== 'partially_answer' && data.caveat && (
              <div className={styles.explainCaveat} data-testid="ask-ai-caveat">{data.caveat}</div>
            )}

            {data.summary && <p className={styles.explainSummary}>{data.summary}</p>}

            {!!(data.key_facts || []).length && (
              <>
                <div className={styles.explainSectionLbl}>What the evidence shows</div>
                {data.key_facts.map((f, i) => (
                  <div key={i} className={styles.explainFact}>
                    {f.statement}
                    <span className={styles.explainFactMark}>[{f.evidence_id}]</span>
                  </div>
                ))}
              </>
            )}

            {data.interpretation && (
              <>
                <div className={styles.explainSectionLbl}>This may suggest</div>
                <p className={styles.explainInterp}>{data.interpretation}</p>
              </>
            )}

            {!!(data.citations || []).length && (
              <>
                <div className={styles.explainSectionLbl}>Sources</div>
                <div className={styles.explainCitations}>
                  {data.citations.map(c => (
                    <div key={c.id} className={styles.explainCitation}>
                      <span className={styles.explainCitationMark}>[{c.id}]</span>
                      <span>
                        {c.source} · {c.date}
                        {c.url ? <> — <a href={c.url} target="_blank" rel="noopener noreferrer">source</a></> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {responseState === 'partially_answer' && data.caveat && (
              <div className={styles.explainUnsupported} data-testid="ask-ai-unsupported">
                <strong>Not covered:</strong> {data.caveat}
              </div>
            )}
          </div>
        )}

        {state.status === 'idle' && (
          <div className={styles.fnote}>
            Ask about this company's recent news, financials, estimates, ownership, analyst
            activity, or SEC filings — grounded in UCT's own data, with sources.
            This assistant explains; it does not give buy/sell/hold advice.
          </div>
        )}
      </section>
    </div>
  )
}
