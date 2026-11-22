// app/src/lib/minuteFrames/index.js — the ONLY entry the app may import, and it imports nothing:
// the consumer (codec + rollup + polling) loads on demand, so a page's first-open bytes are
// unchanged. The device store wires it once its append API exists:
//
//   const { createMinuteFrameConsumer } = await loadMinuteFrames()
//   const c = createMinuteFrameConsumer({ sink: deviceStoreSink })
//   c.start()
//
// Server side, format, R2 keys and the owner's switch: api/services/minute_frame_publisher.py
// and docs/plans/2026-11-20-universe-minute-frames.md.

/** Lazy-load the minute-frame consumer (its own chunk). */
export const loadMinuteFrames = () => import('./consumer.js')
