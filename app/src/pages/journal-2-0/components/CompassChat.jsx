/**
 * Compass Chat panel — top of the Compass tab.
 *
 * Composes: header, scrollback, pending-action card, composer, empty state.
 * Hidden entirely when status.enabled = false. Composer disabled when rate
 * limit exhausted.
 */
import { useState, useRef, useEffect, useMemo, useContext } from 'react'
import UIcon from '../../../components/ui/UIcon'
import useJ2CoachChat from '../hooks/useJ2CoachChat'
import ChatMessage from './ChatMessage'
import ChatActionCard from './ChatActionCard'
import VoiceInputButton from './VoiceInputButton'
import UnlimitedBadge from './UnlimitedBadge'
import { VoiceContext } from '../../../context/VoiceContext'
import useRealtimeSession from '../../../hooks/useRealtimeSession'
import styles from './CompassChat.module.css'

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
    isOnboarding, needsOnboarding,
    startOnboarding, skipOnboarding, redoOnboarding,
  } = useJ2CoachChat(accountId)
  // Phase 2-C unification: full Realtime voice session from Compass tab.
  // The session writes its transcript to the same Compass thread via the
  // P2-B bridge in api/routers/voice.py::_bridge_session_to_compass_thread,
  // so anything the user says in voice shows up in this chat on the next
  // refresh. The button is hidden when no VoiceProvider is mounted (e.g.
  // in component tests rendered without the global app shell).
  const voice = useContext(VoiceContext)
  const inVoiceSession = !!voice
    && voice.mode === 'c' && voice.status !== 'idle' && voice.status !== 'error'
  const [input, setInput] = useState('')
  const scrollerRef = useRef(null)
  const [showMenu, setShowMenu] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    try { return localStorage.getItem('compassTtsEnabled') === 'true' } catch { return false }
  })
  const [autoSubmitVoice, setAutoSubmitVoice] = useState(() => {
    try { return localStorage.getItem('compassVoiceAutoSubmit') === 'true' } catch { return false }
  })
  const lastSpokenIdRef = useRef(null)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, streamingTokens])

  useEffect(() => {
    try { localStorage.setItem('compassTtsEnabled', String(ttsEnabled)) } catch {}
  }, [ttsEnabled])

  useEffect(() => {
    try { localStorage.setItem('compassVoiceAutoSubmit', String(autoSubmitVoice)) } catch {}
  }, [autoSubmitVoice])

  useEffect(() => {
    if (!ttsEnabled) return
    if (typeof window === 'undefined') return
    if (!window.speechSynthesis) return
    const lastAssistant = [...messages].reverse().find(
      (m) => m.role === 'assistant' && m.content,
    )
    if (!lastAssistant) return
    if (lastAssistant.id === lastSpokenIdRef.current) return
    lastSpokenIdRef.current = lastAssistant.id
    try {
      window.speechSynthesis.cancel()
      const utterance = new window.SpeechSynthesisUtterance(lastAssistant.content)
      utterance.rate = 1.0
      utterance.pitch = 1.0
      window.speechSynthesis.speak(utterance)
    } catch { /* ignore */ }
  }, [messages, ttsEnabled])

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
          <><UIcon name="compass" size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />{isOnboarding ? 'Onboarding interview' : 'Talk to Compass'}</>
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
              {status?.onboarded && !isOnboarding && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('This starts a fresh interview. Your existing profile stays unless you complete the new one. Continue?')) {
                      setShowMenu(false)
                      redoOnboarding && redoOnboarding()
                    }
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 12px', fontSize: 12,
                    background: 'transparent', border: 'none',
                    color: 'var(--text-bright)', cursor: 'pointer',
                  }}
                >Redo onboarding</button>
              )}
              <button
                type="button"
                onClick={() => { setTtsEnabled((v) => !v) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', fontSize: 12,
                  background: 'transparent', border: 'none',
                  color: 'var(--text-bright)', cursor: 'pointer',
                }}
              >
                {ttsEnabled ? <><UIcon name="volume" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Speaking replies (click to mute)</> : <><UIcon name="volumeOff" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Speak Compass replies</>}
              </button>
              <button
                type="button"
                onClick={() => { setAutoSubmitVoice((v) => !v) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', fontSize: 12,
                  background: 'transparent', border: 'none',
                  color: 'var(--text-bright)', cursor: 'pointer',
                }}
              >
                {autoSubmitVoice ? <><UIcon name="bolt" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Voice auto-submits (click to disable)</> : <><UIcon name="edit" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Voice fills input (click to auto-submit)</>}
              </button>
            </div>
          )}
        </div>
      </header>

      <div ref={scrollerRef} style={{
        maxHeight: 480, overflowY: 'auto', padding: '4px 2px', minHeight: 80,
        overscrollBehavior: 'contain',  // keep scroll inside the chat (no page-scroll bleed on touch)
      }}>
        {!hasContent && needsOnboarding && (
          <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}><UIcon name="compass" size={32} /></div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>
              <strong style={{ color: 'var(--text-bright)' }}>Welcome to Compass.</strong>
            </div>
            <div style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
              Before we start coaching, I'd like to interview you for a few minutes<br/>
              so I can be useful to you.
            </div>
            <button
              type="button"
              onClick={() => startOnboarding && startOnboarding()}
              style={{
                padding: '10px 18px', fontSize: 13, fontWeight: 600,
                background: 'var(--ut-gold, #c9a84c)', color: '#000',
                border: 'none', borderRadius: 6, cursor: 'pointer',
              }}
            >
              <UIcon name="compass" size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Start onboarding interview
            </button>
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => skipOnboarding && skipOnboarding()}
                style={{
                  fontSize: 11, color: 'var(--text-muted)', background: 'none',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Skip and start chatting →
              </button>
            </div>
          </div>
        )}

        {!hasContent && !needsOnboarding && (
          <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}><UIcon name="compass" size={24} /></div>
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

        {messages
          .filter((m) => m.content !== '[BEGIN_ONBOARDING_INTERVIEW]')
          .map((m) => (
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <UnlimitedBadge />
        </div>
        <textarea
          rows={2}
          className={styles.composerInput}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <VoiceInputButton
              onTranscript={(text) => {
                if (autoSubmitVoice) {
                  onSubmit(text)
                } else {
                  setInput(text)
                }
              }}
              disabled={composerDisabled}
            />
            {voice && (
              <TalkToCompassButton
                inVoiceSession={inVoiceSession}
                disabled={composerDisabled && !inVoiceSession}
              />
            )}
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {limitHit
                ? 'Daily limit reached'
                : `${status?.rate_limit_remaining ?? 200} left today`}
            </span>
          </div>
          <button
            type="button"
            className={styles.sendBtn}
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
      <div style={{
        fontSize: 10, color: 'var(--color-text-muted, #8a8a8a)', textAlign: 'center',
        padding: '6px 12px 2px', lineHeight: 1.4,
      }}>
        Compass is an educational trading coach — not personalized financial advice. Its
        verdicts grade setups against the firm's own method; they are not recommendations
        to buy or sell for your account.
      </div>
    </section>
  )
}


/**
 * TalkToCompassButton — sub-component so the realtime-session hook is only
 * instantiated when the parent has a VoiceProvider in scope. The hook is
 * imported eagerly but only mounted from within this child, which itself
 * is only rendered when VoiceContext has a non-null value.
 */
function TalkToCompassButton({ inVoiceSession, disabled }) {
  // This component is only rendered when VoiceContext has a non-null value,
  // so it is safe to call useRealtimeSession (which depends on useVoice).
  const { connect, disconnect } = useRealtimeSession()
  return (
    <button
      type="button"
      onClick={() => (inVoiceSession ? disconnect() : connect('compass'))}
      disabled={disabled}
      title={inVoiceSession
        ? 'Tap to end the voice conversation'
        : 'Open a full voice conversation with Compass'}
      style={{
        padding: '4px 10px', fontSize: 11, fontWeight: 600,
        background: inVoiceSession ? 'var(--ut-gold, #c9a84c)' : 'transparent',
        color: inVoiceSession ? '#000' : 'var(--ut-gold, #c9a84c)',
        border: '1px solid var(--ut-gold, #c9a84c)',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
      aria-label={inVoiceSession
        ? 'End voice conversation'
        : 'Start voice conversation with Compass'}
    >
      {inVoiceSession ? '◉ End call' : <><UIcon name="compass" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Talk</>}
    </button>
  )
}
