// app/src/lib/serverClock.js
//
// ⭐ THE SERVER'S CLOCK, FOR EVERY ROLL AND BUCKET DECISION (2026-11-25, the live session-open test).
//
// Every decision about which bucket is closed (prefetch `_bucketsBehind`, `_devHoldsFrontier`, `_rollMs`, `_ownGrace`; the
// bar store's status, through its registry's `nowMs`) read `Date.now()`, the MEMBER'S clock. The test PC's clock ran ~6 s
// slow (its time service was stopped): for ~6 s after every real roll its copies one closed bar short read as current and
// painted in the key task (p-1 presses 11-13, 35-36, 58-60; p-2 4-6, 28-29, 52-53, 75-76). Members' clocks drift too.
//
// `serverNow()` is the page's MONOTONIC clock (`performance.timeOrigin + performance.now()`) plus an offset learned from the
// server's own clock: the `Date` header of an answer that cannot have come from a cache (`noteServerDate`: the bars lane,
// prefetchBars `_chartLaneFetch`, and the live-prices poll, hooks/livePriceStore). Each answer is one sample,
// `server time - the request's midpoint` on that same monotonic base; the offset is the MEDIAN of the last SAMPLES_KEPT
// (one late answer cannot move it), a sample from a round trip over SAMPLE_RTT_MAX_MS is not taken, and an offset is never
// larger than OFFSET_MAX_MS (a broken header is not a clock). The `Date` header counts whole seconds: a sample is taken at
// the middle of its second (+500 ms); the median of samples at varied sub-second phases is good to well under a second.
//
// ⛔ (review of #2733) NEVER A CACHED ANSWER: a response the browser's HTTP cache (or any cache) served still carries its
// ORIGINAL `Date`, with a round trip near 0, so it reads the server as slow by the cache's age (a 300 s daily answer), and a
// run of them would drag the median, and the roll decisions, late. A sample is refused when the answer says it came from a
// cache (`Age` > 0) or could be stored by one (`Cache-Control` allowing it: a max-age above 0, `immutable`, or `public`
// without `no-store` / `no-cache`), and when its round trip is under SAMPLE_RTT_MIN_MS (no network answers that fast).
// ⛔ (review of #2733) NEVER THE WALL CLOCK'S JUMPS: the base is monotonic, so an NTP resync of the member's clock (this
// PC's, today) moves neither the samples nor `serverNow()`. ⛔ IT NEVER GOES BACKWARDS once learned: a smaller offset holds
// `serverNow()` where it was until the monotonic clock catches up (a roll decided is never undecided mid-bucket). With no
// sample yet it is `Date.now()`, exactly as before (so a page that never heard the server, and every test that moves the
// member clock with fake timers, see the member clock).

export const SAMPLES_KEPT = 9
export const SAMPLE_RTT_MAX_MS = 3000
/** A round trip shorter than this is a cache, not the network (a real answer from the edge takes tens of ms). */
export const SAMPLE_RTT_MIN_MS = 2
export const OFFSET_MAX_MS = 10 * 60 * 1000

function _defaultMono() {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function' && Number.isFinite(performance.timeOrigin)) {
      return performance.timeOrigin + performance.now()
    }
  } catch { /* no performance clock: the wall below */ }
  return Date.now()
}

let _samples = []
let _offset = 0
let _last = -Infinity
let _wall = () => Date.now()
let _mono = _defaultMono

/** The page's monotonic clock (ms, on the epoch scale): what a sample's `sentAt` / `receivedAt` must be read from. */
export function monoNow() { return _mono() }

/** Could a cache have served (or stored) this answer? (`Age` > 0, or a `Cache-Control` that lets a cache keep it.) */
export function cacheableAnswer({ age = null, cacheControl = null } = {}) {
  const a = Number(age)
  if (age != null && String(age).trim() !== '' && !(Number.isFinite(a) && a <= 0)) return true
  if (!cacheControl) return false
  const cc = String(cacheControl).toLowerCase()
  if (/(^|[,\s])(no-store|no-cache)([,\s=]|$)/.test(cc)) return false
  if (/(^|[,\s])immutable([,\s]|$)/.test(cc)) return true
  const ma = /(?:^|[,\s])(?:s-)?max-age\s*=\s*(\d+)/.exec(cc)
  if (ma) return Number(ma[1]) > 0 || /(^|[,\s])stale-while-revalidate/.test(cc)
  return /(^|[,\s])public([,\s]|$)/.test(cc)
}

/**
 * One sample of the server's clock: its `Date` header and when the request left and its answer came back, read from
 * `monoNow()`. `age` / `cacheControl`: the answer's `Age` and `Cache-Control` headers (a cacheable answer is no sample).
 * Returns whether it was taken.
 */
export function noteServerDate(dateHeader, { sentAt, receivedAt, age = null, cacheControl = null } = {}) {
  if (!dateHeader || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt)) return false
  if (cacheableAnswer({ age, cacheControl })) return false
  const rtt = receivedAt - sentAt
  if (!(rtt >= SAMPLE_RTT_MIN_MS && rtt <= SAMPLE_RTT_MAX_MS)) return false
  const server = Date.parse(String(dateHeader))
  if (!Number.isFinite(server)) return false
  const sample = server + 500 - (sentAt + receivedAt) / 2
  // (on the monotonic base the offset includes the member clock's own error: bounded by the wall clock's distance from it)
  if (Math.abs(sample + _mono() - _wall()) > OFFSET_MAX_MS) return false
  _samples.push(sample)
  if (_samples.length > SAMPLES_KEPT) _samples.splice(0, _samples.length - SAMPLES_KEPT)
  const sorted = [..._samples].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  _offset = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return true
}

/** The server's time now (ms): the monotonic clock plus the learned offset; the member's clock while nothing is learned.
 *  Once learned it never moves backwards: a smaller offset holds it until the monotonic clock catches up. */
export function serverNow() {
  if (!_samples.length) return _wall()
  const t = _mono() + _offset
  if (t > _last) _last = t
  return _last
}

/** The server's clock minus the member's (ms; 0 while nothing is learned): diagnostics. */
export function serverClockOffset() { return _samples.length ? _mono() + _offset - _wall() : 0 }

/** Tests: forget every sample; `wall` replaces the member's clock (default Date.now), `mono` the monotonic one (default
 *  `wall` when `wall` is given, so a test moves one clock; else performance.timeOrigin + performance.now()). */
export function __resetServerClockForTests({ wall, mono } = {}) {
  _samples = []
  _offset = 0
  _last = -Infinity
  _wall = wall || (() => Date.now())
  _mono = mono || wall || _defaultMono
}
