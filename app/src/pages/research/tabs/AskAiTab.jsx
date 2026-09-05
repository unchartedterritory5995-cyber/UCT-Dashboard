import { useState, useEffect, useRef } from 'react'
import styles from '../ResearchPage.module.css'

// AI-Native Research Assistant Slice 1 + Security Research Q&A Slice 2 + 3
// (I1 Intelligence Layer, owner-authorized, 2026-09-04). "Explain", not "ask
// anything" -- see api/services/ticker_explain.py's module docstring for
// the full contract this tab renders. Deliberately a fresh, minimal
// component (NOT AiSearchWidget.jsx, the general-purpose multi-mode chat
// surface used elsewhere) so this tab's tight scope -- one backend
// endpoint, no decisive-verdict language, no tool selection beyond the six
// canonical composers Slice 2 authorizes -- can never drift by inheriting a
// broader surface's capabilities.
//
// Slice 3 adds a bounded multi-turn conversation: up to the 3 most recent
// prior exchanges stay in context (server-enforced sliding window --
// `_clean_history` in ticker_explain.py). The client's only job is to keep
// appending each turn's server-returned `turn_state` to a rolling array and
// echo it back on the next request; the server owns trimming, entity
// isolation, and every grounding guarantee. This is still explicitly NOT a
// chat product: no streaming, no rich-chat framework, no message editing --
// just a list of independently-grounded question/answer turns.
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

let _turnIdSeq = 0
function nextTurnId() {
  _turnIdSeq += 1
  return _turnIdSeq
}

function AskAiTurnResult({ data }) {
  const responseState = responseStateOf(data)
  const isAnswer = responseState === 'answer' || responseState === 'answer_with_caveat'
                   || responseState === 'partially_answer'

  return (
    <>
      {responseState === 'refuse' && (
        <div className={styles.explainInsufficient} data-testid="ask-ai-insufficient">
          {data.insufficient_evidence_reason || "I don't have enough verified UCT data to establish that."}
        </div>
      )}

      {responseState === 'ask_for_clarification' && (
        <div className={styles.explainClarification} data-testid="ask-ai-clarification">
          {data.clarification_question || data.insufficient_evidence_reason}
        </div>
      )}

      {isAnswer && (
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
    </>
  )
}

export default function AskAiTab({ sym }) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState([]) // [{ id, question, status: loading|done|error, data }]
  // Client-side rolling history, mirrored from each turn's server-returned
  // `turn_state` (never the client's own guess at what happened). A ref, not
  // state, because it's an internal request-shaping detail -- updating it
  // must never itself trigger a render.
  const historyRef = useRef([])

  // Security/route change resets the conversation -- client-side half of
  // Slice 3's entity-isolation defense-in-depth (the server independently
  // discards any mismatched-`sym` history entry regardless of client
  // behavior; see `_clean_history` in ticker_explain.py).
  useEffect(() => {
    setTurns([])
    historyRef.current = []
    setQuestion('')
  }, [sym])

  async function ask(q) {
    const text = (q ?? question).trim()
    if (!text || !sym) return
    const id = nextTurnId()
    setTurns(prev => [...prev, { id, question: text, status: 'loading', data: null }])
    setQuestion('')
    try {
      const r = await fetch(`/api/research/explain/${encodeURIComponent(sym)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, history: historyRef.current }),
      })
      if (!r.ok) {
        setTurns(prev => prev.map(t => (t.id === id ? { ...t, status: 'error' } : t)))
        return
      }
      const data = await r.json()
      if (data.turn_state) {
        historyRef.current = [...historyRef.current, data.turn_state].slice(-3)
      }
      setTurns(prev => prev.map(t => (t.id === id ? { ...t, status: 'done', data } : t)))
    } catch {
      setTurns(prev => prev.map(t => (t.id === id ? { ...t, status: 'error' } : t)))
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    ask()
  }

  function resetConversation() {
    setTurns([])
    historyRef.current = []
    setQuestion('')
  }

  const busy = turns.some(t => t.status === 'loading')

  return (
    <div className={styles.finWrap}>
      <section className={styles.card}>
        <div className={styles.explainHeaderRow}>
          <div className={styles.ct}>Ask AI — {sym}</div>
          {turns.length > 0 && (
            <button type="button" className={styles.explainNewConvoBtn} onClick={resetConversation}
                    data-testid="ask-ai-new-conversation">
              New Conversation
            </button>
          )}
        </div>

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
                  disabled={busy || !question.trim()}>
            {busy ? 'Asking…' : 'Ask'}
          </button>
        </form>

        {turns.length === 0 && (
          <div className={styles.fnote}>
            Ask about this company's recent news, financials, estimates, ownership, analyst
            activity, or SEC filings — grounded in UCT's own data, with sources.
            This assistant explains; it does not give buy/sell/hold advice.
          </div>
        )}

        <div className={styles.explainThread} data-testid="ask-ai-thread">
          {turns.map(t => (
            <div key={t.id} className={styles.explainTurn} data-testid="ask-ai-turn">
              <div className={styles.explainTurnQuestion} data-testid="ask-ai-turn-question">
                You asked: {t.question}
              </div>

              {t.status === 'loading' && (
                <div className={styles.fnote} data-testid="ask-ai-loading">Reading UCT's canonical research data…</div>
              )}
              {t.status === 'error' && (
                <div className={styles.fnote} data-testid="ask-ai-error">The AI assistant is temporarily unavailable. Try again shortly.</div>
              )}
              {t.status === 'done' && <AskAiTurnResult data={t.data} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
