import { useVoice } from '../../context/VoiceContext'
import useOneShot from '../../hooks/useOneShot'
import styles from './FloatingOrb.module.css'

/**
 * Bottom-right always-present voice orb.
 *
 * - Idle: gold mic icon
 * - Listening: pulsing red ring + dot icon
 * - Thinking: spinning border + ellipsis icon
 * - Responding: solid green ring + speaker icon
 *
 * Click to start; click again while listening to stop early.
 */
export default function FloatingOrb({ context = 'global' }) {
  const voice = useVoice()
  const { start } = useOneShot()

  // Hide when busy with a non-Mode-B activity (e.g. read-aloud playing)
  if (voice.mode === 'a' && voice.status === 'playing') {
    return null
  }

  const status = voice.status
  const stateClass =
    status === 'listening' ? styles.listening :
    status === 'thinking' ? styles.thinking :
    status === 'responding' ? styles.responding :
    styles.idle

  const icon =
    status === 'listening' ? '●' :
    status === 'thinking' ? '…' :
    status === 'responding' ? '🔊' :
    '🎤'

  const label =
    status === 'listening' ? 'Listening — tap to stop' :
    status === 'thinking' ? 'Thinking…' :
    status === 'responding' ? 'Responding' :
    'Tap to ask'

  return (
    <button
      type="button"
      className={`${styles.orb} ${stateClass}`}
      onClick={() => start(context)}
      aria-label={label}
      title={label}
    >
      <span className={styles.icon}>{icon}</span>
    </button>
  )
}
