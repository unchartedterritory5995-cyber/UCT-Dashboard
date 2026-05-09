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

    let blobUrl
    try {
      const r = await fetch('/api/voice/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        if (r.status === 402) {
          alert('Voice features require a paid plan.')
          return
        }
        if (r.status === 429) {
          alert('Monthly read-aloud cap reached.')
          return
        }
        throw new Error(`TTS failed: ${r.status}`)
      }
      const blob = await r.blob()
      blobUrl = URL.createObjectURL(blob)
    } catch (e) {
      console.error('[useReadAloud] fetch failed', e)
      return
    }

    await voice.playUrl({ url: blobUrl, trackId, trackLabel: label })
  }, [voice])

  const isPlayingTrack = (trackId) =>
    voice.trackId === trackId && (voice.status === 'playing' || voice.status === 'loading')

  const isPausedTrack = (trackId) =>
    voice.trackId === trackId && voice.status === 'paused'

  return { play, isPlayingTrack, isPausedTrack }
}
