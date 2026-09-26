/**
 * VoiceInputButton — push-to-talk dictation for any text field.
 *
 * Primary path: MediaRecorder → POST /api/voice/transcribe (OpenAI Whisper).
 * Fallback path: window.SpeechRecognition (browser-native, free, lower
 * accuracy on tickers/jargon). Falls back automatically when MediaRecorder
 * is unavailable OR the backend transcribe call fails.
 *
 * Props:
 *   onTranscript(text: string): void   — called when a transcript is ready
 *   disabled?: bool
 *   cleanup?: bool                     — request gpt-4o-mini cleanup pass
 *                                        (filler removal, ticker fixes,
 *                                        punctuation). Default true. Only
 *                                        applies to the Whisper path.
 *   holdOnFailure?: bool               — wave 7 fix round 1 (review I-4),
 *                                        OPT-IN, default false. When the
 *                                        transcription fails, KEEP the member's
 *                                        recording, say WHY in a sentence
 *                                        (monthly cap, plan, network...), and
 *                                        offer Try again / Discard -- plus the
 *                                        browser's own speech as a VISIBLE
 *                                        choice, never an automatic switch.
 *                                        ⚰️ The default path throws the audio
 *                                        away and silently starts Web Speech
 *                                        (a pure no-op where there is none,
 *                                        e.g. Firefox): the member's words are
 *                                        gone without a trace. The Notebook
 *                                        editor opts in; the four other callers
 *                                        keep today's behaviour until they do.
 *
 * Ref (optional — wave 7 lane H1, ADDITIVE): `{ start(), available }`.
 *   start()   — begin listening exactly as a click on the mic would. Returns
 *               false (and does nothing) when this member cannot dictate here
 *               (unpaid, no browser support, disabled, or already busy), so a
 *               caller can say so instead of failing silently.
 *   available — whether this member and browser can dictate at all.
 * The Notebook's slash "Dictate" item has no button of its own to click; it
 * asks the toolbar mic of ITS editor to start. Every existing caller passes no
 * ref and renders exactly as before (VoiceInputButton.ref.test.jsx rails it).
 */
import { forwardRef, useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react'
import { useIsPaid } from '../../../context/AuthContext'
import UIcon from '../../../components/ui/UIcon'

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined' && typeof global === 'undefined') return null
  const root = typeof window !== 'undefined' ? window : global
  return root.SpeechRecognition || root.webkitSpeechRecognition || null
}

function hasMediaRecorder() {
  const root = typeof window !== 'undefined' ? window : global
  return !!root.MediaRecorder
    && !!root.navigator?.mediaDevices?.getUserMedia
}

// One-time discoverability hint. Shown once ever across all surfaces, gated
// by a single localStorage flag. Dismissed by the X button OR first voice use.
const HINT_KEY = 'voice.dictation.hintSeen'

function hintAlreadySeen() {
  try { return localStorage.getItem(HINT_KEY) === '1' } catch { return true }
}

function markHintSeen() {
  try { localStorage.setItem(HINT_KEY, '1') } catch { /* ignore */ }
}

// ── holdOnFailure: what went wrong, in the member's words ───────────────────
// Every sentence says WHY and that nothing was added (the kept recording is the
// member's to retry or discard). `/api/voice/transcribe` answers 429 for the
// monthly dictation cap AND for its 60-a-minute rate limit, 402 when the plan
// does not include voice, 400 when voice is off in settings; anything else is
// the server's failure.
const KEPT = 'Nothing was added — your recording is kept.'
export const FAILURE_SENTENCES = {
  cap: { sentence: `You've used this month's dictation. ${KEPT}` },
  rate: { sentence: `Too many dictations in a minute. ${KEPT} Try again in a moment.` },
  plan: { sentence: `Dictation isn't included in your plan. ${KEPT}` },
  disabled: { sentence: `Voice is turned off in your settings. ${KEPT}` },
  network: { sentence: `Couldn't reach the server. ${KEPT}` },
  server: { sentence: `Couldn't transcribe that. ${KEPT}` },
  microphone: { sentence: "Couldn't use the microphone — allow it for this site in your browser, then try again." },
}

export function transcribeFailureSentence(status, detail) {
  const said = String(detail || '').toLowerCase()
  if (status === 429) return said.includes('monthly') ? FAILURE_SENTENCES.cap : FAILURE_SENTENCES.rate
  if (status === 402) return FAILURE_SENTENCES.plan
  if (status === 400 && said.includes('disabled')) return FAILURE_SENTENCES.disabled
  return FAILURE_SENTENCES.server
}

const FAILURE_BUTTON = {
  background: 'transparent', color: 'var(--text-bright)',
  border: '1px solid var(--border)', borderRadius: 6,
  padding: '4px 10px', fontSize: 12, cursor: 'pointer',
  minHeight: 'var(--tap-min)', display: 'inline-flex', alignItems: 'center',
}

const VoiceInputButton = forwardRef(function VoiceInputButton(
  { onTranscript, disabled = false, cleanup = true, holdOnFailure = false }, ref,
) {
  const isPaid = useIsPaid()
  const SR = getSpeechRecognitionCtor()
  const whisperAvailable = hasMediaRecorder()
  const webSpeechAvailable = !!SR
  const supported = whisperAvailable || webSpeechAvailable

  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  // holdOnFailure: the sentence on screen, and the recording it is about.
  const [failure, setFailure] = useState(null)
  const heldBlobRef = useRef(null)
  const clearHeld = useCallback(() => {
    heldBlobRef.current = null
    setFailure(null)
  }, [])
  const [showHint, setShowHint] = useState(() => supported && !hintAlreadySeen())

  const dismissHint = useCallback(() => {
    markHintSeen()
    setShowHint(false)
  }, [])

  // Whisper path refs
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const streamRef = useRef(null)
  // Web Speech path refs
  const recognitionRef = useRef(null)
  const transcriptRef = useRef('')

  const stopRecording = useCallback(() => {
    // Stop MediaRecorder if active
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop() } catch { /* ignore */ }
    }
    // Stop SpeechRecognition if active
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* ignore */ }
    }
    // Stop mic stream
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
      streamRef.current = null
    }
    setRecording(false)
  }, [])

  useEffect(() => {
    return () => stopRecording()
  }, [stopRecording])

  const startWebSpeech = useCallback(() => {
    if (!SR) return false
    transcriptRef.current = ''
    const r = new SR()
    r.continuous = false
    r.interimResults = true
    r.lang = 'en-US'
    r.onresult = (event) => {
      let finalText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i]
        if (res.isFinal) finalText += res[0].transcript
      }
      if (finalText) transcriptRef.current += finalText
    }
    r.onerror = () => stopRecording()
    r.onend = () => {
      setRecording(false)
      const text = transcriptRef.current.trim()
      if (text && onTranscript) {
        onTranscript(text)
        clearHeld()               // the member's words landed; the kept recording is spent
      }
    }
    recognitionRef.current = r
    setRecording(true)
    try { r.start(); return true } catch { setRecording(false); return false }
  }, [SR, onTranscript, stopRecording, clearHeld])

  const uploadAudioToWhisper = useCallback(async (blob) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('audio', blob, 'audio.webm')
      form.append('cleanup', cleanup ? 'true' : 'false')
      const resp = await fetch('/api/voice/transcribe', {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!resp.ok) {
        if (holdOnFailure) {
          const body = await resp.json().catch(() => ({}))
          heldBlobRef.current = blob
          setFailure(transcribeFailureSentence(resp.status, body?.detail))
          return
        }
        // Fallback: try Web Speech if we have it
        if (webSpeechAvailable) startWebSpeech()
        return
      }
      const data = await resp.json()
      const text = (data?.text || '').trim()
      if (holdOnFailure) clearHeld()
      if (text && onTranscript) onTranscript(text)
    } catch {
      if (holdOnFailure) {
        heldBlobRef.current = blob
        setFailure(FAILURE_SENTENCES.network)
        return
      }
      if (webSpeechAvailable) startWebSpeech()
    } finally {
      setUploading(false)
    }
  }, [onTranscript, webSpeechAvailable, startWebSpeech, cleanup, holdOnFailure, clearHeld])

  const startWhisper = useCallback(async () => {
    audioChunksRef.current = []
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      if (holdOnFailure) { setFailure(FAILURE_SENTENCES.microphone); return }
      if (webSpeechAvailable) startWebSpeech()
      return
    }
    streamRef.current = stream
    let rec
    try {
      rec = new window.MediaRecorder(stream)
    } catch {
      if (webSpeechAvailable) startWebSpeech()
      return
    }
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data)
    }
    rec.onstop = () => {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      audioChunksRef.current = []
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
        streamRef.current = null
      }
      setRecording(false)
      if (blob.size > 0) uploadAudioToWhisper(blob)
    }
    rec.onerror = () => stopRecording()
    mediaRecorderRef.current = rec
    setRecording(true)
    try { rec.start() } catch { setRecording(false) }
  }, [webSpeechAvailable, startWebSpeech, stopRecording, uploadAudioToWhisper, holdOnFailure])

  const startRecording = useCallback(() => {
    if (!supported || disabled) return
    dismissHint()
    // A NEW recording replaces a kept one: the member chose to say it again.
    clearHeld()
    if (whisperAvailable) startWhisper()
    else if (webSpeechAvailable) startWebSpeech()
  }, [supported, disabled, dismissHint, clearHeld, whisperAvailable, webSpeechAvailable, startWhisper, startWebSpeech])

  const toggle = useCallback(() => {
    if (recording) stopRecording()
    else startRecording()
  }, [recording, stopRecording, startRecording])

  // Wave 7 lane H1 — the imperative door (see the header). ⛔ It refuses
  // exactly where the button itself would render nothing or refuse a click, so
  // a caller that starts dictation without a click can never start what a
  // click could not.
  const available = Boolean(isPaid && supported)
  useImperativeHandle(ref, () => ({
    available,
    start: () => {
      if (!available || disabled || recording || uploading) return false
      startRecording()
      return true
    },
  }), [available, disabled, recording, uploading, startRecording])

  // Voice dictation hits the paid Whisper transcription endpoint — hidden
  // entirely for free users (placed after all hooks to respect rules-of-hooks).
  if (!isPaid) return null

  if (!supported) {
    return (
      <button
        type="button"
        aria-label="Voice not supported in this browser"
        title="Voice not supported in this browser (try Chrome or Edge)"
        disabled
        style={{
          padding: '6px 10px', fontSize: 14,
          background: 'transparent', color: 'var(--text-muted)',
          border: '1px solid var(--border)', borderRadius: 6,
          cursor: 'not-allowed', opacity: 0.5,
        }}
      >
        <UIcon name="mic" size={14} />
      </button>
    )
  }

  const showStatus = recording || uploading
  const statusText = uploading ? 'Transcribing…' : 'Listening…'
  const retryHeld = () => { if (heldBlobRef.current) uploadAudioToWhisper(heldBlobRef.current) }
  const showFailure = Boolean(failure) && !recording && !uploading

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {showHint && !recording && !uploading && (
        <span
          role="status"
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
            zIndex: 20, width: 230,
            background: 'var(--bg-base, #1a1a1a)',
            border: '1px solid var(--ut-gold, #c9a84c)',
            borderRadius: 6, padding: '8px 10px',
            fontSize: 11, lineHeight: 1.45, color: 'var(--text-bright)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <strong style={{ color: 'var(--ut-gold, #c9a84c)' }}><UIcon name="mic" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />New:</strong>{' '}
          speak instead of type. Tap the mic to dictate, or <UIcon name="compass" size={11} style={{ verticalAlign: '-1px' }} /> to talk through it with Compass.
          <button
            type="button"
            aria-label="Dismiss tip"
            onClick={dismissHint}
            style={{
              position: 'absolute', top: -6, right: -4,
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer',
              fontSize: 13, lineHeight: 1, padding: 2,
              // audited 17x19 — an unhittable dismiss keeps the tip up forever
              minWidth: 'var(--tap-min)', minHeight: 'var(--tap-min)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <UIcon name="x" size={13} />
          </button>
        </span>
      )}
      <button
        type="button"
        aria-label={recording ? 'Stop voice input' : 'Start voice input'}
        title={recording
          ? 'Stop recording (click)'
          : (whisperAvailable
              ? 'Voice input — high accuracy (Whisper)'
              : 'Voice input (browser STT)')}
        onClick={toggle}
        disabled={disabled || uploading}
        style={{
          padding: '6px 10px', fontSize: 14,
          background: recording ? '#ef4444' : 'transparent',
          color: recording ? '#fff' : 'var(--text-bright)',
          border: `1px solid ${recording ? '#ef4444' : 'var(--border)'}`,
          borderRadius: 6,
          cursor: (disabled || uploading) ? 'not-allowed' : 'pointer',
          animation: recording ? 'compass-pulse 1.2s ease-in-out infinite' : 'none',
          opacity: uploading ? 0.6 : 1,
          // Inline styles can't media-query; the tap-min rides everywhere.
          // Audited 36x31 on every dictation surface (app-wide sweep).
          minWidth: 'var(--tap-min)', minHeight: 'var(--tap-min)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {recording ? <UIcon name="noEntry" size={14} /> : <UIcon name="mic" size={14} />}
      </button>
      {showStatus && (
        <span style={{
          fontSize: 11, color: uploading ? 'var(--ut-gold, #c9a84c)' : 'var(--loss, #ef4444)',
          marginLeft: 6, display: 'inline-flex', alignItems: 'center',
        }}>
          {statusText}
        </span>
      )}
      {showFailure && (
        <span
          role="alert"
          data-testid="dictation-failure"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0,
            zIndex: 20, width: 260,
            background: 'var(--bg-base, #1a1a1a)',
            border: '1px solid var(--loss, #ef4444)',
            borderRadius: 6, padding: '8px 10px',
            fontSize: 12, lineHeight: 1.45, color: 'var(--text-bright)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {failure.sentence}
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {heldBlobRef.current && (
              <button type="button" onClick={retryHeld} style={FAILURE_BUTTON}>Try again</button>
            )}
            {webSpeechAvailable && (
              <button type="button" onClick={() => startWebSpeech()} style={FAILURE_BUTTON}>
                Use browser speech
              </button>
            )}
            <button type="button" onClick={clearHeld} style={FAILURE_BUTTON}>
              {heldBlobRef.current ? 'Discard recording' : 'Dismiss'}
            </button>
          </span>
        </span>
      )}
      <style>{`@keyframes compass-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6); } 50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); } }`}</style>
    </span>
  )
})

export default VoiceInputButton
