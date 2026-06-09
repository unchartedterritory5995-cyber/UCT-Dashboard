/**
 * CompassAssistButton — 🧭 button that opens a full Realtime voice
 * conversation with Compass, pre-loaded with a surface-specific page hint.
 *
 * Drop this next to a text field, pass `pageHint` describing what the user
 * is looking at, and Compass will speak with that context in mind. Reuses
 * the existing useRealtimeSession + VoiceContext infrastructure — no new
 * backend code. Renders null when no VoiceProvider is mounted (e.g. in
 * component tests rendered without the app shell).
 *
 * Props:
 *   pageHint: string           — describes the current surface/field for Compass
 *   disabled?: bool
 *   label?: string             — button text (default '🧭 Assist')
 *
 * Example:
 *   <CompassAssistButton pageHint="Daily Notes · eod_recap field" />
 */
import { useContext, useCallback } from 'react'
import { VoiceContext, setVoicePageHint } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import { useIsPaid } from '../../context/AuthContext'

export default function CompassAssistButton({ pageHint, disabled = false, label = '🧭 Assist' }) {
  const isPaid = useIsPaid()
  const voice = useContext(VoiceContext)
  // Voice/Compass is a paid, API-cost feature — hidden entirely for free users.
  if (!isPaid) return null
  if (!voice) return null
  return (
    <CompassAssistInner pageHint={pageHint} disabled={disabled} label={label} />
  )
}

/**
 * Inner — only mounts inside a VoiceProvider, so useRealtimeSession (which
 * calls useVoice and would throw without a provider) is safe here.
 */
function CompassAssistInner({ pageHint, disabled, label }) {
  const { connect } = useRealtimeSession()
  const onClick = useCallback(() => {
    if (pageHint) setVoicePageHint(pageHint)
    connect('compass')
  }, [connect, pageHint])

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={pageHint
        ? `Talk to Compass about: ${pageHint}`
        : 'Talk to Compass'}
      aria-label={`Talk to Compass${pageHint ? ` about ${pageHint}` : ''}`}
      style={{
        padding: '4px 10px', fontSize: 11, fontWeight: 600,
        background: 'transparent',
        color: 'var(--ut-gold, #c9a84c)',
        border: '1px solid var(--ut-gold, #c9a84c)',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  )
}
