import { useEffect, useRef } from 'react'

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
 * ⭐ THE PICOVOICE IMPORTS ARE DYNAMIC, AND THAT IS LOAD-BEARING.
 * `@picovoice/porcupine-web` inlines its wake-word model as base64 wasm — it
 * is ~3.5 MB raw / ~900 KB gzipped, by far the largest thing this app can
 * download, and it was the whole of the GlobalVoiceLayer chunk. That chunk is
 * `lazy()` and gated on `isPaid` in App.jsx, but essentially every member is
 * paid or on a paid trial, so the gate never excluded anyone: the wasm shipped
 * to everyone the moment auth resolved.
 *
 * This effect ALREADY early-returns when `enabled` is false, and `wakeEnabled`
 * defaults to false (context/VoiceContext.jsx) — so with static imports we
 * were paying ~900 KB gz for a code path that, for most members, never ran.
 * Moving the imports inside `start()` costs nothing (worker creation was
 * already async and awaited) and defers the download to the first time a
 * member actually turns the wake word ON.
 *
 * ⛔ Do NOT hoist these back to the top of the file to "clean it up".
 *
 * @see hooks/useWakeWord.lazy.test.js — asserts the module graph stays free of
 *      a static picovoice edge, so this cannot silently regress.
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
    // Captured from the dynamic import so the cleanup below can still
    // unsubscribe. It is assigned before `subscriptionRef` is ever set, so a
    // non-null `subscriptionRef.current` guarantees a non-null processor.
    let voiceProcessor = null
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
        // Deferred to first enable — see the note above the hook.
        const [{ PorcupineWorker, BuiltInKeyword }, { WebVoiceProcessor }] =
          await Promise.all([
            import('@picovoice/porcupine-web'),
            import('@picovoice/web-voice-processor'),
          ])
        if (cancelled) return
        voiceProcessor = WebVoiceProcessor
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
          if (sub && voiceProcessor) await voiceProcessor.unsubscribe(sub)
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
