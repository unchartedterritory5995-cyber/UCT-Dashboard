import { useEffect, useRef } from 'react'
import { PorcupineWorker, BuiltInKeyword } from '@picovoice/porcupine-web'
import { WebVoiceProcessor } from '@picovoice/web-voice-processor'

/**
 * On-device wake word detection via Picovoice Porcupine.
 *
 * - Audio never leaves the browser until the wake word fires.
 * - Built-in keyword: BuiltInKeyword.Jarvis (no training required, brand-
 *   compatible with an AI trading assistant). Picovoice doesn't ship a
 *   "Compass" built-in; the closest in tone is Jarvis. A custom "Hey
 *   Compass" wake word can be trained at console.picovoice.ai for an
 *   even tighter brand fit — drop the .ppn file in app/public/ and
 *   swap the keyword param to { custom: '/hey-compass.ppn' }.
 *
 * Toggle via the `enabled` flag — pass `false` to fully unmount the worker
 * and release the microphone.
 *
 * Usage:
 *   useWakeWord({ enabled: voice.wakeEnabled, onWake: () => connect('global') })
 */
export default function useWakeWord({ enabled = false, onWake } = {}) {
  const workerRef = useRef(null)
  const subscriptionRef = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined

    let cancelled = false
    const accessKey = import.meta.env.VITE_PICOVOICE_ACCESS_KEY
    if (!accessKey) {
      console.warn('[useWakeWord] VITE_PICOVOICE_ACCESS_KEY missing — wake word disabled.')
      return undefined
    }

    const onKeywordDetected = (detection) => {
      if (typeof onWake === 'function') {
        try { onWake(detection) } catch (e) { console.error('[useWakeWord] onWake error', e) }
      }
    }

    const start = async () => {
      try {
        const worker = await PorcupineWorker.create(
          accessKey,
          [{ builtin: BuiltInKeyword.Jarvis }],
          onKeywordDetected,
        )
        if (cancelled) {
          await worker.release()
          return
        }
        workerRef.current = worker
        await WebVoiceProcessor.subscribe(worker)
        subscriptionRef.current = worker
      } catch (e) {
        console.error('[useWakeWord] init failed', e)
      }
    }

    start()

    return () => {
      cancelled = true
      const w = workerRef.current
      const sub = subscriptionRef.current
      ;(async () => {
        try {
          if (sub) await WebVoiceProcessor.unsubscribe(sub)
        } catch {}
        try {
          if (w) await w.release()
        } catch {}
        workerRef.current = null
        subscriptionRef.current = null
      })()
    }
  }, [enabled, onWake])
}
