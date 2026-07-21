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

  const play = useCallback(async ({ trackId, label, textProvider, voiceOverride, speedOverride, force }) => {
    // `force` bypasses the play/pause toggle — used when the player re-reads in
    // a new voice (we want a fresh read, not a pause).
    if (!force) {
      if (voice.trackId === trackId && voice.status === 'playing') {
        voice.pause()
        return
      }
      if (voice.trackId === trackId && voice.status === 'paused') {
        await voice.resume()
        return
      }
      // Mid-prepare the button already renders as "Pause read-aloud", so a
      // click here must CANCEL the pending read — not silently queue a second
      // synthesis of the same track.
      if (voice.trackId === trackId && voice.status === 'loading') {
        voice.stop()
        return
      }
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

    // Show the player bar (and its Stop button) for the whole prepare leg, and
    // remember which playback generation this chain belongs to. Any stop /
    // mode-switch bumps the generation, which is how we detect below that the
    // user cancelled while the clip was still synthesizing.
    const gen = voice.beginLoad({ trackId, trackLabel: label })
    const cancelled = () => voice.getPlayGen() !== gen
    // Leave the bar in a sane state if we bail before playback starts —
    // otherwise it sticks on "preparing…" forever.
    const abort = () => { if (!cancelled()) voice.stop() }

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
      // The user pressed Stop while this was in flight — abandon it silently.
      // Do NOT alert (they cancelled; nothing failed) and do NOT play.
      if (cancelled()) return
      if (!r.ok) {
        abort()
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
      if (cancelled()) return
      if (!data || !data.token) {
        abort()
        alert('Read Aloud failed. Please try again.')
        return
      }
      streamUrl = `/api/voice/tts/stream?token=${encodeURIComponent(data.token)}`
    } catch (e) {
      if (cancelled()) return
      abort()
      console.error('[useReadAloud] fetch failed', e)
      alert('Read Aloud failed — could not reach the server. Please try again.')
      return
    }

    // Register a replay closure so the player's voice/speed pickers can
    // re-read THIS track with a different voice (which requires re-synthesis).
    // Final gate: everything above was async, so re-check right before the one
    // line that actually makes noise.
    if (cancelled()) return

    voice.registerReadAloud((overrides = {}) => play({
      trackId,
      label,
      textProvider,
      voiceOverride: overrides.voice ?? voiceOverride,
      speedOverride: overrides.speed ?? speedOverride,
      force: true,
    }))

    await voice.playUrl({ url: streamUrl, trackId, trackLabel: label })
  }, [voice])

  const isPlayingTrack = (trackId) =>
    voice.trackId === trackId && (voice.status === 'playing' || voice.status === 'loading')

  const isPausedTrack = (trackId) =>
    voice.trackId === trackId && voice.status === 'paused'

  return { play, isPlayingTrack, isPausedTrack }
}
