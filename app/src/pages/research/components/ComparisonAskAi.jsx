import { useState } from 'react'
import styles from '../ResearchPage.module.css'

// Shared Multi-Security Grounding Architecture V1 (owner authorization,
// Phase B). Scoped, minimal Ask AI panel for the two-security comparison
// page -- deliberately NOT AskAiTab.jsx (single-security, multi-turn); see
// api/services/research/comparison_ai_adapter.py's module docstring for the
// full backend contract this renders. Single-turn only for V1: no existing
// history plumbing for a two-ticker conversation exists yet.
const SUGGESTIONS = [
  'How do their valuations compare?',
  'Which one does UCT rate higher, and why?',
  'How do analyst expectations compare?',
]

function responseStateOf(data) {
  return data.response_state || (data.insufficient_evidence ? 'refuse' : 'answer')
}

export default function ComparisonAskAi({ symA, symB }) {
  const [question, setQuestion] = useState('')
  const [status, setStatus] = useState('idle') // idle|loading|done|error
  const [data, setData] = useState(null)
  const [askedQuestion, setAskedQuestion] = useState('')

  async function ask(q) {
    const text = (q ?? question).trim()
    if (!text || !symA || !symB) return
    setStatus('loading')
    setAskedQuestion(text)
    setQuestion('')
    try {
      const r = await fetch(
        `/api/research/compare/${encodeURIComponent(symA)}/${encodeURIComponent(symB)}/explain`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: text }),
        }
      )
      if (!r.ok) {
        setStatus('error')
        return
      }
      const json = await r.json()
      setData(json)
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    ask()
  }

  const responseState = data ? responseStateOf(data) : null
  const isAnswer = responseState === 'answer' || responseState === 'answer_with_caveat'
                   || responseState === 'partially_answer'

  return (
    <div>
      <div className={styles.explainSuggestions}>
        {SUGGESTIONS.map(s => (
          <button key={s} type="button" className={styles.explainChip}
                  onClick={() => { setQuestion(s); ask(s) }}>{s}</button>
        ))}
      </div>
      <form className={styles.explainForm} onSubmit={onSubmit}>
        <textarea
          className={styles.explainInput}
          placeholder={`Ask how ${symA} and ${symB} compare…`}
          value={question}
          onChange={e => setQuestion(e.target.value)}
          data-testid="comparison-ask-ai-input"
        />
        <button type="submit" className={styles.explainBtn}
                disabled={status === 'loading' || !question.trim()}>
          {status === 'loading' ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {status === 'idle' && (
        <div className={styles.fnote}>
          Ask how these two securities compare — fundamentals, UCT rating, analyst
          expectations, or estimates — grounded in UCT's own data, with sources.
          This assistant explains; it does not give buy/sell/hold advice.
        </div>
      )}

      {status === 'loading' && (
        <div className={styles.fnote} data-testid="comparison-ask-ai-loading">
          Reading UCT's canonical research data for both securities…
        </div>
      )}
      {status === 'error' && (
        <div className={styles.fnote} data-testid="comparison-ask-ai-error">
          The AI assistant is temporarily unavailable. Try again shortly.
        </div>
      )}

      {status === 'done' && data && (
        <div data-testid="comparison-ask-ai-turn">
          <div className={styles.explainTurnQuestion} data-testid="comparison-ask-ai-turn-question">
            You asked: {askedQuestion}
          </div>

          {responseState === 'refuse' && (
            <div className={styles.explainInsufficient} data-testid="comparison-ask-ai-insufficient">
              {data.insufficient_evidence_reason || "I don't have enough verified UCT data to establish that."}
            </div>
          )}

          {responseState === 'ask_for_clarification' && (
            <div className={styles.explainClarification} data-testid="comparison-ask-ai-clarification">
              {data.clarification_question || data.insufficient_evidence_reason}
            </div>
          )}

          {isAnswer && (
            <div data-testid="comparison-ask-ai-answer">
              {responseState !== 'partially_answer' && data.caveat && (
                <div className={styles.explainCaveat} data-testid="comparison-ask-ai-caveat">{data.caveat}</div>
              )}

              {data.summary && <p className={styles.explainSummary}>{data.summary}</p>}

              {!!(data.key_facts || []).length && (
                <>
                  <div className={styles.explainSectionLbl}>What the evidence shows</div>
                  {data.key_facts.map((f, i) => (
                    <div key={i} className={styles.explainFact}>
                      <strong>{f.sym}:</strong> {f.statement}
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
                        <span>{c.sym} · {c.source} · {c.date}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {responseState === 'partially_answer' && data.caveat && (
                <div className={styles.explainUnsupported} data-testid="comparison-ask-ai-unsupported">
                  <strong>Not covered:</strong> {data.caveat}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
