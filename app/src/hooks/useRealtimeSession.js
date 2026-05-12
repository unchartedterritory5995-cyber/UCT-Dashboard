import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVoice } from '../context/VoiceContext'
import useReadAloud from './useReadAloud'
import {
  parseRealtimeEvent,
  functionCallOutputEvent,
  responseCreateEvent,
} from '../utils/realtimeEventHandlers'

const SILENCE_TIMEOUT_MS = 60_000
const HEARTBEAT_MS = 30_000

/**
 * Open a Realtime conversation: mic in, model audio out, function calls in,
 * tool results out. Single live session at a time per user.
 *
 * Usage:
 *   const { connect, disconnect, isConnected } = useRealtimeSession()
 *   <button onClick={() => connect('global')}>Talk</button>
 */
function stripHtml(html) {
  if (!html) return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return (tmp.textContent || tmp.innerText || '').trim()
}

// Map a normalized content key (from voice_client_action_tools) to a
// fetch-and-narrate plan. Each entry returns { trackId, label, textProvider }.
function buildReadAloudPlan(contentKey) {
  const key = (contentKey || '').toLowerCase()

  // Morning Wire (rundown HTML)
  if (key.includes('wire') || key.includes('rundown') || key === 'morning wire') {
    return {
      trackId: 'voice-morning-wire',
      label: 'Morning Wire',
      textProvider: async () => {
        const r = await fetch('/api/rundown', { credentials: 'include' })
        if (!r.ok) return ''
        const data = await r.json()
        return stripHtml(data.html || data.rundown_html || '')
      },
    }
  }

  // UCT 20 picks
  if (key.includes('uct') || key.includes('leadership') || key.includes('picks')) {
    return {
      trackId: 'voice-uct20-picks',
      label: 'UCT 20 Picks',
      textProvider: async () => {
        const r = await fetch('/api/leadership', { credentials: 'include' })
        if (!r.ok) return ''
        const rows = await r.json()
        if (!Array.isArray(rows) || rows.length === 0) {
          return "There are no UCT 20 picks loaded right now."
        }
        const parts = rows.slice(0, 10).map((p, i) =>
          `${i + 1}. ${p.sym || p.symbol || '?'} — ${p.company || p.name || ''}. ${p.thesis || ''}`.trim()
        )
        return parts.join('. ')
      },
    }
  }

  // Daily note (today)
  if (key.includes('daily note') || key.includes("today's note") || key === 'my note') {
    return {
      trackId: 'voice-daily-note',
      label: "Today's Daily Note",
      textProvider: async () => {
        const today = new Date().toISOString().slice(0, 10)
        const r = await fetch(`/api/journal/daily/${today}`, { credentials: 'include' })
        if (!r.ok) return ''
        const d = await r.json()
        const fields = [
          ['Premarket thesis', d.premarket_thesis],
          ['Focus list', d.focus_list],
          ['Risk plan', d.risk_plan],
          ['Emotional state', d.emotional_state],
          ['Midday notes', d.midday_notes],
          ['EOD recap', d.eod_recap],
          ['What I did well', d.did_well],
          ['What I did poorly', d.did_poorly],
          ['Learned', d.learned],
          ['Tomorrow focus', d.tomorrow_focus],
        ].filter(([, v]) => v && String(v).trim())
        if (fields.length === 0) return "Your daily note is empty for today."
        return fields.map(([l, v]) => `${l}: ${v}.`).join(' ')
      },
    }
  }

  // Weekly review
  if (key.includes('weekly') || key.includes('week recap')) {
    return {
      trackId: 'voice-weekly-review',
      label: 'Weekly Review',
      textProvider: async () => {
        const today = new Date()
        const day = today.getDay()
        const monday = new Date(today)
        monday.setDate(today.getDate() - ((day + 6) % 7))
        const weekStart = monday.toISOString().slice(0, 10)
        const r = await fetch(`/api/journal/weekly/${weekStart}`, { credentials: 'include' })
        if (!r.ok) return ''
        const d = await r.json()
        const parts = [
          d.reflection, d.key_lessons, d.next_week_focus,
        ].filter(v => v && String(v).trim())
        return parts.length ? parts.join('. ') : "Your weekly review is empty."
      },
    }
  }

  // Morning briefing / closing briefing — call the voice briefing tool, narrate the result
  if (key.includes('morning brief') || key.includes('brief me')) {
    return {
      trackId: 'voice-morning-brief',
      label: 'Morning Briefing',
      textProvider: async () => {
        const r = await fetch('/api/voice/oneshot', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'give me the morning briefing' }),
        })
        if (!r.ok) return ''
        const j = await r.json()
        return j.narration || j.text || ''
      },
    }
  }
  if (key.includes('closing brief') || key.includes('eod recap') || key.includes('closing recap')) {
    return {
      trackId: 'voice-closing-brief',
      label: 'Closing Briefing',
      textProvider: async () => {
        const r = await fetch('/api/voice/oneshot', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'give me the closing briefing' }),
        })
        if (!r.ok) return ''
        const j = await r.json()
        return j.narration || j.text || ''
      },
    }
  }

  return null
}

export default function useRealtimeSession() {
  const voice = useVoice()
  const navigate = useNavigate()
  const readAloud = useReadAloud()
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

    // Client-side actions (navigate, read-aloud, switch-account) are
    // dispatched locally before we feed the result back to the model.
    // The model still sees a success result so it can narrate "opening
    // journal" or "switched to swing" naturally.
    if (result && result.client_action) {
      try {
        const action = result.client_action
        if (action.type === 'navigate' && action.path) {
          navigate(action.path)
        } else if (action.type === 'read_aloud' && action.content) {
          const plan = buildReadAloudPlan(action.content)
          if (plan) {
            readAloud.play(plan).catch((e) =>
              console.error('[voice] read_aloud play failed', e)
            )
          } else {
            console.warn('[voice] no read-aloud plan for content', action.content)
          }
        } else if (action.type === 'switch_account' && action.account_id) {
          localStorage.setItem('uct.j2.selectedAccountId', action.account_id)
          window.dispatchEvent(new StorageEvent('storage', {
            key: 'uct.j2.selectedAccountId',
            newValue: action.account_id,
          }))
        }
      } catch (e) {
        console.error('[voice] client_action dispatch failed', e)
      }
    }

    const dc = dcRef.current
    if (dc?.readyState === 'open') {
      dc.send(JSON.stringify(functionCallOutputEvent({ call_id, output: result })))
      dc.send(JSON.stringify(responseCreateEvent()))
    }
  }, [navigate, readAloud])

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
      // Try GA WebRTC endpoint first, fall back to legacy beta path.
      // GA: POST /v1/realtime/calls?model=...
      // Legacy: POST /v1/realtime?model=... (needs OpenAI-Beta: realtime=v1)
      const sdpHeaders = {
        'Authorization': `Bearer ${tokenResp.client_secret}`,
        'Content-Type': 'application/sdp',
      }
      let sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(tokenResp.model)}`,
        { method: 'POST', body: offer.sdp, headers: sdpHeaders }
      )
      if (!sdpResponse.ok && (sdpResponse.status === 404 || sdpResponse.status === 400)) {
        const gaErr = await sdpResponse.text()
        console.warn('[realtime] GA SDP exchange failed, trying legacy', sdpResponse.status, gaErr)
        sdpResponse = await fetch(
          `https://api.openai.com/v1/realtime?model=${encodeURIComponent(tokenResp.model)}`,
          {
            method: 'POST',
            body: offer.sdp,
            headers: { ...sdpHeaders, 'OpenAI-Beta': 'realtime=v1' },
          }
        )
      }
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

  // Stable unmount-only cleanup. Ref pattern avoids re-firing the effect on
  // every voice-state change (which would cause an infinite disconnect loop).
  const disconnectRef = useRef(null)
  disconnectRef.current = disconnect
  useEffect(() => () => { disconnectRef.current?.() }, [])

  return {
    connect,
    disconnect,
    isConnected: voice.mode === 'c' && voice.status !== 'idle',
  }
}
