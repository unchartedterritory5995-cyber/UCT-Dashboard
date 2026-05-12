/**
 * VoiceInputButton — browser-native speech-to-text for Compass Chat.
 *
 * Uses window.SpeechRecognition (or webkitSpeechRecognition fallback).
 * Click → start recording, click again or silence → stop. Disabled with
 * tooltip when the API isn't available in the browser.
 *
 * Props:
 *   onTranscript(text: string): void   — called when a transcript is ready
 *   disabled?: bool
 */
import { useState, useRef, useEffect, useCallback } from 'react'

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined' && typeof global === 'undefined') return null
  const root = typeof window !== 'undefined' ? window : global
  return root.SpeechRecognition || root.webkitSpeechRecognition || null
}

export default function VoiceInputButton({ onTranscript, disabled = false }) {
  const SR = getSpeechRecognitionCtor()
  const supported = !!SR
  const [recording, setRecording] = useState(false)
  const recognitionRef = useRef(null)
  const transcriptRef = useRef('')

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* ignore */ }
    }
    setRecording(false)
  }, [])

  useEffect(() => {
    return () => stopRecording()
  }, [stopRecording])

  const startRecording = useCallback(() => {
    if (!supported || disabled) return
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
      if (finalText) {
        transcriptRef.current += finalText
      }
    }
    r.onerror = () => stopRecording()
    r.onend = () => {
      setRecording(false)
      const text = transcriptRef.current.trim()
      if (text && onTranscript) {
        onTranscript(text)
      }
    }
    recognitionRef.current = r
    setRecording(true)
    try { r.start() } catch { setRecording(false) }
  }, [supported, disabled, SR, onTranscript, stopRecording])

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

  return (
    <>
      <button
        type="button"
        aria-label={recording ? 'Stop voice input' : 'Start voice input'}
        title={recording ? 'Stop recording (click)' : 'Voice input (click to speak)'}
        onClick={toggle}
        disabled={disabled}
        style={{
          padding: '6px 10px', fontSize: 14,
          background: recording ? '#ef4444' : 'transparent',
          color: recording ? '#fff' : 'var(--text-bright)',
          border: `1px solid ${recording ? '#ef4444' : 'var(--border)'}`,
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          animation: recording ? 'compass-pulse 1.2s ease-in-out infinite' : 'none',
        }}
      >
        {recording ? '🛑' : '🎤'}
      </button>
      {recording && (
        <span style={{
          fontSize: 11, color: 'var(--loss, #ef4444)',
          marginLeft: 6, display: 'inline-flex', alignItems: 'center',
        }}>
          Listening…
        </span>
      )}
      <style>{`@keyframes compass-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.6); } 50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); } }`}</style>
    </>
  )
}
