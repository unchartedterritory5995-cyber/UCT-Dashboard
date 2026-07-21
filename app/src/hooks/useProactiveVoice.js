/**
 * useProactiveVoice — global hook that turns Compass into an active coach
 * that speaks unprompted when the daemon fires a high-severity insight.
 *
 * Phase 4-A of the Compass × Voice unification. Wires up the P3-C
 * proactive_speak toggle so it actually does something.
 *
 * Behavior:
 *   - Polls /api/voice/insights/unspoken every POLL_INTERVAL_MS while
 *     the user is authenticated. The endpoint internally honors the
 *     user's proactive_speak setting (returns null when disabled) and
 *     the importance threshold (≥ 7).
 *   - On hit: hits /api/voice/tts with the spoken_text, plays via the
 *     global AudioPlayerBar (same as read-aloud), then POSTs
 *     /mark-spoken so the insight isn't repeated.
 *   - Suspends polling while any other audio is playing (read-aloud,
 *     Realtime voice session) so Compass doesn't talk over itself.
 *
 * Mount once at App level inside AuthProvider + VoiceProvider.
 */
import { useEffect, useRef } from 'react'
import { useVoice } from '../context/VoiceContext'
import { useAuth } from '../context/AuthContext'

const POLL_INTERVAL_MS = 90_000          // 1.5 min — gentle, not aggressive
const POLL_INITIAL_DELAY_MS = 8_000      // settle after page load
const TRACK_ID_PREFIX = 'proactive-insight-'

export default function useProactiveVoice() {
  const voice = useVoice()
  const { user } = useAuth()
  const blobUrlRef = useRef(null)
  const pollTimerRef = useRef(null)
  const inFlightRef = useRef(false)
  const lastPlayedIdRef = useRef(null)

  useEffect(() => {
    if (!user) return  // not signed in → no polling

    const isAudioBusy = () => {
      // Don't interrupt anything else that's already speaking.
      if (voice.status === 'playing' || voice.status === 'loading') return true
      if (voice.mode === 'c' && voice.status !== 'idle' && voice.status !== 'error') return true
      return false
    }

    const tick = async () => {
      // Snapshot the playback generation BEFORE the async TTS fetch: if the user
      // stops (or another read starts) while this is in flight, playWhenCurrent
      // below no-ops instead of starting audio they already cancelled.
      const _playGen = voice.getPlayGen()
      if (inFlightRef.current) return
      if (isAudioBusy()) return
      inFlightRef.current = true
      try {
        const r = await fetch('/api/voice/insights/unspoken', {
          credentials: 'include',
        })
        if (!r.ok) return
        const data = await r.json()
        const insight = data?.insight
        if (!insight || !insight.spoken_text) return
        if (lastPlayedIdRef.current === insight.id) return

        // Synthesize speech
        const ttsResp = await fetch('/api/voice/tts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: insight.spoken_text }),
        })
        if (!ttsResp.ok) return
        const blob = await ttsResp.blob()
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current)
        }
        const url = URL.createObjectURL(blob)
        blobUrlRef.current = url

        const label = insight.symbol
          ? `Compass — ${insight.symbol}`
          : 'Compass'

        // Play through the global audio bar (same pipeline as read-aloud)
        await voice.playWhenCurrent(_playGen, {
          url,
          trackId: `${TRACK_ID_PREFIX}${insight.id}`,
          trackLabel: label,
        })
        lastPlayedIdRef.current = insight.id

        // Best-effort mark-spoken so we don't re-play
        try {
          await fetch(`/api/voice/insights/${insight.id}/mark-spoken`, {
            method: 'POST',
            credentials: 'include',
          })
        } catch { /* ignore */ }
      } catch {
        // Swallow — polling will retry next interval
      } finally {
        inFlightRef.current = false
      }
    }

    // Initial delayed tick + interval
    const initial = setTimeout(tick, POLL_INITIAL_DELAY_MS)
    pollTimerRef.current = setInterval(tick, POLL_INTERVAL_MS)

    return () => {
      clearTimeout(initial)
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    }
  }, [user, voice])
}
