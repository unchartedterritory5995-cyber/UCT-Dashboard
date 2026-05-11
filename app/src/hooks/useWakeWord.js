import { useEffect, useRef } from 'react'
import { PorcupineWorker, BuiltInKeyword } from '@picovoice/porcupine-web'
import { WebVoiceProcessor } from '@picovoice/web-voice-processor'

/**
 * On-device wake word detection via Picovoice Porcupine.
 *
 * - Audio never leaves the browser until the wake word fires.
 * - Initial keyword: BuiltInKeyword.Bumblebee (no training required).
 *   Swap to a custom "Hey UCT Intelligence" keyword later by training
 *   one at console.picovoice.ai and replacing the keyword param.
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
          [{ builtin: BuiltInKeyword.Bumblebee }],
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
