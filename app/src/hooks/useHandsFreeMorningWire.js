/**
 * useHandsFreeMorningWire — Phase 5-E of Compass × Voice unification.
 *
 * When the user opens the Morning Wire after the engine has pushed
 * today's rundown (typically 7:35 AM ET) and they've enabled "Compass
 * can speak proactive alerts", Compass auto-reads the rundown once.
 *
 * Symmetric with useHandsFreeEodRecap (P5-B). Localstorage-gated per
 * (user, date) so revisits during the same day don't repeat.
 *
 * Gates (all must pass):
 *   - VoiceProvider mounted
 *   - voice_settings.proactive_speak === true and enabled
 *   - Rundown HTML is present (engine has pushed today's wire)
 *   - localStorage hasn't already marked today's wire as heard
 *   - No other audio is playing
 */
import { useEffect, useRef, useContext } from 'react'
import { VoiceContext } from '../context/VoiceContext'


function todayUTC() {
  // Use UTC date for the local-storage key (timezone-neutral).
  return new Date().toISOString().slice(0, 10)
}


function htmlToPlainText(html) {
  if (!html || typeof window === 'undefined') return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return tmp.textContent.replace(/\s+/g, ' ').trim()
}


export default function useHandsFreeMorningWire({ rundownHtml }) {
  const voice = useContext(VoiceContext)
  const playedRef = useRef(false)

  useEffect(() => {
    if (playedRef.current) return
    if (!voice) return
    if (!rundownHtml) return

    const playedKey = `compass.wire_spoken.${todayUTC()}`
    if (typeof localStorage !== 'undefined' && localStorage.getItem(playedKey)) {
      playedRef.current = true
      return
    }

    let cancelled = false
    const run = async () => {
      try {
        // Gate on proactive_speak setting
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

        const body = htmlToPlainText(rundownHtml).slice(0, 4000)
        if (!body) return
        const text = `Morning Wire briefing. ${body}`

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
          trackId: `compass-wire-${todayUTC()}`,
          trackLabel: 'Compass — Morning Wire',
        })
        playedRef.current = true
        try { localStorage.setItem(playedKey, '1') } catch { /* ignore */ }
      } catch { /* swallow */ }
    }
    run()
    return () => { cancelled = true }
  }, [rundownHtml, voice])
}
