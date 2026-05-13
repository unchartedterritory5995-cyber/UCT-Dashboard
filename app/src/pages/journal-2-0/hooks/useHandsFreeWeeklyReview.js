/**
 * useHandsFreeWeeklyReview — Phase 5-G of Compass × Voice unification.
 *
 * On Sundays when the user opens the Compass tab and proactive_speak
 * is ON, Compass automatically reads this week's weekly review aloud
 * (if it's been generated). Localstorage-gated per (account, week).
 *
 * Pairs with P5-B (hands-free EOD recap) and P5-E (hands-free Morning
 * Wire). Together they give Compass three scheduled speak surfaces —
 * morning, end of day, end of week — without the user ever clicking
 * play.
 */
import { useEffect, useRef, useContext } from 'react'
import { VoiceContext } from '../../../context/VoiceContext'


function isSundayET() {
  // Approximate ET via UTC-5. Sufficient for a "weekend gate".
  const ETOff = 5
  const d = new Date(Date.now() - ETOff * 3600_000)
  return d.getUTCDay() === 0  // 0 = Sunday
}


function thisWeekKey(accountId) {
  // Bucket by ISO date of the prior Monday (ET).
  const ETOff = 5
  const d = new Date(Date.now() - ETOff * 3600_000)
  const day = d.getUTCDay()              // 0 = Sun
  const daysBack = day === 0 ? 6 : day - 1
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - daysBack)
  return `compass.weekly_spoken.${accountId}.${monday.toISOString().slice(0, 10)}`
}


export default function useHandsFreeWeeklyReview({ accountId, latestReview }) {
  const voice = useContext(VoiceContext)
  const playedRef = useRef(false)

  useEffect(() => {
    if (playedRef.current) return
    if (!voice) return
    if (!accountId) return
    if (!latestReview) return
    if (!latestReview.body) return

    if (!isSundayET()) return              // weekend gate
    const key = thisWeekKey(accountId)
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key)) {
      playedRef.current = true
      return
    }

    let cancelled = false
    const run = async () => {
      try {
        const settingsResp = await fetch('/api/voice/settings', {
          credentials: 'include',
        })
        if (!settingsResp.ok) return
        const settings = await settingsResp.json()
        if (!settings.proactive_speak || !settings.enabled) return

        // Don't talk over anything else
        if (voice.status === 'playing' || voice.status === 'loading') return
        if (voice.mode === 'c'
            && voice.status !== 'idle'
            && voice.status !== 'error') return

        const body = (latestReview.body || '').slice(0, 4000)
        if (!body) return
        const text = `Weekly review. ${body}`

        const ttsResp = await fetch('/api/voice/tts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (!ttsResp.ok || cancelled) return
        const blob = await ttsResp.blob()
        const url = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        await voice.playUrl({
          url,
          trackId: `compass-weekly-${accountId}`,
          trackLabel: 'Compass — Weekly review',
        })
        playedRef.current = true
        try { localStorage.setItem(key, '1') } catch { /* ignore */ }
      } catch { /* swallow */ }
    }
    run()
    return () => { cancelled = true }
  }, [accountId, latestReview, voice])
}
