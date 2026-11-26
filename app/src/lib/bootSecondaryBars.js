// app/src/lib/bootSecondaryBars.js
//
// ─── ⭐⭐ (2026-11-26, Fred RS load time) THE OTHER SYMBOLS A CHART PAGE NEEDED, ASKED AS THE PAGE LOADS ────────────────
//
// ⚰️ Measured on production (ecc0bb94, AGL 1D, a reload with Fred RS on the layout): Fred RS drew 3,174 ms after the
// navigation, long after the candles. Its benchmark (SP:SPX, 12,500 daily rows) is asked by `useSecondarySources` only
// once the chart has mounted AND the layout AND the member's definitions have landed (the chart cannot know what a script
// reads before its definition is in the registry), so the benchmark's round trip started after the definitions' and ran
// behind the chart's own bars.
//
// So every chart page REMEMBERS the other-symbol windows its charts need right now (`noteSecondaryNeeds`, written by
// `useSecondarySources` on each needed-set change), and the next load of the SAME page asks for them the moment the entry
// bundle runs (`startBootSecondaryBars`, from `bootFetchStart.js`), beside `/api/auth/me` and the preferences. The chart's
// own fetch of that URL adopts the answer (`takeBootSecondaryBars`, in `secondaryBars.fetchSecondaryBars`).
//
// Rules, each one load-bearing:
//  * The SAME page only (pathname), only for a browser that was signed in last time (`uct.signedIn.v1`), only for windows
//    remembered within SECONDARY_NEEDS_MAX_AGE_MS, at most SECONDARY_NEEDS_MAX of them, `/api/bars/` URLs only. A page that
//    no longer needs a window stops remembering it on its next needed-set change (the record is the CURRENT set, never a
//    history), so a removed indicator costs at most one extra request on the next load.
//  * One use. A taken answer is gone; a later ask of the same URL fetches as it always did.
//  * Fresh only. An answer older than BOOT_SECONDARY_MAX_AGE_MS is never handed out: the caller fetches.
//  * A failed or non-ok boot request is "no answer" (TERM-033's idiom), never an empty series: the caller fetches, and that
//    request reports its own error. The bars route's own status rules (a 403 is a denial) therefore stay where they are.
//  * Market data only: a bars window is the same for every member, and the request carries the session cookie exactly as
//    the chart's own would.

export const SECONDARY_NEEDS_KEY = 'uct.secondaryNeeds.v1'
export const SECONDARY_NEEDS_MAX = 4
export const SECONDARY_NEEDS_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
export const BOOT_SECONDARY_MAX_AGE_MS = 60_000
const SIGNED_IN_HINT = 'uct.signedIn.v1'
const BARS_PREFIX = '/api/bars/'

const entries = new Map()   // url -> { at, p }
const needsByChart = new Map()   // chart slot -> urls (this page's charts, right now)
let writeTimer = null

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

function safeStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}
function pathNow() {
  try { return typeof location !== 'undefined' ? location.pathname : '' } catch { return '' }
}

/** The remembered windows for `path` (fresh ones, at most SECONDARY_NEEDS_MAX), from storage. Exported for its rail. */
export function rememberedSecondaryNeeds(path, { storage = safeStorage(), wallNow = Date.now() } = {}) {
  let rec = null
  try { rec = JSON.parse(storage?.getItem(SECONDARY_NEEDS_KEY) || 'null') } catch { rec = null }
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.urls) || rec.path !== path) return []
  if (!(Number.isFinite(rec.at) && wallNow - rec.at >= 0 && wallNow - rec.at < SECONDARY_NEEDS_MAX_AGE_MS)) return []
  return rec.urls.filter((u) => typeof u === 'string' && u.startsWith(BARS_PREFIX)).slice(0, SECONDARY_NEEDS_MAX)
}

/** main.jsx (through `bootFetchStart.js`) calls this once, before the app renders. */
export function startBootSecondaryBars({ fetchImpl = (typeof fetch === 'function' ? fetch : null), storage = safeStorage(),
  path = pathNow(), wallNow = Date.now() } = {}) {
  if (!fetchImpl || entries.size) return 0
  let signedIn = false
  try { signedIn = storage?.getItem(SIGNED_IN_HINT) === '1' } catch { /* storage blocked */ }
  if (!signedIn) return 0
  const urls = rememberedSecondaryNeeds(path, { storage, wallNow })
  for (const url of urls) {
    entries.set(url, {
      at: now(),
      p: Promise.resolve()
        .then(() => fetchImpl(url, { credentials: 'same-origin' }))
        .then((r) => (r && r.ok ? r.json() : null))
        .then((payload) => (payload && typeof payload === 'object' ? payload : null), () => null),
    })
  }
  return urls.length
}

/** `secondaryBars.fetchSecondaryBars`: the boot answer for `url` (a Promise of the payload, or of null when the boot
 *  request failed), or null when there is none or it is too old. One use. */
export function takeBootSecondaryBars(url) {
  const e = entries.get(url)
  if (!e) return null
  entries.delete(url)
  if (now() - e.at > BOOT_SECONDARY_MAX_AGE_MS) return null
  return e.p
}

/** `useSecondarySources`: the windows chart `slot` needs right now (an empty list or null when it needs none). The page's
 *  record is the union over its charts, written after the current task. */
export function noteSecondaryNeeds(slot, urls, { storage = safeStorage(), path = pathNow(), schedule = defaultSchedule } = {}) {
  const list = Array.isArray(urls) ? urls.filter((u) => typeof u === 'string' && u.startsWith(BARS_PREFIX)) : []
  const before = needsByChart.get(slot)
  if (!list.length) { if (!before) return; needsByChart.delete(slot) } else {
    if (before && before.length === list.length && before.every((u, i) => u === list[i])) return
    needsByChart.set(slot, list)
  }
  if (writeTimer !== null) return
  writeTimer = 'scheduled'
  const handle = schedule(() => {
    writeTimer = null
    const union = [...new Set([...needsByChart.values()].flat())].slice(0, SECONDARY_NEEDS_MAX)
    try {
      if (union.length) storage?.setItem(SECONDARY_NEEDS_KEY, JSON.stringify({ path, at: Date.now(), urls: union }))
      else storage?.removeItem(SECONDARY_NEEDS_KEY)
    } catch { /* storage full or blocked: the next load just asks later */ }
  })
  if (writeTimer !== null) writeTimer = handle
}
function defaultSchedule(fn) { return setTimeout(fn, 0) }

/** `useSecondarySources`, when chart `slot` unmounts: it leaves the union, and the record is NOT rewritten (a page being
 *  left, or a reload, keeps what it needed; only a needed-set change rewrites it). */
export function forgetSecondaryNeeds(slot) { needsByChart.delete(slot) }

/** Tests only. */
export function __resetBootSecondaryForTests() {
  entries.clear(); needsByChart.clear()
  if (writeTimer !== null) { try { clearTimeout(writeTimer) } catch { /* not a timer */ } writeTimer = null }
}
