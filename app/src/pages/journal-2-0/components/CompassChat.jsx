/**
 * Compass Chat panel — top of the Compass tab.
 *
 * Composes: header, scrollback, pending-action card, composer, empty state.
 * Hidden entirely when status.enabled = false. Composer disabled when rate
 * limit exhausted.
 */
import { useState, useRef, useEffect, useMemo } from 'react'
import useJ2CoachChat from '../hooks/useJ2CoachChat'
import ChatMessage from './ChatMessage'
import ChatActionCard from './ChatActionCard'

const SUGGESTED_PROMPTS = [
  'How am I doing this week?',
  "Why did I lose on my worst recent day?",
  'Compare my Bull Flag and Pullback performance',
  'What is the biggest pattern in my recent losses?',
]

export default function CompassChat({ accountId }) {
  const {
    messages, status, isStreaming, streamingTokens, pendingAction,
    error, send, confirm, cancel, forgetAll,
  } = useJ2CoachChat(accountId)
  const [input, setInput] = useState('')
  const scrollerRef = useRef(null)
  const [showMenu, setShowMenu] = useState(false)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, streamingTokens])

  const toolResults = useMemo(() => {
    const out = {}
    for (const m of messages) {
      if (m.role === 'tool' && Array.isArray(m.tool_results)) {
        for (const tr of m.tool_results) out[tr.tool_call_id] = tr
      }
    }
    return out
  }, [messages])

  if (status && status.enabled === false) return null

  const limitHit = status?.rate_limit_remaining <= 0
  const composerDisabled = isStreaming || limitHit

  const onSubmit = (text) => {
    const t = (text ?? input).trim()
    if (!t) return
    setInput('')
    send(t)
  }

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    }
  }

  const hasContent = messages.length > 0 || isStreaming

  return (
    <section style={{
      background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
      border: '1px solid var(--border)', borderRadius: 8,
      margin: '12px 0', padding: '12px 16px',
    }}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ut-gold, #c9a84c)' }}>
          🧭 Talk to Compass
        </div>
        <div style={{ position: 'relative' }}>
          <button
            type="button" aria-label="Chat options"
            onClick={() => setShowMenu((v) => !v)}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16,
            }}
          >⋯</button>
          {showMenu && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', zIndex: 5,
              background: 'var(--bg-base, #1a1a1a)',
              border: '1px solid var(--border)', borderRadius: 6,
              minWidth: 200, padding: 4,
            }}>
              <button
                type="button"
                onClick={() => { setShowMenu(false); forgetAll() }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', fontSize: 12,
                  background: 'transparent', border: 'none',
                  color: 'var(--text-bright)', cursor: 'pointer',
                }}
              >Clear conversation</button>
            </div>
          )}
        </div>
      </header>

      <div ref={scrollerRef} style={{
        maxHeight: 480, overflowY: 'auto', padding: '4px 2px', minHeight: 80,
      }}>
        {!hasContent && (
          <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🧭</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              <strong style={{ color: 'var(--text-bright)' }}>Compass is here.</strong>
            </div>
            <div style={{ fontSize: 12, marginBottom: 12 }}>
              Ask me anything about your trading.
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 6, maxWidth: 700, margin: '0 auto',
            }}>
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p} type="button"
                  onClick={() => onSubmit(p)}
                  style={{
                    padding: '8px 12px', fontSize: 12, textAlign: 'left',
                    background: 'rgba(201,168,76,0.06)',
                    border: '1px solid rgba(201,168,76,0.3)',
                    borderRadius: 4, color: 'var(--text-bright)', cursor: 'pointer',
                  }}
                >{p}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} toolResults={toolResults} />
        ))}

        {isStreaming && streamingTokens && (
          <ChatMessage
            message={{ id: '_streaming', role: 'assistant', content: streamingTokens + '▌' }}
            toolResults={{}}
          />
        )}

        {pendingAction && (
          <ChatActionCard
            pendingAction={pendingAction}
            onConfirm={() => confirm(pendingAction.message_id, pendingAction.tool_call_id)}
            onCancel={() => cancel(pendingAction.message_id, pendingAction.tool_call_id)}
            disabled={isStreaming}
          />
        )}
      </div>

      {error && (
        <div role="alert" style={{
          margin: '6px 0', padding: '6px 10px', fontSize: 11,
          background: 'rgba(239,68,68,0.08)', color: 'var(--loss, #ef4444)',
          border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4,
        }}>{String(error)}</div>
      )}

      <div style={{ marginTop: 8 }}>
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={limitHit ? 'Daily limit reached. Resets at midnight UTC.' : 'Type to Compass… (Cmd+Enter to send)'}
          disabled={composerDisabled}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 12px',
            fontSize: 13, fontFamily: 'inherit',
            background: 'var(--bg-base, #1a1a1a)', color: 'var(--text-bright)',
            border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {limitHit
              ? '⛔ Daily limit reached'
              : `${status?.rate_limit_remaining ?? 200} messages remaining today`}
          </span>
          <button
            type="button"
            onClick={() => onSubmit()}
            disabled={composerDisabled || !input.trim()}
            style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600,
              background: 'var(--ut-gold, #c9a84c)', color: '#000',
              border: 'none', borderRadius: 4, cursor: composerDisabled ? 'not-allowed' : 'pointer',
              opacity: composerDisabled || !input.trim() ? 0.5 : 1,
            }}
          >Send</button>
        </div>
      </div>
    </section>
  )
}
