/**
 * Wave 11 lane 11A — the browser recorder for voice notes.
 *
 * States: 'idle' → 'recording' ⇄ 'paused' → 'stopped' (a Blob in hand), or
 * 'error' (the microphone refused, or this browser cannot record).
 *
 * ⛔ THE RECORDING IS KEPT UNTIL THE MEMBER LETS IT GO. `blob` survives a failed
 * upload or a failed transcription, so Retry never asks them to record again;
 * only `reset()` (Discard, or Save) drops it. It lives in this tab's memory only
 * — never storage, never the note.
 *
 * ⛔ A HARD LIMIT: at `maxSeconds` of RECORDED time (pauses do not count) the
 * recorder stops itself, and says so (`limitReached`), so a forgotten recording
 * cannot outgrow what the server accepts.
 *
 * The timer counts recorded time from the clock, never from tick counts: a
 * background tab throttles intervals, and a throttled count would read short.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']

/** The container this browser records into, or '' to let it choose. */
export function pickMimeType(MR = globalThis.MediaRecorder) {
  if (!MR || typeof MR.isTypeSupported !== 'function') return ''
  return MIME_CANDIDATES.find((t) => { try { return MR.isTypeSupported(t) } catch { return false } }) || ''
}

/** A file name whose extension the server accepts, from the recorded type. */
export function recordingFilename(mime) {
  const m = String(mime || '')
  if (m.includes('mp4')) return 'recording.m4a'
  if (m.includes('ogg')) return 'recording.ogg'
  return 'recording.webm'
}

export function canRecord() {
  return typeof globalThis.MediaRecorder === 'function'
    && Boolean(globalThis.navigator?.mediaDevices?.getUserMedia)
}

export const MIC_REFUSED_SENTENCE = 'The microphone is blocked. Allow it for this site, or upload a recording instead.'
export const NO_RECORDER_SENTENCE = "This browser can't record audio. Upload a recording instead."

export default function useVoiceRecorder({ maxSeconds = 3600, now = () => Date.now() } = {}) {
  const [state, setState] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const [blob, setBlob] = useState(null)
  const [error, setError] = useState('')
  const [limitReached, setLimitReached] = useState(false)
  const [mimeType, setMimeType] = useState('')
  const recRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const accRef = useRef(0)          // recorded ms before the current run
  const runStartRef = useRef(null)  // when the current run started (null while paused)
  const tickRef = useRef(null)
  const mimeRef = useRef('')

  const recordedMs = useCallback(() => accRef.current + (runStartRef.current != null ? now() - runStartRef.current : 0), [now])

  const stopTracks = () => {
    try { streamRef.current?.getTracks?.().forEach((t) => t.stop()) } catch { /* already gone */ }
    streamRef.current = null
  }
  const clearTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }

  const stop = useCallback(() => {
    const rec = recRef.current
    if (!rec || rec.state === 'inactive') return
    accRef.current = recordedMs()
    runStartRef.current = null
    clearTick()
    try { rec.stop() } catch { /* onstop still finalises below */ }
  }, [recordedMs])

  const tick = useCallback(() => {
    const ms = recordedMs()
    setElapsed(Math.floor(ms / 1000))
    if (ms >= maxSeconds * 1000) {
      setLimitReached(true)
      stop()
    }
  }, [recordedMs, maxSeconds, stop])

  const start = useCallback(async () => {
    setError('')
    if (!canRecord()) { setState('error'); setError(NO_RECORDER_SENTENCE); return false }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setState('error'); setError(MIC_REFUSED_SENTENCE); return false
    }
    streamRef.current = stream
    chunksRef.current = []
    accRef.current = 0
    setLimitReached(false)
    setBlob(null)
    const picked = pickMimeType()
    let rec
    try {
      rec = new MediaRecorder(stream, { ...(picked ? { mimeType: picked } : {}), audioBitsPerSecond: 32000 })
    } catch {
      stopTracks(); setState('error'); setError(NO_RECORDER_SENTENCE); return false
    }
    mimeRef.current = rec.mimeType || picked || 'audio/webm'
    setMimeType(mimeRef.current)
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      clearTick()
      stopTracks()
      const out = new Blob(chunksRef.current, { type: mimeRef.current })
      setBlob(out)
      setElapsed(Math.floor(accRef.current / 1000))
      setState('stopped')
    }
    recRef.current = rec
    rec.start(1000)
    runStartRef.current = now()
    setElapsed(0)
    setState('recording')
    clearTick()
    tickRef.current = setInterval(tick, 250)
    return true
  }, [now, tick])

  const pause = useCallback(() => {
    const rec = recRef.current
    if (!rec || rec.state !== 'recording') return
    try { rec.pause() } catch { return }
    accRef.current = recordedMs()
    runStartRef.current = null
    clearTick()
    setElapsed(Math.floor(accRef.current / 1000))
    setState('paused')
  }, [recordedMs])

  const resume = useCallback(() => {
    const rec = recRef.current
    if (!rec || rec.state !== 'paused') return
    try { rec.resume() } catch { return }
    runStartRef.current = now()
    setState('recording')
    clearTick()
    tickRef.current = setInterval(tick, 250)
  }, [now, tick])

  const reset = useCallback(() => {
    clearTick()
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null
      try { rec.stop() } catch { /* already stopped */ }
    }
    recRef.current = null
    stopTracks()
    chunksRef.current = []
    accRef.current = 0
    runStartRef.current = null
    setBlob(null)
    setElapsed(0)
    setError('')
    setLimitReached(false)
    setState('idle')
  }, [])

  // Leaving the page while the mic is live must release it.
  useEffect(() => () => {
    clearTick()
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null
      try { rec.stop() } catch { /* gone */ }
    }
    stopTracks()
  }, [])

  return {
    state, elapsed, blob, error, limitReached, maxSeconds,
    mimeType, filename: recordingFilename(mimeType),
    start, pause, resume, stop, reset,
  }
}

/** "4:07" / "1:02:09" from seconds. */
export function clockLabel(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
