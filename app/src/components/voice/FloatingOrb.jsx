import { useVoice } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import styles from './FloatingOrb.module.css'

/**
 * Floating mic orb. Click → starts a Realtime conversation. Click again → ends it.
 *
 * - Idle: gold mic icon
 * - Connecting: spinning border + ellipsis
 * - Connected (idle within session): solid green ring + waveform icon
 * - User speaking: pulsing red ring
 * - Assistant speaking: glowing green ring
 */
export default function FloatingOrb({ context = 'global' }) {
  const voice = useVoice()
  const { connect, disconnect } = useRealtimeSession()

  if (voice.mode === 'a' && voice.status === 'playing') return null

  const status = voice.status
  let stateClass = styles.idle
  let icon = '🎤'
  let label = 'Tap to start a conversation'

  if (voice.mode === 'c') {
    if (status === 'connecting') {
      stateClass = styles.thinking
      icon = '…'
      label = 'Connecting…'
    } else if (status === 'connected') {
      stateClass = styles.responding
      icon = '◉'
      label = 'Connected — say something'
    } else if (status === 'speaking_user') {
      stateClass = styles.listening
      icon = '●'
      label = 'Listening…'
    } else if (status === 'speaking_assistant' || status === 'playing' || status === 'loading') {
      stateClass = styles.responding
      icon = '🔊'
      label = 'Speaking — tap to stop'
    } else if (status === 'error') {
      stateClass = styles.idle
      icon = '⚠'
      label = `Error: ${voice.errorMessage || 'unknown'}`
    }
  }

  const inSession = voice.mode === 'c' && status !== 'idle' && status !== 'error'
  const onClick = () => (inSession ? disconnect() : connect(context))

  return (
    <button
      type="button"
      className={`${styles.orb} ${stateClass}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <span className={styles.icon}>{icon}</span>
    </button>
  )
}
