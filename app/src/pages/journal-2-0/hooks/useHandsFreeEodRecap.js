/**
 * useHandsFreeEodRecap — Phase 5-B of Compass × Voice unification.
 *
 * When the user opens the Compass tab after market close and they've
 * enabled "Compass can speak proactive alerts", Compass automatically
 * reads today's EOD recap aloud. Once. (Won't repeat on revisits.)
 *
 * Gates:
 *   - User has voice settings.proactive_speak === true
 *   - Today (ET) is a weekday and current time is past 4 PM ET
 *   - Today's EOD recap exists for this account (was generated already)
 *   - localStorage hasn't already marked today's recap as heard
 *   - No other audio is currently playing
 *
 * Mounted from CompassTab — fires once on mount when conditions align.
 */
import { useEffect, useRef } from 'react'
import { VoiceContext } from '../../../context/VoiceContext'
import { useContext } from 'react'

const ET_OFFSET_HOURS = 5  // ET = UTC-5 (-4 during DST; close enough for a gate)
const RECAP_GATE_HOUR_ET = 16  // 4 PM ET — when EOD recap is generated

function isPostMarketClose() {
  const now = new Date()
  const utcHour = now.getUTCHours()
  // Approximate ET hour. Trading calendar gating is forgiving here —
  // the recap-exists check below is the real gate.
  const etHour = (utcHour - ET_OFFSET_HOURS + 24) % 24
  return etHour >= RECAP_GATE_HOUR_ET && etHour < 24
}

function todayET() {
  // YYYY-MM-DD in ET (approximate via UTC-5).
  const d = new Date(Date.now() - ET_OFFSET_HOURS * 3600_000)
  return d.toISOString().slice(0, 10)
}


export default function useHandsFreeEodRecap({ accountId, todaysEodRecap }) {
  const voice = useContext(VoiceContext)
  const playedRef = useRef(false)

  useEffect(() => {
    if (playedRef.current) return
    if (!voice) return                       // no provider mounted
    if (!accountId) return
    if (!todaysEodRecap) return              // no recap to read
    if (!todaysEodRecap.body) return         // empty body — nothing to read

    const playedKey = `compass.eod_spoken.${accountId}.${todayET()}`
    if (typeof localStorage !== 'undefined' && localStorage.getItem(playedKey)) {
      // Already played today; don't repeat on revisits.
      playedRef.current = true
      return
    }

    if (!isPostMarketClose()) return         // intraday — let the user trade

    // Check the user's proactive_speak setting before we play. Bail
    // silently if disabled (Compass tab still renders the recap visually).
    let cancelled = false
    const run = async () => {
      // Snapshot the playback generation BEFORE the async TTS fetch: if the user
      // stops (or another read starts) while this is in flight, playWhenCurrent
      // below no-ops instead of starting audio they already cancelled.
      const _playGen = voice.getPlayGen()
      try {
        const settingsResp = await fetch('/api/voice/settings', {
          credentials: 'include',
        })
        if (!settingsResp.ok) return
        const settings = await settingsResp.json()
        if (!settings.proactive_speak || !settings.enabled) return

        // Don't talk over anything else
        if (voice.status === 'playing' || voice.status === 'loading') return
        if (voice.mode === 'c' && voice.status !== 'idle' && voice.status !== 'error') return

        // Compose speech: short intro + recap body (truncated)
        const body = (todaysEodRecap.body || '').slice(0, 1500)
        const text = `End of day recap. ${body}`

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

        await voice.playWhenCurrent(_playGen, {
          url,
          trackId: `compass-eod-${accountId}-${todayET()}`,
          trackLabel: "Compass — Today's recap",
        })

        playedRef.current = true
        try { localStorage.setItem(playedKey, '1') } catch { /* ignore */ }
      } catch { /* swallow */ }
    }

    run()
    return () => { cancelled = true }
  }, [accountId, todaysEodRecap, voice])
}
