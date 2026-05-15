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
 */
import { useState, useRef, useEffect, useCallback } from 'react'

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

export default function VoiceInputButton({ onTranscript, disabled = false, cleanup = true }) {
  const SR = getSpeechRecognitionCtor()
  const whisperAvailable = hasMediaRecorder()
  const webSpeechAvailable = !!SR
  const supported = whisperAvailable || webSpeechAvailable

  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)

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
      if (text && onTranscript) onTranscript(text)
    }
    recognitionRef.current = r
    setRecording(true)
    try { r.start(); return true } catch { setRecording(false); return false }
  }, [SR, onTranscript, stopRecording])

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
        // Fallback: try Web Speech if we have it
        if (webSpeechAvailable) startWebSpeech()
        return
      }
      const data = await resp.json()
      const text = (data?.text || '').trim()
      if (text && onTranscript) onTranscript(text)
    } catch {
      if (webSpeechAvailable) startWebSpeech()
    } finally {
      setUploading(false)
    }
  }, [onTranscript, webSpeechAvailable, startWebSpeech, cleanup])

  const startWhisper = useCallback(async () => {
    audioChunksRef.current = []
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
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
  }, [webSpeechAvailable, startWebSpeech, stopRecording, uploadAudioToWhisper])

  const startRecording = useCallback(() => {
    if (!supported || disabled) return
    if (whisperAvailable) startWhisper()
    else if (webSpeechAvailable) startWebSpeech()
  }, [supported, disabled, whisperAvailable, webSpeechAvailable, startWhisper, startWebSpeech])

  const toggle = useCallback(() => {
    if (recording) stopRecording()
    else startRecording()
  }, [recording, stopRecording, startRecording])

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
        🎤
      </button>
    )
  }

  const showStatus = recording || uploading
  const statusText = uploading ? 'Transcribing…' : 'Listening…'

  return (
    <>
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
        }}
      >
        {recording ? '🛑' : '🎤'}
      </button>
      {showStatus && (
        <span style={{
          fontSize: 11, color: uploading ? 'var(--ut-gold, #c9a84c)' : 'var(--loss, #ef4444)',
          marginLeft: 6, display: 'inline-flex', alignItems: 'center',
        }}>
          {statusText}
        </span>
      )}
      <style>{`@keyframes compass-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6); } 50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); } }`}</style>
    </>
  )
}
