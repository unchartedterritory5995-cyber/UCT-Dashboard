import { useVoice } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import AgentPicker from './AgentPicker'
import CompassOrb from './CompassOrb'
import styles from './FloatingOrb.module.css'

/**
 * Floating brand-mark compass orb. Click → starts a Realtime conversation. Click again → ends it.
 *
 * Visual: glass sphere with the UCT compass rose (red North arm, green
 * South arm, gold E/W). State is communicated by the glow ring around the
 * orb and an optional center-hub glyph.
 *
 * - Idle: soft gold breathing halo
 * - Connecting: bearing-tick ring rotates + gold pulse
 * - Connected (idle in session): green halo, hub shows ◉
 * - User speaking: red pulse rings, hub shows pulsing ●
 * - Assistant speaking: brighter green glow, hub shows ◆
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
  let orbState = 'idle'
  let errorGlyph = null
  let label = 'Tap to start a conversation'

  if (voice.mode === 'c') {
    if (status === 'connecting') {
      stateClass = styles.thinking
      orbState = 'thinking'
      label = 'Connecting…'
    } else if (status === 'connected') {
      stateClass = styles.responding
      orbState = 'connected'
      label = 'Connected — say something'
    } else if (status === 'speaking_user') {
      stateClass = styles.listening
      orbState = 'listening'
      label = 'Listening…'
    } else if (status === 'speaking_assistant' || status === 'playing' || status === 'loading') {
      stateClass = styles.responding
      orbState = 'responding'
      label = 'Speaking — tap to stop'
    } else if (status === 'error') {
      stateClass = styles.errored
      orbState = 'idle'
      errorGlyph = '⚠'
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
        <CompassOrb state={orbState} />
        {errorGlyph && <span className={styles.errorBadge}>{errorGlyph}</span>}
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
