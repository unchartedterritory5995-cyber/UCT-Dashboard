import { useCallback, useEffect, useRef } from 'react'
import { useVoice } from '../context/VoiceContext'
import {
  parseRealtimeEvent,
  functionCallOutputEvent,
  responseCreateEvent,
} from '../utils/realtimeEventHandlers'

const SILENCE_TIMEOUT_MS = 8_000
const HEARTBEAT_MS = 30_000

/**
 * Open a Realtime conversation: mic in, model audio out, function calls in,
 * tool results out. Single live session at a time per user.
 *
 * Usage:
 *   const { connect, disconnect, isConnected } = useRealtimeSession()
 *   <button onClick={() => connect('global')}>Talk</button>
 */
export default function useRealtimeSession() {
  const voice = useVoice()
  const pcRef = useRef(null)
  const dcRef = useRef(null)
  const localStreamRef = useRef(null)
  const sessionRef = useRef({ id: null, openaiId: null, startedAt: 0 })
  const silenceTimerRef = useRef(null)
  const heartbeatTimerRef = useRef(null)

  const cleanup = useCallback(async () => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
    if (heartbeatTimerRef.current) { clearInterval(heartbeatTimerRef.current); heartbeatTimerRef.current = null }
    try { dcRef.current?.close?.() } catch {}
    try { pcRef.current?.close?.() } catch {}
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
    }
    pcRef.current = null
    dcRef.current = null
    localStreamRef.current = null
  }, [])

  const endSessionOnServer = useCallback(async () => {
    const sess = sessionRef.current
    if (!sess.id) return
    const duration = Math.max(0, Math.round((Date.now() - sess.startedAt) / 1000))
    try {
      await fetch('/api/voice/session/end', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sess.id, duration_seconds: duration }),
      })
    } catch (e) {
      console.warn('[useRealtimeSession] end-session failed', e)
    }
    sessionRef.current = { id: null, openaiId: null, startedAt: 0 }
  }, [])

  const disconnect = useCallback(async () => {
    await cleanup()
    await endSessionOnServer()
    voice.realtimeDisconnect()
  }, [cleanup, endSessionOnServer, voice])

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = setTimeout(() => {
      console.log('[useRealtimeSession] silence timeout — disconnecting')
      disconnect()
    }, SILENCE_TIMEOUT_MS)
  }, [disconnect])

  const sendTranscriptToServer = useCallback(async (role, text) => {
    const sid = sessionRef.current.id
    if (!sid || !text) return
    try {
      await fetch('/api/voice/transcript', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, role, text }),
      })
    } catch {}
  }, [])

  const handleFunctionCall = useCallback(async ({ call_id, name, arguments_json }) => {
    const sid = sessionRef.current.id
    let args = {}
    try { args = JSON.parse(arguments_json || '{}') } catch {}
    let result
    try {
      const r = await fetch('/api/voice/exec', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid, tool: name, args }),
      })
      result = await r.json()
    } catch (e) {
      result = { ok: false, error: e?.message || 'fetch failed' }
    }

    const dc = dcRef.current
    if (dc?.readyState === 'open') {
      dc.send(JSON.stringify(functionCallOutputEvent({ call_id, output: result })))
      dc.send(JSON.stringify(responseCreateEvent()))
    }
  }, [])

  const onChannelMessage = useCallback((event) => {
    const parsed = parseRealtimeEvent(event.data)
    switch (parsed.kind) {
      case 'session_created':
        break
      case 'user_transcript':
        voice.realtimeUserTurn(parsed.text)
        sendTranscriptToServer('user', parsed.text)
        resetSilenceTimer()
        break
      case 'assistant_transcript_delta':
        voice.realtimeAssistantPartial(parsed.delta)
        resetSilenceTimer()
        break
      case 'assistant_transcript_done':
        voice.realtimeAssistantDone(parsed.text)
        sendTranscriptToServer('assistant', parsed.text)
        resetSilenceTimer()
        break
      case 'function_call':
        handleFunctionCall(parsed).catch((e) => console.error('[function_call] failed', e))
        resetSilenceTimer()
        break
      case 'error':
        console.error('[realtime] error event', parsed.message)
        voice.realtimeError(parsed.message)
        break
      default:
        break
    }
  }, [voice, handleFunctionCall, resetSilenceTimer, sendTranscriptToServer])

  const connect = useCallback(async (context = 'global') => {
    if (pcRef.current) {
      await disconnect()
      return
    }

    voice.beginRealtime()

    let tokenResp
    try {
      const r = await fetch('/api/voice/session_token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
      })
      if (!r.ok) {
        if (r.status === 402) alert('Voice features require a paid plan.')
        else if (r.status === 429) alert('Monthly conversation cap reached.')
        else if (r.status === 503) alert('Voice service is misconfigured (server log will explain).')
        else console.error('[realtime] token fetch returned', r.status)
        voice.realtimeDisconnect()
        return
      }
      tokenResp = await r.json()
    } catch (e) {
      console.error('[realtime] token fetch failed', e)
      voice.realtimeDisconnect()
      return
    }

    sessionRef.current = {
      id: tokenResp.session_id,
      openaiId: tokenResp.openai_session_id,
      startedAt: Date.now(),
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      alert('Microphone permission is required.')
      voice.realtimeDisconnect()
      await endSessionOnServer()
      return
    }
    localStreamRef.current = stream

    const pc = new RTCPeerConnection()
    pcRef.current = pc

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams
      voice.playStream({
        stream: remoteStream,
        trackId: `realtime-${Date.now()}`,
        trackLabel: 'Live conversation',
      })
    }

    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    const dc = pc.createDataChannel('oai-events')
    dcRef.current = dc
    dc.addEventListener('open', () => {
      voice.realtimeConnected({
        sessionId: tokenResp.session_id,
        openaiSessionId: tokenResp.openai_session_id,
      })
      resetSilenceTimer()
    })
    dc.addEventListener('message', onChannelMessage)
    dc.addEventListener('close', () => {
      console.log('[realtime] data channel closed')
    })

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(tokenResp.model)}`,
        {
          method: 'POST',
          body: offer.sdp,
          headers: {
            'Authorization': `Bearer ${tokenResp.client_secret}`,
            'Content-Type': 'application/sdp',
          },
        }
      )
      if (!sdpResponse.ok) {
        const errText = await sdpResponse.text()
        throw new Error(`SDP exchange failed: ${sdpResponse.status} ${errText}`)
      }
      const answerSdp = await sdpResponse.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    } catch (e) {
      console.error('[realtime] SDP exchange failed', e)
      voice.realtimeError(e.message || 'connection failed')
      await cleanup()
      await endSessionOnServer()
      return
    }

    heartbeatTimerRef.current = setInterval(() => {
      // No-op for now; future "ping" event over data channel could go here
    }, HEARTBEAT_MS)
  }, [voice, disconnect, endSessionOnServer, cleanup, onChannelMessage, resetSilenceTimer])

  useEffect(() => () => { disconnect() }, [disconnect])

  return {
    connect,
    disconnect,
    isConnected: voice.mode === 'c' && voice.status !== 'idle',
  }
}
