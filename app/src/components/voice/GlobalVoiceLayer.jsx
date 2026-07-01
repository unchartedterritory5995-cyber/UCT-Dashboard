import { useEffect } from 'react'
import { useVoice } from '../../context/VoiceContext'
import useRealtimeSession from '../../hooks/useRealtimeSession'
import useWakeWord from '../../hooks/useWakeWord'
import usePushToTalkHotkey from '../../hooks/usePushToTalkHotkey'
import useProactiveVoice from '../../hooks/useProactiveVoice'
import AudioPlayerBar from './AudioPlayerBar'
import FloatingOrb from './FloatingOrb'
import TranscriptBubble from './TranscriptBubble'
import VoiceErrorBanner from './VoiceErrorBanner'

/** Global voice UI — must render inside VoiceProvider.
 *
 *  This whole module (and its heavy deps — picovoice wake-word wasm via
 *  useWakeWord, the realtime session client, the audio player) is split into
 *  its own lazy chunk and only fetched for PAID users. The gate lives in
 *  App.jsx (`GlobalVoiceGate`) so free users never download any of it — this
 *  keeps ~MB of voice/wasm code out of the entry bundle for everyone. */
function VoiceMounts() {
  const { wakeEnabled, sessionContext } = useVoice()
  const { connect, disconnect } = useRealtimeSession()
  usePushToTalkHotkey({ context: 'global' })
  useWakeWord({ enabled: wakeEnabled, onWake: () => connect('global') })
  // P4-A: Compass speaks proactive alerts when the user has opted in
  // (Compass Settings → "Compass can speak proactive alerts"). The hook
  // is a no-op when the toggle is off; backend gates the unspoken queue.
  useProactiveVoice()
  // Batch 10a: when an agent emits route_to_agent, start a fresh session
  // in the target agent's context.
  useEffect(() => {
    const onSwitch = (e) => {
      const target = e?.detail?.agent_id
      if (target) {
        setTimeout(() => connect(target), 300)
      }
    }
    window.addEventListener('uct:voice:switch-agent', onSwitch)
    return () => window.removeEventListener('uct:voice:switch-agent', onSwitch)
  }, [connect])
  return (
    <>
      <FloatingOrb context="global" />
      <TranscriptBubble />
      <VoiceErrorBanner
        onRetry={() => connect(sessionContext || 'global')}
        onDismiss={disconnect}
      />
    </>
  )
}

/** Paid-only voice/audio UI. Mounted (lazily) only when the user is paid, so
 *  its cost-incurring hooks (wake word mic, proactive-voice polling, realtime
 *  session) never run for free users. */
export default function GlobalVoiceLayer() {
  return (
    <>
      <VoiceMounts />
      <AudioPlayerBar />
    </>
  )
}
