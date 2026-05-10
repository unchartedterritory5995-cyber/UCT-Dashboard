import { createContext, useContext, useReducer, useRef, useCallback, useMemo } from 'react'

/**
 * Global voice store. Slice 1 only manages a single shared <audio> element
 * for read-aloud playback. Slice 2+ will extend to one-shot + Realtime modes.
 *
 * State shape:
 *   {
 *     status: 'idle' | 'loading' | 'playing' | 'paused' | 'listening' | 'thinking' | 'responding' | 'error',
 *     trackId: string | null,    // identifies which ReadAloudButton is "playing"
 *     trackLabel: string | null, // shown in player bar
 *     mode: 'a' | 'b' | null,   // 'a' = read-aloud, 'b' = one-shot
 *     transcript: string,        // Mode B: user's spoken input
 *     narration: string,         // Mode B: generated response text
 *     speed: number,
 *     errorMessage: string | null,
 *   }
 */

const initialState = {
  status: 'idle',
  // Slice 1: TTS read-aloud track
  trackId: null,
  trackLabel: null,
  // Slice 2: One-shot Mode B
  mode: null,
  transcript: '',
  narration: '',
  speed: 1.0,
  // Slice 4: Realtime conversational mode (Mode C)
  realtimeSessionId: null,
  realtimeOpenaiSessionId: null,
  rollingTranscript: [],
  partialAssistant: '',
  errorMessage: null,
}

function appendTurn(rolling, role, text) {
  if (!text) return rolling
  const next = [...rolling, { role, text }]
  return next.slice(-10)
}

function reducer(state, action) {
  switch (action.type) {
    case 'load':
      return {
        ...state, status: 'loading', mode: 'a',
        trackId: action.trackId, trackLabel: action.trackLabel,
        errorMessage: null, transcript: '', narration: '',
      }
    case 'play':
      return { ...state, status: 'playing' }
    case 'pause':
      return { ...state, status: 'paused' }
    case 'stop':
      return { ...initialState, speed: state.speed }
    case 'error':
      return { ...state, status: 'error', errorMessage: action.message }
    case 'setSpeed':
      return { ...state, speed: action.speed }
    case 'b_listening':
      return { ...initialState, speed: state.speed, status: 'listening', mode: 'b' }
    case 'b_thinking':
      return { ...state, status: 'thinking', mode: 'b' }
    case 'b_responding':
      return {
        ...state, status: 'responding', mode: 'b',
        transcript: action.transcript || '', narration: action.narration || '',
      }
    // Mode C (Slice 4)
    case 'c_connecting':
      return { ...initialState, speed: state.speed, status: 'connecting', mode: 'c' }
    case 'c_connected':
      return {
        ...state, status: 'connected', mode: 'c',
        realtimeSessionId: action.sessionId,
        realtimeOpenaiSessionId: action.openaiSessionId,
      }
    case 'c_user_turn':
      return {
        ...state, status: 'speaking_user', mode: 'c',
        transcript: action.text || '',
        rollingTranscript: appendTurn(state.rollingTranscript, 'user', action.text),
      }
    case 'c_assistant_partial':
      return { ...state, status: 'speaking_assistant', mode: 'c',
               partialAssistant: (state.partialAssistant || '') + (action.delta || '') }
    case 'c_assistant_done':
      return {
        ...state, mode: 'c', partialAssistant: '',
        narration: action.text || '',
        rollingTranscript: appendTurn(state.rollingTranscript, 'assistant', action.text),
      }
    case 'c_disconnect':
      return { ...initialState, speed: state.speed }
    case 'c_error':
      return { ...state, status: 'error', mode: 'c', errorMessage: action.message }
    default:
      return state
  }
}

const VoiceContext = createContext(null)

export function VoiceProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  // Single shared <audio> element managed by AudioPlayerBar — ref is set there
  // via attachAudio(); everyone else just calls play/pause through dispatch helpers.
  const audioRef = useRef(null)

  const attachAudio = useCallback((el) => {
    audioRef.current = el
  }, [])

  const playUrl = useCallback(async ({ url, trackId, trackLabel }) => {
    dispatch({ type: 'load', trackId, trackLabel })
    const el = audioRef.current
    if (!el) {
      dispatch({ type: 'error', message: 'Audio element not ready' })
      return
    }
    try {
      el.src = url
      el.playbackRate = state.speed
      await el.play()
      dispatch({ type: 'play' })
    } catch (err) {
      dispatch({ type: 'error', message: err.message || 'Playback failed' })
    }
  }, [state.speed])

  const playStream = useCallback(async ({ stream, trackId, trackLabel }) => {
    dispatch({ type: 'load', trackId, trackLabel })
    const el = audioRef.current
    if (!el) {
      dispatch({ type: 'error', message: 'Audio element not ready' })
      return
    }
    try {
      el.srcObject = stream
      el.playbackRate = 1.0
      await el.play()
      dispatch({ type: 'play' })
    } catch (err) {
      dispatch({ type: 'error', message: err.message || 'Stream playback failed' })
    }
  }, [])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    dispatch({ type: 'pause' })
  }, [])

  const resume = useCallback(async () => {
    try {
      await audioRef.current?.play()
      dispatch({ type: 'play' })
    } catch (err) {
      dispatch({ type: 'error', message: err.message })
    }
  }, [])

  const stop = useCallback(() => {
    const el = audioRef.current
    if (el) {
      el.pause()
      el.src = ''
    }
    dispatch({ type: 'stop' })
  }, [])

  const setSpeed = useCallback((speed) => {
    if (audioRef.current) audioRef.current.playbackRate = speed
    dispatch({ type: 'setSpeed', speed })
  }, [])

  const startListening = useCallback(() => dispatch({ type: 'b_listening' }), [])
  const startThinking = useCallback(() => dispatch({ type: 'b_thinking' }), [])
  const startResponding = useCallback(({ transcript, narration }) =>
    dispatch({ type: 'b_responding', transcript, narration }), [])

  const beginRealtime = useCallback(() => dispatch({ type: 'c_connecting' }), [])
  const realtimeConnected = useCallback(({ sessionId, openaiSessionId }) =>
    dispatch({ type: 'c_connected', sessionId, openaiSessionId }), [])
  const realtimeUserTurn = useCallback((text) =>
    dispatch({ type: 'c_user_turn', text }), [])
  const realtimeAssistantPartial = useCallback((delta) =>
    dispatch({ type: 'c_assistant_partial', delta }), [])
  const realtimeAssistantDone = useCallback((text) =>
    dispatch({ type: 'c_assistant_done', text }), [])
  const realtimeDisconnect = useCallback(() => dispatch({ type: 'c_disconnect' }), [])
  const realtimeError = useCallback((message) => dispatch({ type: 'c_error', message }), [])

  const value = useMemo(() => ({
    ...state,
    attachAudio, playUrl, playStream, pause, resume, stop, setSpeed,
    startListening, startThinking, startResponding,
    beginRealtime, realtimeConnected, realtimeUserTurn,
    realtimeAssistantPartial, realtimeAssistantDone,
    realtimeDisconnect, realtimeError,
  }), [state, attachAudio, playUrl, playStream, pause, resume, stop, setSpeed,
       startListening, startThinking, startResponding,
       beginRealtime, realtimeConnected, realtimeUserTurn,
       realtimeAssistantPartial, realtimeAssistantDone,
       realtimeDisconnect, realtimeError])

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice must be used inside <VoiceProvider>')
  return ctx
}
