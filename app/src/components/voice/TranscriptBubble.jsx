import { useEffect, useState } from 'react'
import { useVoice } from '../../context/VoiceContext'
import styles from './TranscriptBubble.module.css'

/**
 * Ephemeral transcript popover above the FloatingOrb.
 *
 * Mode B: shows {You: ..., UCT: ...} for the current one-shot exchange.
 * Mode C: shows the last 2-3 turns of the live conversation (user + assistant).
 *
 * Each assistant turn gets thumbs up/down controls. Thumbs-down opens an
 * inline correction input that POSTs to /api/voice/feedback. The correction
 * gets injected into the assistant's instructions on the next session, so
 * mistakes don't repeat.
 */

function FeedbackButtons({ turnText, sessionId }) {
  const [submitted, setSubmitted] = useState(null) // 'up' | 'down' | 'correction'
  const [showInput, setShowInput] = useState(false)
  const [correction, setCorrection] = useState('')

  const submit = async (rating, correction_text = null) => {
    try {
      await fetch('/api/voice/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating, session_id: sessionId, turn_text: turnText,
          correction_text,
        }),
      })
      setSubmitted(correction_text ? 'correction' : rating)
    } catch (e) {
      console.error('[feedback] submit failed', e)
    }
  }

  if (submitted === 'up') return <span className={styles.fbAck}>Thanks</span>
  if (submitted === 'correction') return <span className={styles.fbAck}>Got it</span>
  if (submitted === 'down' && !showInput) return <span className={styles.fbAck}>Noted</span>

  if (showInput) {
    return (
      <div className={styles.fbInputWrap}>
        <label htmlFor="voice-correction-input" className={styles.fbInputLabel}>
          What's the correct answer?
        </label>
        <input
          id="voice-correction-input"
          type="text"
          className={styles.fbInput}
          placeholder="Type the right answer, Enter to save, Esc to cancel"
          value={correction}
          autoFocus
          aria-label="Correction text"
          onChange={(e) => setCorrection(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && correction.trim()) {
              submit('down', correction.trim())
              setShowInput(false)
            } else if (e.key === 'Escape') {
              setShowInput(false)
            }
          }}
        />
      </div>
    )
  }

  return (
    <div className={styles.fbButtons} role="group" aria-label="Rate this response">
      <button
        type="button"
        className={styles.fbBtn}
        title="Good answer"
        aria-label="Good answer — thumbs up"
        onClick={() => submit('up')}
      >
        <span aria-hidden="true">👍</span>
      </button>
      <button
        type="button"
        className={styles.fbBtn}
        title="Bad answer — tell me what was right"
        aria-label="Bad answer — open correction input"
        onClick={() => { setShowInput(true); submit('down') }}
      >
        <span aria-hidden="true">👎</span>
      </button>
    </div>
  )
}

export default function TranscriptBubble() {
  const voice = useVoice()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!voice.mode) {
      setVisible(false)
      return
    }
    const active = voice.status !== 'idle' && voice.status !== 'error'
    if (active) {
      setVisible(true)
      return
    }
    const t = setTimeout(() => setVisible(false), 2000)
    return () => clearTimeout(t)
  }, [voice.mode, voice.status])

  if (!visible) return null
  if (!voice.mode) return null

  const showThinking =
    (voice.mode === 'b' && voice.status === 'thinking' && !voice.transcript) ||
    (voice.mode === 'c' && voice.status === 'connecting')
  const showListening =
    (voice.mode === 'b' && voice.status === 'listening') ||
    (voice.mode === 'c' && voice.status === 'speaking_user')

  if (voice.mode === 'b') {
    return (
      <div className={styles.bubble} role="status" aria-live="polite">
        {showListening && <div className={styles.listening}>Listening…</div>}
        {showThinking && <div className={styles.thinking}>Thinking…</div>}
        {voice.transcript && (
          <div className={styles.you}>
            <span className={styles.tag}>You:</span> {voice.transcript}
          </div>
        )}
        {voice.narration && (
          <div className={styles.assistant}>
            <span className={styles.tag}>UCT:</span> {voice.narration}
            <FeedbackButtons turnText={voice.narration} sessionId={null} />
          </div>
        )}
      </div>
    )
  }

  // Mode C — rolling conversation
  const recent = voice.rollingTranscript?.slice(-3) || []
  return (
    <div className={styles.bubble} role="status" aria-live="polite">
      {showListening && !recent.length && <div className={styles.listening}>Listening…</div>}
      {showThinking && <div className={styles.thinking}>Connecting…</div>}
      {recent.map((turn, i) => (
        <div key={i} className={turn.role === 'user' ? styles.you : styles.assistant}>
          <span className={styles.tag}>{turn.role === 'user' ? 'You:' : 'UCT:'}</span> {turn.text}
          {turn.role === 'assistant' && (
            <FeedbackButtons turnText={turn.text} sessionId={voice.realtimeSessionId} />
          )}
        </div>
      ))}
      {voice.partialAssistant && voice.status === 'speaking_assistant' && (
        <div className={styles.assistant}>
          <span className={styles.tag}>UCT:</span> {voice.partialAssistant}<span className={styles.cursor}>▍</span>
        </div>
      )}
    </div>
  )
}
