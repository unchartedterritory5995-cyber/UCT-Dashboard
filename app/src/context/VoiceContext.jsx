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
  wakeEnabled: false,
  errorMessage: null,
  // Batch 6b: which context the active Mode C session was started in.
  // 'global' = normal conversation, 'train_me' = restricted teaching mode.
  sessionContext: null,
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
      return { ...initialState, speed: state.speed, status: 'connecting',
               mode: 'c', sessionContext: action.context || 'global' }
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
      // Only tear down to idle when a Realtime session (mode 'c') is actually
      // what's active. Read-aloud (mode 'a') and one-shot (mode 'b') share this
      // same state machine + <audio> element; a lingering Realtime session's
      // teardown (e.g. its silence timeout) must NOT wipe an active read-aloud.
      // Doing so hid the player bar while the read-aloud <audio> kept playing —
      // bar gone, voice still talking, only fix was closing the tab.
      if (state.mode !== 'c') return state
      return { ...initialState, speed: state.speed }
    case 'c_error':
      return { ...state, status: 'error', mode: 'c', errorMessage: action.message }
    case 'set_wake_enabled':
      return { ...state, wakeEnabled: !!action.enabled }
    default:
      return state
  }
}

// Named export so callers that want to read the context without throwing
// when no provider is mounted can use useContext(VoiceContext) directly.
// (useVoice() below still throws — that's the strict accessor.)
export const VoiceContext = createContext(null)


// ── P4-F: page-hint ref ────────────────────────────────────────────────────
//
// Module-level ref so any component can stash "what the user is looking at
// right now" (e.g. a TickerPopup writes "chart of NVDA") without causing
// re-renders. useRealtimeSession reads this at connect() time and passes
// it to the backend as page_hint, overriding the default pathname.
//
// Usage from a component:
//   import { setVoicePageHint } from '../context/VoiceContext'
//   useEffect(() => {
//     setVoicePageHint(`chart of ${sym}`)
//     return () => setVoicePageHint(null)
//   }, [sym])
//
const _voicePageHintRef = { current: null }

export function setVoicePageHint(hint) {
  _voicePageHintRef.current = (hint && String(hint).trim()) || null
}

export function getVoicePageHint() {
  return _voicePageHintRef.current
}

export function VoiceProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  // Single shared <audio> element managed by AudioPlayerBar — ref is set there
  // via attachAudio(); everyone else just calls play/pause through dispatch helpers.
  const audioRef = useRef(null)

  const attachAudio = useCallback((el) => {
    audioRef.current = el
  }, [])

  // Monotonic playback generation. Read-aloud is a two-step flow — an async
  // POST /tts/prepare, THEN playUrl() — and on a cold clip the prepare leg can
  // take seconds. Every intentional interrupt (stop, or switching into another
  // voice mode) bumps this counter so a chain that resolves LATER can tell its
  // playback was cancelled and must not start. Without it, pressing Stop while
  // a clip was preparing did nothing and the voice began talking afterwards —
  // from the saved position, i.e. halfway through the brief, with the bar gone.
  const playGenRef = useRef(0)
  const getPlayGen = useCallback(() => playGenRef.current, [])
  const cancelPending = useCallback(() => { playGenRef.current += 1 }, [])

  // Read-aloud replay: useReadAloud registers a closure that re-reads the
  // current track (optionally overriding voice/speed). The AudioPlayerBar's
  // voice picker calls it so changing the reader's voice re-synthesizes the
  // same text. Kept in a ref so registering doesn't trigger re-renders.
  const readAloudReplayRef = useRef(null)
  const registerReadAloud = useCallback((fn) => {
    readAloudReplayRef.current = fn
  }, [])
  const replayReadAloud = useCallback((overrides) => {
    const fn = readAloudReplayRef.current
    if (typeof fn === 'function') fn(overrides || {})
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

  // Guarded play for callers that fetch their audio asynchronously (proactive
  // insights, hands-free recaps, the J2 verdict/review cards). They all had the
  // same shape as the read-aloud bug: fetch TTS for seconds, then play
  // unconditionally — so a Stop pressed mid-fetch was ignored and the voice
  // started afterwards. Capture voice.getPlayGen() BEFORE the fetch and play
  // through this; if anything cancelled or superseded meanwhile, it no-ops.
  // Deliberately does not touch state (no bar during their fetch) so these
  // dormant paths keep their existing flow — it only prevents late playback.
  const playWhenCurrent = useCallback(async (gen, opts) => {
    if (playGenRef.current !== gen) return false
    await playUrl(opts)
    return true
  }, [playUrl])

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

  // Stop whatever the shared <audio> element is doing — a read-aloud `src`
  // URL OR a Realtime/one-shot MediaStream `srcObject`. Called on stop and
  // whenever we switch INTO another voice mode, so a previous read-aloud can
  // never keep playing underneath the new mode (orphaned audio).
  const haltAudioEl = useCallback(() => {
    const halt = (el) => {
      if (!el) return
      try { el.pause() } catch { /* ignore */ }
      try { if (el.srcObject) el.srcObject = null } catch { /* ignore */ }
      // removeAttribute + load(), NOT src = ''. Assigning the empty string
      // resolves against the DOCUMENT url, so the browser tries to load the
      // page itself as media and fires a bogus 'error' event (verified in
      // Chrome). That stray error reaches AudioPlayerBar's reset handler,
      // which calls stop() — which would then cancel the NEXT read-aloud
      // while it was still preparing.
      try { el.removeAttribute('src') } catch { /* ignore */ }
      try { el.load() } catch { /* ignore */ }
    }
    halt(audioRef.current)
    // Defense in depth: halting used to depend SOLELY on audioRef, so it
    // silently no-op'd whenever the ref was null or pointed at a different
    // element than the one actually playing — while the state still went idle
    // and hid the player bar, stranding audio the user could no longer stop.
    // Stopping must never be best-effort: sweep every element the voice layer
    // owns (tagged by AudioPlayerBar). Scoped by attribute so we never touch
    // unrelated media — Desk videos, earnings-call audio, etc.
    if (typeof document !== 'undefined') {
      try {
        document.querySelectorAll('audio[data-uct-voice-audio]').forEach((el) => {
          if (el !== audioRef.current) halt(el)
        })
      } catch { /* ignore */ }
    }
    // Browser-native TTS (Compass chat, earnings-call Listen) is a SEPARATE
    // audio system — it never touches the shared <audio>, so stopping the
    // element left it talking with no visible control. "Stop" must mean stop.
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try { window.speechSynthesis.cancel() } catch { /* ignore */ }
    }
  }, [])

  // Enter the 'loading' state BEFORE the async TTS prepare leg, so the player
  // bar — and therefore a Stop control — is on screen while a cold clip
  // synthesizes. Previously the state stayed 'idle' for that whole window, so
  // the user had nothing to cancel with and no feedback that anything started.
  const beginLoad = useCallback(({ trackId, trackLabel }) => {
    // Halt the OLD clip before re-labelling the store. Without this the
    // previous track keeps playing through the new track's prepare, and the
    // shared element's events then land under the WRONG identity:
    //   - its 'ended'/'error' hit reset() -> stop() -> generation bump, which
    //     silently cancelled the read that was still preparing, and
    //   - its 'timeupdate'/'pause' wrote the old clip's position under the NEW
    //     trackId's localStorage key, so the next play of THAT track resumed
    //     from a position it never reached.
    haltAudioEl()
    // Bump after halting: starting a new read supersedes any chain still
    // preparing, so an older clip can't land afterwards and talk over the new one.
    playGenRef.current += 1
    // The replay closure belongs to the outgoing track — drop it so the voice
    // picker can't re-read the previous clip while this one is preparing.
    readAloudReplayRef.current = null
    dispatch({ type: 'load', trackId, trackLabel })
    return playGenRef.current
  }, [haltAudioEl])

  const stop = useCallback(() => {
    cancelPending()
    haltAudioEl()
    readAloudReplayRef.current = null
    dispatch({ type: 'stop' })
  }, [haltAudioEl, cancelPending])

  const setSpeed = useCallback((speed) => {
    if (audioRef.current) audioRef.current.playbackRate = speed
    dispatch({ type: 'setSpeed', speed })
  }, [])

  // Starting a one-shot or Realtime session is an intentional interrupt — halt
  // any read-aloud first so it doesn't keep playing under the new mode.
  const startListening = useCallback(() => {
    cancelPending()
    haltAudioEl()
    dispatch({ type: 'b_listening' })
  }, [haltAudioEl, cancelPending])
  const startThinking = useCallback(() => dispatch({ type: 'b_thinking' }), [])
  const startResponding = useCallback(({ transcript, narration }) =>
    dispatch({ type: 'b_responding', transcript, narration }), [])

  const beginRealtime = useCallback((context = 'global') => {
    cancelPending()
    haltAudioEl()
    dispatch({ type: 'c_connecting', context })
  }, [haltAudioEl, cancelPending])
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

  const setWakeEnabled = useCallback((enabled) =>
    dispatch({ type: 'set_wake_enabled', enabled }), [])

  const value = useMemo(() => ({
    ...state,
    attachAudio, playUrl, playStream, playWhenCurrent, pause, resume, stop, setSpeed,
    beginLoad, getPlayGen, cancelPending,
    registerReadAloud, replayReadAloud,
    startListening, startThinking, startResponding,
    beginRealtime, realtimeConnected, realtimeUserTurn,
    realtimeAssistantPartial, realtimeAssistantDone,
    realtimeDisconnect, realtimeError,
    setWakeEnabled,
  }), [state, attachAudio, playUrl, playStream, playWhenCurrent, pause, resume, stop, setSpeed,
       beginLoad, getPlayGen, cancelPending,
       registerReadAloud, replayReadAloud,
       startListening, startThinking, startResponding,
       beginRealtime, realtimeConnected, realtimeUserTurn,
       realtimeAssistantPartial, realtimeAssistantDone,
       realtimeDisconnect, realtimeError, setWakeEnabled])

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

export function useVoice() {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice must be used inside <VoiceProvider>')
  return ctx
}
