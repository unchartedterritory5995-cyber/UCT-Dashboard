// app/src/components/chart/engine/secondaryBars.js
//
// ─── BARS FOR A SYMBOL THAT IS NOT THE CHART'S OWN ──────────────────────────
//
// ⭐⭐ THE SIBLING OF `serverCompute.js`, AND DELIBERATELY THE SAME SHAPE. That
// lane solved this exact problem for server-computed columns: the binder is
// SYNCHRONOUS — it computes inside a paint — while data arrives from a fetch. Its
// answer is a module cache plus an in-flight map keyed by URL, a synchronous
// read that never fetches, an `ensure` that does, and a `subscribe` so a host can
// repaint when an entry lands. Everything below is that pattern with `bars`
// where it had `columns`.
//
// ⛔⛔ AND IT IS WHY THIS IS NOT A HOOK. `useSWR` cannot be called a varying
// number of times, and a chart needs N secondary symbols where N changes as the
// member adds and removes series. A composite key over the whole set would work
// for one chart and defeat sharing between charts — nine grid cells all watching
// QQQ would fetch it nine times. Keying the cache on the URL instead means the
// dedup is a property of WHAT THE DATA IS, not of who asked: the same sentence
// `serverCompute` states as "sixteen grid cells on one symbol cost one".
//
// ⛔ NO FAMILY BRANCH LIVES HERE. `QQQ`, `SPY` and `UCTA50` are one code path;
// `api/routers/bars.py` is where breadth is intercepted, and that is the right
// place because it is the layer that knows what a symbol IS. This module knows
// only that it was given a canonical symbol string.

/** The canonical bars route — the SAME endpoint the primary chart and Compare
 *  Symbols already use. A second browser bars client would be a second answer to
 *  "what are QQQ's bars", and the two would drift. */
const BARS_PATH = '/api/bars/'

/**
 * The request URL for one (symbol, timeframe, count).
 *
 * ⭐⭐ THE FETCH KEY IS THE CACHE KEY, DERIVED FROM ONE FUNCTION. A key that can
 * disagree with the URL it stands for is a cache that serves the wrong symbol —
 * the rule `serverColumnsUrl` states, and the reason both are built here.
 *
 * ⛔ AND SESSION IS NOT A DIMENSION, because the endpoint does not have one.
 * `GET /api/bars/{ticker}` accepts `(tf, bars, since, to, warm)`; extended-hours
 * handling is a CLIENT concern driven by the single `cs.extendedHoursShading`
 * setting. Inventing a `session=` parameter here would put a dimension in the key
 * that changes nothing about the bytes, and a cache keyed on fiction misses for
 * no reason. Exact-`t` projection (`projectSymbolField`) is what actually makes a
 * session mismatch safe: a secondary bar with no primary counterpart is ignored,
 * so the answer can be ABSENT but never WRONG.
 *
 * @returns {string|null} null when there is nothing to ask for.
 */
export function secondaryBarsUrl(symbol, tf, bars) {
  const s = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
  if (!s) return null
  const count = Number.isFinite(bars) && bars > 0 ? Math.floor(bars) : 200
  const code = tf == null || tf === '' ? 'D' : String(tf)
  return `${BARS_PATH}${encodeURIComponent(s)}?tf=${encodeURIComponent(code)}&bars=${count}`
}

// ─── The cache ──────────────────────────────────────────────────────────────

const _cache = new Map()      // url -> {bars, status}
const _inflight = new Map()   // url -> Promise
const _subscribers = new Set()
/** url -> {entry, attempt, retryAt, ready, timer} — the failure ledger, NOT a
 *  cache. `_cache` holds facts about the DATA; this holds a fact about the last
 *  ATTEMPT: how many have failed in a row, and whether the wait is over. */
const _retry = new Map()

/**
 * Why a source has no numbers — kept BESIDE the bars, never folded into them.
 *
 * ⭐⭐ THE EVALUATOR'S ANSWER IS NaN AND THAT IS CORRECT; the PRODUCT'S answer
 * must not be. "Not computable" is one word for six different situations, and a
 * member told only that a line is missing cannot tell a symbol we do not serve
 * from a symbol that is still loading. The warm-up phase settled the underlying
 * principle — UNKNOWN IS NOT FALSE — and this is the same distinction one layer
 * out: unknown is not all the same unknown.
 */
export const SOURCE_STATUS = Object.freeze({
  LOADING: 'loading',
  AVAILABLE: 'available',
  NO_DATA: 'no_data',
  UNSUPPORTED: 'unsupported',
  ERROR: 'error',
  // ⭐⭐ DENIED IS TERMINAL, AND THAT IS THE WHOLE POINT OF ADDING IT.
  // Every other status here is a fact about the DATA; this one is a fact about
  // the CALLER, and it is the only one that will not change by asking again.
  // ⛔ IT IS NOT `NO_DATA`. A member who is told "no data" for QQQ learns
  // something false about QQQ — the series exists, their plan does not include
  // it. Nor is it `ERROR`: an error is a thing that might work next time, and
  // treating a permanent refusal as one is exactly the retry storm below.
  DENIED: 'denied',
})

/** HTTP statuses that mean "asking again will not help": not signed in, or
 *  signed in without the entitlement. Everything else is transient by default —
 *  the safe direction, because a wrongly-terminal status is a chart that stays
 *  blank until reload. */
const DENIED_STATUSES = new Set([401, 403])

/**
 * The HTTP status of a rejected fetch — WHICHEVER FETCHER THREW IT.
 *
 * ⛔⛔ TWO SUPPLIERS, TWO SPELLINGS, AND THE MEMBERSHIP TEST SAW ONLY ONE.
 * `_defaultFetch` below stamps `err.httpStatus`. The chart does not use
 * `_defaultFetch`: it passes its OWN fetcher — the one with the concurrency gate
 * and the switch-abort — and that one stamps `err.status` and never
 * `httpStatus`. Reading a single field therefore answered `undefined` on the
 * only path a member is ever on, `undefined` is not in `DENIED_STATUSES`, and a
 * permanent 401/403 was filed as a transient error and re-requested on every
 * paint. The whole defect is one missing spelling.
 *
 * ⭐ SO THE READ LIVES HERE, ONCE. Teaching either call site to stamp the other
 * field would put a second authority on "what status was that" and the next
 * fetcher would arrive with a third spelling
 * (`lesson_a_second_authority_over_one_value`).
 *
 * @returns {number|null} null for a failure that carries no numeric status at
 *   all — a network error, a 25s abort — which is transient by default, the
 *   safe direction this module already chose.
 */
function _statusOf(err) {
  if (!err || typeof err !== 'object') return null
  if (Number.isFinite(err.httpStatus)) return err.httpStatus
  if (Number.isFinite(err.status)) return err.status
  return null
}

/**
 * A Retry-After the FETCHER read, in milliseconds, or 0 when there is none.
 *
 * ⚠️ READ WHAT THE FETCHERS ACTUALLY ATTACH, NOT WHAT THE HEADER IS CALLED.
 * The chart's fetcher parses `Retry-After` on a warming 503 and stamps
 * `err.retryAfterMs` — already milliseconds, already validated finite-and-
 * positive. `_defaultFetch` never looks at the header and attaches nothing. So
 * there is exactly ONE field to honour here, and a reader that went looking for
 * a `retryAfter` in seconds would find neither supplier and still look correct.
 */
function _retryAfterMs(err) {
  const ms = err && typeof err === 'object' ? err.retryAfterMs : null
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/** The first wait after a failure, and the ceiling the doubling stops at.
 *
 *  ⭐ EXPORTED BECAUSE THE RAILS ASSERT THE SCHEDULE. A test that retyped `2000`
 *  would keep passing through a change to the constant it claims to pin — the
 *  hand-typed-number-beside-its-source defect this codebase keeps paying for. */
export const RETRY_BASE_MS = 2000
export const RETRY_MAX_MS = 60000

/** How long to wait after `attempt` consecutive failures of one URL. */
function _backoffMs(attempt, floorMs) {
  const grown = Math.min(RETRY_BASE_MS * (2 ** Math.max(0, attempt - 1)), RETRY_MAX_MS)
  // ⭐ THE SERVER'S OWN NUMBER IS A FLOOR, NEVER TRIMMED BY OUR CEILING. The
  // ceiling bounds a GUESS about a server that has told us nothing; a
  // `Retry-After` is the only party that knows when it will be ready. Clamping
  // it would put our guess above its instruction, which is backwards.
  return Math.max(grown, floorMs)
}

/**
 * Record that this URL failed, and when it may be asked again.
 *
 * ⭐⭐ THE ENTRY IS THE ANSWER AND THE TIMER IS THE WAKE-UP. `ensure` hands the
 * stored entry back on every paint — the SAME object each time, so
 * `useSecondarySources`'s identity check sees no change and the chart does not
 * repaint — and the timer fires ONE notification when the wait is over, which is
 * what makes consumers re-ensure and put exactly one request back on the wire.
 *
 * ⛔ AND IT IS STILL NOT A CACHED FAILURE. Once the wait elapses the record
 * stops answering — it keeps only how many attempts have failed in a row, which
 * is what makes the next wait longer than the last — so nothing here is ever
 * remembered as an answer about the data. A success deletes it outright.
 */
function _armRetry(url, err) {
  const prev = _retry.get(url)
  if (prev && prev.timer) clearTimeout(prev.timer)
  // ⛔⛔ THE COUNT SURVIVES THE WAIT; ONLY A SUCCESS RESETS IT. An elapsed
  // record that deleted itself would hand the next failure `attempt = 1` again,
  // so every wait would be the base one and the curve would never grow — a
  // backoff that reads as implemented and is a fixed 2s retry loop.
  const attempt = (prev ? prev.attempt : 0) + 1
  const delay = _backoffMs(attempt, _retryAfterMs(err))
  // One clock read, shared by the record and the entry it hands out: two reads
  // of `Date.now()` can differ by a millisecond, and a schedule that disagrees
  // with the status it publishes is a second authority over one value.
  const retryAt = Date.now() + delay
  const record = {
    entry: { bars: [], status: SOURCE_STATUS.ERROR, retryAt },
    attempt,
    retryAt,
    ready: false,
    timer: null,
  }
  record.timer = setTimeout(() => {
    // ⭐ THE TIMER IS THE AUTHORITY ON "THE WAIT IS OVER", not a clock read at
    // the call site. One source of truth, and a consumer cannot be told to look
    // again a millisecond before the lane is willing to ask.
    const held = _retry.get(url)
    if (held === record) { held.ready = true; held.timer = null }
    _notify(url)
  }, delay)
  // ⚠️ A pending retry must never hold a process open — a browser has no
  // `unref`, a node test runner does, and a lane that keeps a runner alive for a
  // minute after its last assertion reads as a hang.
  if (record.timer && typeof record.timer.unref === 'function') record.timer.unref()
  _retry.set(url, record)
  return record.entry
}

/** Forget a URL's failure history. A success ends it, and so does a denial —
 *  which is terminal and needs no schedule. */
function _clearRetry(url) {
  const held = _retry.get(url)
  if (!held) return
  if (held.timer) clearTimeout(held.timer)
  _retry.delete(url)
}

/** Notified whenever an entry lands, so a host can repaint. @returns {() => void} */
export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  _subscribers.add(fn)
  return () => { _subscribers.delete(fn) }
}

function _notify(url) {
  for (const fn of [..._subscribers]) {
    try { fn(url) } catch { /* a bad subscriber must not break the lane */ }
  }
}

/** Test seam, and the escape hatch for a timeframe change. */
export function clearSecondaryBars() {
  _cache.clear()
  _inflight.clear()
  // ⛔ AND EVERY PENDING RETRY. A timer armed against a cache that no longer
  // exists notifies subscribers about a URL nobody holds — and inside a test
  // file it arrives during the NEXT case as a request nothing asked for.
  for (const held of _retry.values()) if (held.timer) clearTimeout(held.timer)
  _retry.clear()
}

/**
 * Read the response the bars route actually returns.
 *
 * ⚠️ THE `note` FIELD IS THE UNSUPPORTED SIGNAL, and it is the route's own
 * words. A cash index answers `{bars: [], sealed: false, note: "index history not
 * served by /api/bars-history"}` — an empty list WITH a reason. An ordinary
 * symbol that simply has nothing stored answers an empty list with no note. Those
 * are different facts and a member deserves to be told which one happened.
 */
function _read(payload) {
  const bars = payload && Array.isArray(payload.bars) ? payload.bars : []
  if (bars.length) return { bars, status: SOURCE_STATUS.AVAILABLE }
  const note = payload && typeof payload.note === 'string' ? payload.note : ''
  return { bars, status: note ? SOURCE_STATUS.UNSUPPORTED : SOURCE_STATUS.NO_DATA, note: note || undefined }
}

/**
 * The SYNCHRONOUS read the binder uses. Never fetches.
 *
 * Deliberately side-effect free, for the reason `cachedColumns` gives: a read
 * that fetches cannot be called from a test or a probe without paying for a
 * request.
 */
export function cachedBars(symbol, tf, bars) {
  const url = secondaryBarsUrl(symbol, tf, bars)
  if (!url) return null
  const hit = _cache.get(url)
  return hit === undefined ? null : hit
}

/**
 * ANY entry we hold for this symbol, whatever window it was fetched for.
 *
 * ⭐⭐ FOR A SURFACE THAT KNOWS THE SYMBOL AND NOT THE WINDOW. The settings tab
 * has to answer "may this series be drawn as candles?" and it knows the
 * instance's source — but the timeframe and bar count belong to the CHART, and
 * threading them into a modal would put a rendering concern in a form. The
 * question this answers is "what do we hold for this instrument", which is the
 * honest one for a capability probe.
 *
 * ⛔ IT NEVER FETCHES, for the reason `cachedBars` states: a read that fetches
 * cannot be called from a probe without paying for a request. It reads what the
 * chart has already loaded, and answers `null` before that lands — which the
 * capability gate treats as "not yet", the fail-closed direction.
 *
 * ⚠️ FIRST MATCH WINS. Two windows of one symbol are the same instrument and the
 * same o/h/l/c shape; a capability answer cannot differ between them.
 */
export function anyCachedBars(symbol) {
  const s = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
  if (!s) return null
  const prefix = `${BARS_PATH}${encodeURIComponent(s)}?`
  for (const [url, entry] of _cache) if (url.startsWith(prefix)) return entry
  return null
}

/**
 * The fetch. Deduped per URL, so every consumer of one symbol costs one request.
 *
 * ⛔ A FAILURE IS NOT CACHED. An absent entry can be asked for again; a cached
 * failure would be remembered as "no data" for the life of the chart. Same rule,
 * same reason, as the server lane. What IS remembered is WHEN it may be asked
 * again — see `_armRetry`, which is a schedule, not an answer.
 *
 * ⚠️ THIS FUNCTION ALWAYS ASKS. The backoff gate is in `ensure`/`ensureAll`,
 * which is the PAINT path and runs on every tick; this is the primitive that
 * means "ask now", and a caller reaching for it directly has already decided to.
 */
export function fetchSecondaryBars(symbol, tf, bars, fetcher) {
  const url = secondaryBarsUrl(symbol, tf, bars)
  if (!url) return Promise.resolve(null)
  const existing = _inflight.get(url)
  if (existing) return existing

  const get = typeof fetcher === 'function' ? fetcher : _defaultFetch
  const p = Promise.resolve()
    .then(() => get(url))
    .then((payload) => {
      const entry = _read(payload)
      _cache.set(url, entry)
      // ⭐ A SUCCESS RESETS THE BACKOFF. Otherwise one bad afternoon leaves the
      // rest of the session waiting a minute for every later blip.
      _clearRetry(url)
      return entry
    })
    .catch((err) => {
      // ⭐⭐ A DENIAL IS CACHED; AN ERROR IS NOT. The difference is whether asking
      // again could change the answer.
      //
      // ⚰️ MEASURED 2026-09-13, during the bars entitlement pass: every failure
      // deleted its entry so "the next paint asks again", which is right for a
      // transient 503 and catastrophic for a permanent 401/403. A live chart
      // repaints on every tick, so an unentitled member would have driven an
      // unbounded request storm at an endpoint that can only ever refuse — the
      // client half of the very amplification the server-side gate just closed.
      //
      // ⚰️⚰️ AND IT DID NOT FIRE ON THE REAL CHART, MEASURED 2026-09-19. This read
      // `err.httpStatus`, which only `_defaultFetch` sets; the chart passes its
      // own fetcher, which sets `err.status`. So the branch below answered
      // `undefined` on every member's chart, every 401/403 fell through to the
      // transient path, and the storm this comment forbids ran anyway. `_statusOf`
      // reads either spelling, in one place.
      const status = _statusOf(err)
      if (DENIED_STATUSES.has(status)) {
        const entry = { bars: [], status: SOURCE_STATUS.DENIED, httpStatus: status }
        _cache.set(url, entry)
        _clearRetry(url)
        return entry
      }
      // ⚠️ AN ERROR IS A STATUS, NOT A SILENCE — but it is not CACHED either.
      // The entry is removed so the source can be asked for again; the status is
      // handed back to the caller that asked.
      //
      // ⛔⛔ AND "AGAIN" IS NOT "NOW". Deleting the entry and notifying made the
      // subscriber re-ensure in the same tick, so a 503 during a deploy, a
      // network blip or a 25s abort was re-requested immediately and forever —
      // the same amplification as the denial above, from the other half of the
      // `.catch`. The ledger says when; until then `ensure` answers ERROR
      // without asking.
      _cache.delete(url)
      return _armRetry(url, err)
    })
    .finally(() => {
      _inflight.delete(url)
      _notify(url)
    })

  _inflight.set(url, p)
  return p
}

function _defaultFetch(url) {
  return fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`)
      // ⚠️ THE STATUS RIDES ON THE ERROR, because by the time the `.catch`
      // below sees it the Response is gone. A thrown string would have made the
      // two failure KINDS indistinguishable at the only place that can tell them
      // apart — which is how a permanent 403 became an every-paint retry.
      err.httpStatus = r.status
      throw err
    }
    return r.json()
  })
}

/**
 * Read the cache, and ask for the entry if it is not there.
 *
 * What the binder calls: a synchronous answer now — possibly `{status: loading}`
 * — and a request in flight for the next paint.
 *
 * ⛔⛔ AND IT IS THE PAINT PATH, WHICH IS WHY THE BACKOFF GATE IS HERE. A live
 * chart runs this on every tick, so "ask again next time" and "ask again
 * hundreds of times a minute" are the same sentence written twice.
 */
export function ensureSecondaryBars(symbol, tf, bars, fetcher) {
  const hit = cachedBars(symbol, tf, bars)
  if (hit) return hit
  const url = secondaryBarsUrl(symbol, tf, bars)
  if (!url) return null
  // ⭐ A FAILING URL ANSWERS ERROR AND ASKS FOR NOTHING until its wait elapses —
  // the same object every paint, so the hook's identity check sees no change.
  // The wake-up is the ONE notification `_armRetry`'s timer fires.
  const waiting = _retry.get(url)
  if (waiting && !waiting.ready && !_inflight.has(url)) return waiting.entry
  if (!_inflight.has(url)) fetchSecondaryBars(symbol, tf, bars, fetcher)
  return { bars: [], status: SOURCE_STATUS.LOADING }
}

/**
 * Ask for every symbol a chart needs, in one pass.
 *
 * ⭐ THE LIST IS ALREADY DEDUPED by `symbolsNeeded`, and the per-URL in-flight
 * map catches anything it missed — the same belt-and-braces the scan evaluator
 * uses when it loads benchmarks once outside the per-symbol loop.
 *
 * @returns {Map<string, {bars, status}>} keyed by canonical symbol
 */
export function ensureAll(symbols, tf, bars, fetcher) {
  const out = new Map()
  for (const symbol of (Array.isArray(symbols) ? symbols : [])) {
    const entry = ensureSecondaryBars(symbol, tf, bars, fetcher)
    if (entry) out.set(symbol, entry)
  }
  return out
}

/**
 * Seed the cache from a payload somebody else already fetched.
 *
 * ⭐ THE COMPARE-SYMBOLS BRIDGE. Compare has fetched a second symbol's bars
 * through SWR since long before this lane existed. Priming here means a member
 * comparing QQQ and plotting QQQ pays for ONE request rather than two — and, just
 * as importantly, means this lane does not have to take Compare's fetch away from
 * it to get that saving. `primeServerColumns` exists for exactly this reason and
 * for exactly these stakes.
 */
export function primeSecondaryBars(symbol, tf, bars, payload) {
  const url = secondaryBarsUrl(symbol, tf, bars)
  if (!url) return null
  const entry = _read(payload)
  // ⛔ An empty prime does NOT overwrite a good entry: Compare's SWR hands back
  // `undefined` on its first render, and caching that would blank a series that
  // is already drawing.
  if (!entry.bars.length && _cache.has(url)) return _cache.get(url)
  _cache.set(url, entry)
  return entry
}

/** How many requests are in flight — a test seam for the dedup rail. */
export function inflightCount() {
  return _inflight.size
}
