import { useVoice } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import AgentPicker from './AgentPicker'
import styles from './FloatingOrb.module.css'

/**
 * Floating mic orb. Click → starts a Realtime conversation. Click again → ends it.
 *
 * - Idle: gold mic icon
 * - Connecting: spinning border + ellipsis
 * - Connected (idle within session): solid green ring + waveform icon
 * - User speaking: pulsing red ring
 * - Assistant speaking: glowing green ring
 *
 * The small graduation-cap button next to the orb opens Train Me mode —
 * a restricted session where every utterance becomes a remembered fact
 * or correction.
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
  const inTrainMode = inSession && voice.sessionContext === 'train_me'
  const onClick = () => (inSession ? disconnect() : connect(context))
  const onTrainClick = () => {
    if (inSession) {
      disconnect()
    } else {
      connect('train_me')
    }
  }

  return (
    <div className={styles.orbCluster}>
      <button
        type="button"
        className={`${styles.orb} ${stateClass} ${inTrainMode ? styles.training : ''}`}
        onClick={onClick}
        aria-label={label}
        title={inTrainMode ? 'In Train Me mode — tap to exit' : label}
      >
        <span className={styles.icon}>{icon}</span>
      </button>
      {!inSession && (
        <button
          type="button"
          className={styles.trainBtn}
          onClick={onTrainClick}
          aria-label="Train Me — teach the assistant a preference"
          title="Train Me — teach me a preference or correction"
        >
          🎓
        </button>
      )}
      {!inSession && <AgentPicker />}
      {inTrainMode && (
        <div className={styles.trainBadge}>Training</div>
      )}
      {inSession && voice.sessionContext && voice.sessionContext !== 'global' && voice.sessionContext !== 'train_me' && (
        <div className={styles.agentBadge}>{voice.sessionContext.replace('_', ' ')}</div>
      )}
    </div>
  )
}
