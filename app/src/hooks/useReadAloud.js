import { useCallback } from 'react'
import { useVoice } from '../context/VoiceContext'

/**
 * Trigger TTS for a piece of text.
 *
 * Usage:
 *   const { play, isPlayingTrack } = useReadAloud()
 *   <button onClick={() => play({ trackId: 'wire-2026-05-08', label: 'Morning Wire',
 *                                  textProvider: () => stripHtml(rundownHtml) })}>
 *     Read aloud
 *   </button>
 *
 * `textProvider` is a sync or async function that returns the string to speak.
 * We accept a function (rather than the text directly) so the caller can defer
 * expensive HTML→text stripping until the user clicks.
 */
export default function useReadAloud() {
  const voice = useVoice()

  const play = useCallback(async ({ trackId, label, textProvider, voiceOverride, speedOverride }) => {
    if (voice.trackId === trackId && voice.status === 'playing') {
      voice.pause()
      return
    }
    if (voice.trackId === trackId && voice.status === 'paused') {
      await voice.resume()
      return
    }

    let text
    try {
      text = await Promise.resolve(textProvider())
    } catch (e) {
      console.error('[useReadAloud] textProvider failed', e)
      return
    }
    if (!text || !text.trim()) return

    const body = { text }
    if (voiceOverride) body.voice = voiceOverride
    if (speedOverride !== undefined) body.speed = speedOverride

    // Two-step so playback can stream natively: POST the text to /prepare (which
    // validates + returns a short-lived token), then point the <audio> element
    // at GET /stream?token=…. The browser plays the MP3 progressively as bytes
    // arrive — audio starts in ~1-2s instead of waiting for the whole rundown.
    let streamUrl
    try {
      const r = await fetch('/api/voice/tts/prepare', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        // Surface every failure — a silent no-op makes the button look "broken".
        if (r.status === 402) {
          alert('Voice features require a paid plan.')
        } else if (r.status === 429) {
          alert('Monthly read-aloud cap reached.')
        } else if (r.status === 401) {
          alert('Please sign in to use Read Aloud.')
        } else if (r.status === 503) {
          alert('Read Aloud is temporarily unavailable. Please try again shortly.')
        } else {
          alert('Read Aloud failed. Please try again.')
        }
        console.error('[useReadAloud] TTS prepare failed', r.status)
        return
      }
      const data = await r.json()
      if (!data || !data.token) {
        alert('Read Aloud failed. Please try again.')
        return
      }
      streamUrl = `/api/voice/tts/stream?token=${encodeURIComponent(data.token)}`
    } catch (e) {
      console.error('[useReadAloud] fetch failed', e)
      alert('Read Aloud failed — could not reach the server. Please try again.')
      return
    }

    await voice.playUrl({ url: streamUrl, trackId, trackLabel: label })
  }, [voice])

  const isPlayingTrack = (trackId) =>
    voice.trackId === trackId && (voice.status === 'playing' || voice.status === 'loading')

  const isPausedTrack = (trackId) =>
    voice.trackId === trackId && voice.status === 'paused'

  return { play, isPlayingTrack, isPausedTrack }
}
