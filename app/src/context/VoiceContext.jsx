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
  errorMessage: null,
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

  const value = useMemo(() => ({
    ...state,
    attachAudio,
    playUrl,
    pause,
    resume,
    stop,
    setSpeed,
    startListening,
    startThinking,
    startResponding,
  }), [state, attachAudio, playUrl, pause, resume, stop, setSpeed,
       startListening, startThinking, startResponding])

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice must be used inside <VoiceProvider>')
  return ctx
}
