// app/src/lib/minuteFrames/applied.js — "minute M's file is in the browser's cache now": the one message the device
// store's worker sends the pages about the minute feed (2026-11-24, review of #2639 round 2).
//
// WHY. With the device store on, the page's own minute feed (data/barStore/minuteFeed.js) may not download: it reads
// the minute file the device store's worker downloaded, from the browser's HTTP cache, with a cache-only request. It
// did not know WHEN that copy was there, so it looked every half second, and every look that came too early is a
// failed request in the browser's console. Told the moment the worker has applied a minute it read AS ITS OWN MINUTE
// FILE, the page reads the cache once.
//
// WHAT TRAVELS: { type, day, hhmm, seq, minute } on a BroadcastChannel of its own (every tab of the site hears the
// leader tab's worker; the worker that posts does not hear itself). Numbers and a date, nothing of a member's.
//   day     'YYYY-MM-DD', the ET trading date the consumer follows
//   hhmm    'HHMM', the minute file's name (codec.hhmmOfSeq)
//   seq     minutes since 04:00 ET
//   minute  unix minute
// ⛔ NEVER for a frame replayed from today.bin (the worker's catch-up): that minute was not fetched as its own URL, so
// no minute file is in the cache for a page to read, and a replay is hundreds of frames.
//
// Shared by the worker (deviceStore/workerCore.js, the sender) and the page (the reader), so the name and the shape
// are one fact. No imports beyond the codec's file-name rule.

import { hhmmOfSeq } from './codec'

export const MINUTE_APPLIED_CHANNEL = 'uct-minute-applied'
export const MINUTE_APPLIED = 'minute-applied'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** The message for one frame the consumer applied (its `frameDone` info), or null when there is nothing to tell:
 *  the frame was not read as its own minute file (`file !== true`), or the info is not a whole minute of a day. */
export function appliedSignal(info) {
  if (!info || info.file !== true) return null
  const { day, seq, minute } = info
  if (typeof day !== 'string' || !DAY_RE.test(day) || !Number.isInteger(seq) || seq < 0 || !Number.isInteger(minute)) return null
  return { type: MINUTE_APPLIED, day, hhmm: hhmmOfSeq(seq), seq, minute }
}

/** What a page may act on from a received message: { day, seq, minute }, or null for anything else on the channel. */
export function readAppliedSignal(msg) {
  if (!msg || msg.type !== MINUTE_APPLIED) return null
  const { day, seq, minute } = msg
  if (typeof day !== 'string' || !DAY_RE.test(day) || !Number.isInteger(seq) || seq < 0 || !Number.isInteger(minute)) return null
  if (msg.hhmm !== hhmmOfSeq(seq)) return null
  return { day, seq, minute }
}
