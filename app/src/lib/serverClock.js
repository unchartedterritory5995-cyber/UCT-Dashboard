// app/src/lib/serverClock.js
//
// ⭐ THE SERVER'S CLOCK, FOR EVERY ROLL AND BUCKET DECISION (2026-11-25, the live session-open test).
//
// Every decision about which bucket is closed (prefetch `_bucketsBehind`, `_devHoldsFrontier`, `_rollMs`, `_ownGrace`; the
// bar store's status, through its registry's `nowMs`) read `Date.now()`, the MEMBER'S clock. The test PC's clock ran ~6 s
// slow (its time service was stopped): for ~6 s after every real roll its copies one closed bar short read as current and
// painted in the key task (p-1 presses 11-13, 35-36, 58-60; p-2 4-6, 28-29, 52-53, 75-76). Members' clocks drift too.
//
// `serverNow()` is `Date.now()` plus an offset learned from the server's own clock: the `Date` header of the bars answers
// (`noteServerDate`, prefetchBars' lane request). Each answer is one sample, `server time - the request's midpoint`; the
// offset is the MEDIAN of the last SAMPLES_KEPT (one late answer cannot move it), a sample from a round trip over
// SAMPLE_RTT_MAX_MS is not taken, and an offset is never larger than OFFSET_MAX_MS (a broken header is not a clock).
// The `Date` header counts whole seconds: a sample is taken at the middle of its second (+500 ms), so the offset is good to
// about half a second, far inside a bucket. ⛔ IT NEVER GOES BACKWARDS: a smaller offset holds `serverNow()` where it was
// until the member's clock catches up (a roll decided is never undecided mid-bucket). With no sample yet it is
// `Date.now()`, exactly as before.

export const SAMPLES_KEPT = 9
export const SAMPLE_RTT_MAX_MS = 3000
export const OFFSET_MAX_MS = 10 * 60 * 1000

let _samples = []
let _offset = 0
let _last = -Infinity
let _wall = () => Date.now()

/** One sample of the server's clock: its `Date` header and when the request left and its answer came back (member ms). */
export function noteServerDate(dateHeader, { sentAt, receivedAt } = {}) {
  if (!dateHeader || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt)) return false
  const rtt = receivedAt - sentAt
  if (!(rtt >= 0 && rtt <= SAMPLE_RTT_MAX_MS)) return false
  const server = Date.parse(String(dateHeader))
  if (!Number.isFinite(server)) return false
  const sample = server + 500 - (sentAt + receivedAt) / 2
  if (Math.abs(sample) > OFFSET_MAX_MS) return false
  _samples.push(sample)
  if (_samples.length > SAMPLES_KEPT) _samples.splice(0, _samples.length - SAMPLES_KEPT)
  const sorted = [..._samples].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  _offset = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return true
}

let _lastWall = -Infinity
/** The server's time now (ms): the member's clock plus the learned offset. A smaller offset never moves it backwards: it
 *  holds until the member's clock catches up. (Only the member's clock itself going back moves it back.) */
export function serverNow() {
  const w = _wall()
  const t = w + _offset
  if (w < _lastWall) _last = t
  else if (t > _last) _last = t
  _lastWall = w
  return _last
}

/** The offset in use (ms; diagnostics). */
export function serverClockOffset() { return _offset }

/** Tests: forget every sample; `wall` replaces the member's clock (default Date.now). */
export function __resetServerClockForTests({ wall } = {}) {
  _samples = []
  _offset = 0
  _last = -Infinity
  _lastWall = -Infinity
  _wall = wall || (() => Date.now())
}
