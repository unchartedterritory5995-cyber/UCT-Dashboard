// app/src/data/deviceStore/liveFeed.js — runs the universe minute-frame consumer for the device
// store, in the LEADER's worker (one per browser, whatever the number of tabs), feeding live.js.
//
// LAZY BY WHERE IT LIVES: the consumer (lib/minuteFrames: decoder, rollup, poller) is imported
// STATICALLY here, so it is part of the device store's worker chunk and nothing else: the worker itself
// is created only when the switch is on, and the feed starts after the page's first chart paint
// (client.js asks; workerCore.js decides). ⛔ Never a dynamic import() in the worker's graph: the app
// builds workers as IIFE (vite `worker.format`), which cannot code-split, and `vite build` refuses it
// (CI run 44761382435). Inside the worker a second lazy step would buy nothing anyway.
//
// VISIBILITY (CLAUDE.md speed rule 6). A worker cannot see a page. Every tab reports whether the
// app is visible (lib/deskVisibility.isAppVisible: hidden tab or hidden desktop desk) when it changes
// and once a minute while visible; the feed counts as visible while a visible report is younger than
// VISIBLE_FRESH_MS. A closed tab stops reporting, so a browser with no visible tab stops polling.
//
// RE-SYNC. A gap this device caused (frames that EXIST but never arrived: `not-received`,
// `link-mismatch`) is repaired by starting over: a fresh consumer replays the day file (today.bin)
// into a cleared overlay, exactly what a device that was live all day holds. Bounded (RESYNC_MIN_MS
// apart, RESYNC_MAX_PER_DAY a day): a gap the PUBLISHER has (`not-published`, `incomplete`) is in
// the day file too, so re-reading cannot repair it; the overlay stays unusable until tomorrow and
// the charts ask the server (live.js). A new seed with more symbols re-syncs too (resync('seed')).

import { createMinuteFrameConsumer } from '../../lib/minuteFrames/consumer'
import { etDateLabel } from '../../components/chart/barTime'
import { STORED_TFS } from './tfs'

export const VISIBLE_FRESH_MS = 90_000
export const RESYNC_MIN_MS = 120_000
export const RESYNC_MAX_PER_DAY = 6
const RESYNCABLE = new Set(['not-received', 'link-mismatch'])

/**
 * @param {object} o
 * @param {object} o.overlay                 live.js createLiveOverlay()
 * @param {Function} [o.load]                () => {createMinuteFrameConsumer} (tests inject a fake)
 * @param {Function} [o.now]
 * @param {object} [o.consumerOpts]          extra options for createMinuteFrameConsumer (tests)
 */
const _bundled = () => ({ createMinuteFrameConsumer })

export function createLiveFeed({ overlay, load = _bundled, now = () => Date.now(), consumerOpts = {} } = {}) {
  let mod = null
  let consumer = null
  let starting = null
  let lastVisibleAt = -Infinity
  let lastResyncAt = -Infinity
  const resyncs = { day: null, n: 0, reasons: [] }

  const isVisible = () => now() - lastVisibleAt < VISIBLE_FRESH_MS

  const sink = {
    upsert: (...a) => overlay.sink.upsert(...a),
    stale: (...a) => overlay.sink.stale(...a),
    reset: (info) => overlay.sink.reset(info),
    frameDone: (info) => overlay.sink.frameDone(info),
    gap(info) {
      overlay.sink.gap(info)
      if (RESYNCABLE.has(info?.reason)) Promise.resolve().then(() => api.resync(info.reason)).catch(() => {})
    },
  }

  function _create() {
    return mod.createMinuteFrameConsumer({
      sink, isVisible, rollup: { tfs: [...STORED_TFS] }, ...consumerOpts,
    })
  }

  const api = {
    /** Start following (idempotent). Resolves once the consumer runs (or null when it cannot load). */
    start() {
      if (consumer) return Promise.resolve(consumer)
      if (!starting) {
        starting = Promise.resolve(load()).then((m) => {
          mod = m
          consumer = _create()
          consumer.start()
          return consumer
        }).catch(() => { starting = null; return null })
      }
      return starting
    },
    /** A tab says whether the app is visible to its member. Visible again → catch up now. */
    visible(v) {
      const was = isVisible()
      if (v) lastVisibleAt = now()
      if (v && !was && consumer) consumer.syncNow().catch(() => {})
    },
    /** Start over from the day file (bounded). Returns true when a re-sync began. */
    resync(reason = 'manual') {
      if (!consumer || !mod) return false
      const t = now()
      const d = etDateLabel(Math.floor(t / 1000))     // the ET day, not the overlay's (a clear empties that)
      if (resyncs.day !== d) { resyncs.day = d; resyncs.n = 0 }
      if (t - lastResyncAt < RESYNC_MIN_MS || resyncs.n >= RESYNC_MAX_PER_DAY) return false
      lastResyncAt = t
      resyncs.n++
      resyncs.reasons.push(reason)
      if (resyncs.reasons.length > 20) resyncs.reasons.shift()
      consumer.stop()
      overlay.clear()
      consumer = _create()
      consumer.start()
      return true
    },
    stop() { consumer?.stop(); consumer = null; starting = null },
    running: () => !!consumer,
    status: () => ({ running: !!consumer, visible: isVisible(), resyncs: { ...resyncs, reasons: [...resyncs.reasons] },
      consumer: consumer?.status?.() ?? null, overlay: overlay.state() }),
  }
  return api
}
