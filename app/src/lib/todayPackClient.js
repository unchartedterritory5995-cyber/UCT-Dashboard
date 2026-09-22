/**
 * Today-pack client — today's developing daily bar for the whole market, held
 * locally so a chart can paint today's candle at FIRST PAINT for a symbol this
 * browser has never opened.
 *
 * 🔴 WHY A PREFETCH IS THE ONLY THING THAT WORKS HERE. The instant D/W/M seed
 * (barspack) carries only CLOSED sessions on purpose — it "never builds mid-session
 * (partial-bar guard)". So a never-opened symbol has no local copy of today's bar and
 * today's candle cannot appear until /api/bars answers. Measured on production
 * 2026-09-11: `bars;desc="mem";dur=0.8` — 0.8ms of server work inside a 300-500ms
 * round trip. The delay is ENTIRELY network, so nothing on the server can remove it;
 * the bar has to already be here when the ticker is typed. A warm symbol feels instant
 * only because IndexedDB still holds today's bar from last time — this makes every
 * symbol warm for that one bar.
 *
 * ⚠️ IT IS A SEED, NOT A SOURCE OF TRUTH. /api/bars still lands a few hundred ms later
 * and wins; this only decides what is on screen in between. The pack can be up to one
 * refresh interval stale in PRICE, which is why it is never merged into `filteredBars`
 * (indicators, crosshair and the live writers never see it) — same contract as the
 * whitespace slot it replaces.
 */

// How long a loaded pack is considered current enough to skip a refetch.
const REFRESH_MS = 45_000
// How old a pack may be and still SEED a chart. Deliberately tighter than a
// refresh window: a stale price would paint today's candle at the wrong level and
// then visibly correct when /api/bars lands ~300ms later — trading a missing
// candle for a flashing one, which is the worse bug. Past this we return null and
// the chart falls back to the reserved whitespace slot (today's behaviour).
const MAX_SEED_AGE_MS = 90_000

let _pack = null          // { d, bars }
let _ts = 0               // epoch ms of the last successful load
let _inflight = null      // in-flight promise — many charts mount at once

// ── Proactive keep-warm ─────────────────────────────────────────────────────
// 🔴 THE OLD MODEL WAS STRUCTURALLY ONE SYMBOL LATE. Refresh happened only inside
// `touchTodayPack()`, i.e. on a symbol CHANGE, and the fetch it starts lands after
// the seed for THAT symbol has already run — the docstring below says so in as many
// words ("the fetch started here is for the NEXT symbol"). So the first ticker opened
// after any gap longer than MAX_SEED_AGE_MS got a null seed and a whitespace hole,
// and the refresh it triggered benefited the ticker after it. A member scanning a
// theme they paused on hit that on exactly the tickers they cared about.
//
// ⭐ SO REFRESH ON A CLOCK, NOT ON A CLICK — BUT ONLY WHILE IT PAYS. The original
// objection to a timer stands and is respected: ~630KB raw (~200KB gzipped) on a
// fixed interval is real money for "a tab someone left open, to benefit a symbol
// they may never type". The timer therefore runs only when ALL of these hold:
//   • the document is VISIBLE (a background tab seeds nothing),
//   • the user has interacted within ACTIVE_MS (an idle tab is not scanning), and
//   • the last pack was NON-EMPTY, which is the server's own way of saying the
//     regular session is open (it returns an empty pack otherwise).
// An idle or hidden tab therefore costs ZERO requests — strictly cheaper than the
// old model, which fetched on every symbol change regardless. An actively scanning
// tab costs one request per REFRESH_MS, which is exactly the budget the old model
// already spent while scanning.
const ACTIVE_MS = 120_000       // "still scanning" window after the last interaction
const CLOSED_PROBE_MS = 300_000 // pack empty (session shut) → slow probe for the open
let _timer = null
let _lastInteraction = 0
let _wired = false
let _emptyAt = 0                // when we last saw an EMPTY pack (session not open)

function _isFresh() {
  return _pack && (Date.now() - _ts) < REFRESH_MS
}

/** Age of the loaded pack in ms; Infinity when nothing is loaded. */
export function todayPackAgeMs() {
  return _pack ? (Date.now() - _ts) : Infinity
}

/**
 * Whether the pack can currently answer a seed AT ALL — loaded, inside
 * MAX_SEED_AGE_MS, and non-empty. `getTodayBar` still decides per symbol; this is
 * the question the paint gate asks before it decides whether a first frame can be
 * assembled without the network.
 */
export function todayPackUsable() {
  return !!(_pack && _pack.d && todayPackAgeMs() <= MAX_SEED_AGE_MS)
}

function _shouldKeepWarm() {
  try {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
  } catch { /* non-browser */ }
  if (Date.now() - _lastInteraction > ACTIVE_MS) return false
  // Server says the session is shut (empty pack) → don't spin; probe slowly instead.
  if (_emptyAt && (Date.now() - _emptyAt) < CLOSED_PROBE_MS) return false
  return true
}

function _tick() {
  if (!_shouldKeepWarm()) return
  // Refresh BEFORE expiry, not after a symbol click discovers expiry.
  if (!_isFresh()) ensureTodayPack()
}

function _noteInteraction() {
  _lastInteraction = Date.now()
  // A click after a quiet spell must not wait a whole interval for the next tick.
  if (!_isFresh()) _tick()
}

function _wire() {
  if (_wired || typeof window === 'undefined') return
  _wired = true
  try {
    for (const ev of ['pointerdown', 'keydown', 'wheel']) {
      window.addEventListener(ev, _noteInteraction, { passive: true })
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') _noteInteraction()
    })
  } catch { /* SSR / locked-down host */ }
  _timer = setInterval(_tick, 15_000)   // cheap poll; _shouldKeepWarm gates the fetch
  try { if (_timer && typeof _timer.unref === 'function') _timer.unref() } catch { /* browser */ }
}

/** Test seam — stop the keep-warm timer and listeners. */
export function __stopKeepWarm() {
  if (_timer) { clearInterval(_timer); _timer = null }
  _wired = false
  _lastInteraction = 0
  _emptyAt = 0
}

async function _fetchPack() {
  // ⛔ NO `credentials` — DELIBERATE, AND THE WHOLE POINT OF THE EDGE CACHE. Sending
  // cookies makes Cloudflare treat the response as per-user and bypass the cache, so
  // every symbol switch would put a ~630KB build on the web pod instead of a PoP.
  // `/api/bars-history` — the sibling that measurably returns `cf-cache-status: HIT` —
  // fetches exactly this way. The endpoint carries no per-user data, so there is
  // nothing for a cookie to authorize.
  const r = await fetch('/api/bars-today-pack')
  if (!r.ok) throw new Error(`today-pack ${r.status}`)
  const j = await r.json()
  if (!j || typeof j !== 'object' || typeof j.bars !== 'object') throw new Error('today-pack shape')
  _pack = { d: j.d || '', bars: j.bars || {} }
  _ts = Date.now()
  // An empty pack is the server saying "no open regular session" (todaypack.py
  // gates on `_regular_session_has_opened_today`). Remember when we saw that so the
  // keep-warm loop backs off to a slow probe instead of polling a closed market.
  _emptyAt = _pack.d ? 0 : Date.now()
  return _pack
}

/**
 * Ensure a reasonably fresh pack is loaded. Safe to call on every chart mount —
 * concurrent calls share one request, and a fresh pack is a no-op.
 * Never throws: a failure just leaves the previous pack (or none) in place.
 */
export function ensureTodayPack() {
  if (_isFresh()) return Promise.resolve(_pack)
  if (_inflight) return _inflight
  _inflight = _fetchPack()
    .catch(() => _pack)          // keep the last good pack; the seed degrades to whitespace
    .finally(() => { _inflight = null })
  return _inflight
}

/**
 * Call when a chart mounts or switches symbol.
 *
 * ⭐ DEMAND-DRIVEN ON PURPOSE — THERE IS NO BACKGROUND TIMER. The pack is ~630KB
 * raw (~200KB gzipped) for an 11k-symbol universe; on a 45s interval that is ~16MB
 * an hour for a tab someone left open, to benefit a symbol they may never type.
 * Refreshing on symbol CHANGE instead spends bandwidth exactly when it pays: a
 * member scanning tickers keeps the pack hot for the next one, and an idle chart
 * costs nothing at all. The fetch started here is for the NEXT symbol — this one is
 * already served from whatever is in memory.
 */
export function touchTodayPack() {
  _lastInteraction = Date.now()
  _wire()
  return ensureTodayPack()
}

/**
 * Today's developing bar for `sym` as {o,h,l,c,v}, or null.
 *
 * Returns null when the pack is empty (the server sends an empty pack outside an
 * open regular session — deliberately, so the pre-open provider staleness that
 * caused the duplicate-candle incidents can never be seeded into a chart), when it
 * is older than MAX_SEED_AGE_MS, or when the symbol is not in it. Null always means
 * "fall back to the whitespace slot", i.e. exactly today's behaviour — never worse.
 */
export function getTodayBar(sym) {
  if (!sym || !_pack || !_pack.bars) return null
  if ((Date.now() - _ts) > MAX_SEED_AGE_MS) return null
  const row = _pack.bars[String(sym).toUpperCase()]
  if (!Array.isArray(row) || row.length < 5) return null
  const [o, h, l, c, v] = row
  if (!(o > 0) || !(h > 0) || !(l > 0) || !(c > 0)) return null
  return { o, h, l, c, v }
}

/** ISO date the loaded pack is for ('' when empty/unloaded). */
export function todayPackDate() {
  return _pack?.d || ''
}

/** Test seam — module state outlives a test file otherwise. */
export function __resetForTest() {
  _pack = null; _ts = 0; _inflight = null
  __stopKeepWarm()
}
