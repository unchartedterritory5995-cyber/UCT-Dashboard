import { useEffect, useState } from 'react'
import { useVoice } from '../../context/VoiceContext'
import styles from './TranscriptBubble.module.css'

/**
 * Ephemeral popover above the FloatingOrb.
 * Shows the user's transcribed query + assistant's narration when status is
 * thinking / responding. Auto-fades 2s after the response audio ends.
 */
export default function TranscriptBubble() {
  const voice = useVoice()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (voice.mode !== 'b') {
      setVisible(false)
      return
    }
    const active =
      voice.status === 'listening' ||
      voice.status === 'thinking' ||
      voice.status === 'responding' ||
      voice.status === 'playing'
    if (active) {
      setVisible(true)
      return
    }
    const t = setTimeout(() => setVisible(false), 2000)
    return () => clearTimeout(t)
  }, [voice.mode, voice.status])

  if (!visible) return null
  if (voice.mode !== 'b') return null

  const showThinking = voice.status === 'thinking' && !voice.transcript
  const showListening = voice.status === 'listening'

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
