import { useCallback, useRef } from 'react'
import { useVoice } from '../context/VoiceContext'

const MAX_RECORD_MS = 4000

/**
 * One-shot voice query — capture mic, POST to /api/voice/oneshot, play streamed reply.
 *
 * Flow:
 *   1. Click triggers start()
 *   2. Browser asks for mic permission (cached after first time)
 *   3. MediaRecorder captures up to MAX_RECORD_MS
 *   4. Stop on second click, or auto-stop after timeout
 *   5. Send blob → /api/voice/oneshot
 *   6. Read X-Voice-Transcript / X-Voice-Narration headers, dispatch to context
 *   7. Pipe response audio through the existing AudioPlayerBar
 */
export default function useOneShot() {
  const voice = useVoice()
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const stopTimerRef = useRef(null)
  const activeBlobUrl = useRef(null)

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.stop()
    }
  }, [])

  const start = useCallback(async (context = 'global') => {
    if (voice.status === 'listening') {
      stopRecording()
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      alert('Microphone permission is required. Enable it in your browser settings.')
      return
    }

    voice.startListening()
    chunksRef.current = []
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    recorderRef.current = rec

    rec.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    })

    rec.addEventListener('stop', async () => {
      stream.getTracks().forEach((t) => t.stop())

      if (chunksRef.current.length === 0) {
        voice.stop()
        return
      }
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      voice.startThinking()

      const fd = new FormData()
      fd.append('audio', blob, 'audio.webm')
      fd.append('context', context)

      let r
      try {
        r = await fetch('/api/voice/oneshot', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
      } catch (e) {
        console.error('[useOneShot] fetch failed', e)
        voice.stop()
        return
      }

      if (!r.ok) {
        if (r.status === 402) {
          alert('Voice features require a paid plan.')
        } else if (r.status === 429) {
          alert('Monthly voice query cap reached.')
        } else {
          console.error('[useOneShot] backend returned', r.status)
        }
        voice.stop()
        return
      }

      const transcriptHdr = r.headers.get('X-Voice-Transcript') || ''
      const narrationHdr = r.headers.get('X-Voice-Narration') || ''
      const transcript = decodeURIComponent(transcriptHdr)
      const narration = decodeURIComponent(narrationHdr)
      voice.startResponding({ transcript, narration })

      const audioBlob = await r.blob()
      if (activeBlobUrl.current) URL.revokeObjectURL(activeBlobUrl.current)
      const url = URL.createObjectURL(audioBlob)
      activeBlobUrl.current = url

      await voice.playUrl({
        url,
        trackId: `oneshot-${Date.now()}`,
        trackLabel: narration ? narration.slice(0, 60) : 'Voice query',
      })
    })

    rec.start()
    stopTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORD_MS)
  }, [voice, stopRecording])

  return { start, stop: stopRecording }
}
