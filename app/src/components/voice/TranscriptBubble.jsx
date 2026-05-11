import { useEffect, useState } from 'react'
import { useVoice } from '../../context/VoiceContext'
import styles from './TranscriptBubble.module.css'

/**
 * Ephemeral transcript popover above the FloatingOrb.
 *
 * Mode B: shows {You: ..., UCT: ...} for the current one-shot exchange.
 * Mode C: shows the last 2-3 turns of the live conversation (user + assistant).
 */
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
