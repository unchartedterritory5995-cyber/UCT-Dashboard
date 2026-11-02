/**
 * UCT News -- "Ask UCT Agent…" under one headline's explanation (increments 2/3).
 *
 * ⛔ NO AGENT LIVES HERE. News renders the conversation; UCT Agent runs it. Every
 * turn goes through the canonical Agent (agent-lead's answer-only news turn: the
 * server resolves the headline from its id, admin-only, the normal meter), reached
 * ONLY through what `NewsAgentContext` provides:
 *
 *   useAsk({ newsId })   -> { ask(text), turns, busy, error, conversationId }
 *                           turns: [{ id, role: 'member' | 'agent', text }]
 *                           error: { text, retry } | null
 *   openAgent({ conversationId })   opens that same conversation in the Agent panel
 *
 * (the interface agreed with agent-lead: `useAgentAsk` + `openAgent` from app/src/agent).
 * Until those exports exist the context is null and nothing here renders -- members and
 * every admin keep today's explanation exactly. News never sends headline TEXT: only the
 * id, so the Agent answers about the stored row, never about what a browser claims.
 *
 * READ-ONLY by construction: this surface can only ask and read answers. It holds no
 * chart host, no workspace, no action handlers -- an answer is shown as text, never run.
 */
import { useContext, useEffect, useRef, useState } from 'react'
import { NewsAgentContext } from './tradeExchangeNewsAgent'
import styles from './TradeExchangeNewsWidget.module.css'

const MAX_QUESTION = 500
const VISIBLE_TURNS = 6      // three exchanges; earlier ones fold behind "Show earlier"

export function NewsAgentAsk({ newsId }) {
  const agent = useContext(NewsAgentContext)
  if (!agent?.useAsk) return null
  return <AskThread newsId={newsId} useAsk={agent.useAsk} openAgent={agent.openAgent} />
}

function AskThread({ newsId, useAsk, openAgent }) {
  const { ask, turns = [], busy = false, error = null, conversationId = null } = useAsk({ newsId })
  const [text, setText] = useState('')
  const [lastAsked, setLastAsked] = useState('')
  const [showAll, setShowAll] = useState(false)
  const logRef = useRef(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length, busy])

  const send = (q) => {
    const question = q.trim().slice(0, MAX_QUESTION)
    if (!question || busy) return
    setLastAsked(question)
    ask(question)
  }
  const onSubmit = (e) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    send(text)
    setText('')
  }
  const hidden = showAll ? 0 : Math.max(0, turns.length - VISIBLE_TURNS)
  const shown = turns.slice(hidden)

  return (
    <div className={styles.ask}>
      {(turns.length > 0 || busy || error) && (
        <div ref={logRef} className={styles.askLog} role="log" aria-label="Conversation with UCT Agent" aria-live="polite">
          {hidden > 0 && (
            <button type="button" className={styles.askEarlier} onClick={() => setShowAll(true)}>
              Show {hidden} earlier
            </button>
          )}
          {shown.map((t) => (
            <p key={t.id} className={t.role === 'member' ? styles.askMine : styles.askAgent}>
              {t.role !== 'member' && <span className={styles.srOnly}>UCT Agent: </span>}
              {t.text}
            </p>
          ))}
          {busy && <p className={styles.askBusy}>UCT Agent is typing…</p>}
          {error && !busy && (
            <div className={styles.explainError}>
              <span>{error.text}</span>
              {error.retry && lastAsked && (
                <button type="button" className={styles.explainAction} onClick={() => send(lastAsked)}>Retry</button>
              )}
            </div>
          )}
        </div>
      )}
      <form className={styles.askForm} onSubmit={onSubmit}>
        <input
          className={styles.askInput}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask UCT Agent…"
          aria-label="Ask UCT Agent about this headline"
          maxLength={MAX_QUESTION}
          enterKeyHint="send"
          autoComplete="off"
          // Esc belongs to the explanation (it closes it); everything else stays in the box
          onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation() }}
        />
        <button type="submit" className={styles.askSend} disabled={busy || !text.trim()} aria-label="Send question">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </form>
      {conversationId && openAgent && (
        <button type="button" className={styles.askContinue} onClick={() => openAgent({ conversationId })}>
          Continue in UCT Agent <span aria-hidden="true">↗</span>
        </button>
      )}
    </div>
  )
}
