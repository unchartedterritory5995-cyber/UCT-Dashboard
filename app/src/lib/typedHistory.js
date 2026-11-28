// ⭐ (2026-11-28, zero-network plan 1.4) WHAT THIS MEMBER OPENS, FOR THE TYPED CANDIDATE POOL.
//
// The chart's symbol search warms the tickers the typed text can still become (lib/tickerUniverse rankedCompletions,
// data/barStore/prefetch warmTypedCandidates) before Enter. Which completions lead is decided by THIS member first: a
// ticker they opened recently, then what their charts show, then the market's popularity, then A-Z. A typed or searched
// ticker counts 1, a symbol a chart showed counts SHOWN_WEIGHT; every score halves every HALF_LIFE_MS (14 days), so last
// month's names give way to this week's without a reset. Kept in localStorage (MAX_ENTRIES, the weakest dropped first);
// every reader is synchronous and never throws (a missing or broken store reads as no history).

const STORE_KEY = 'uct.typedHistory'
export const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000
export const SHOWN_WEIGHT = 0.25
export const MAX_ENTRIES = 400
const WRITE_DEBOUNCE_MS = 1500

let _map = null          // SYM -> { s: score at `at`, at: ms }
let _writeTimer = null

function _load() {
  if (_map) return _map
  _map = new Map()
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null
    const o = raw ? JSON.parse(raw) : null
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (v && Number.isFinite(v.s) && Number.isFinite(v.at)) _map.set(k, { s: v.s, at: v.at })
      }
    }
  } catch { /* a broken copy reads as no history */ }
  return _map
}

const _decayed = (e, nowMs) => (e ? e.s * Math.pow(0.5, Math.max(0, nowMs - e.at) / HALF_LIFE_MS) : 0)

function _persist() {
  if (_writeTimer != null) return
  const write = () => {
    _writeTimer = null
    try {
      const o = {}
      for (const [k, v] of _map) o[k] = v
      localStorage.setItem(STORE_KEY, JSON.stringify(o))
    } catch { /* a full store: memory only */ }
  }
  try { _writeTimer = setTimeout(write, WRITE_DEBOUNCE_MS) } catch { write() }
}

/** Count `sym` as opened now (`weight` 1: typed or searched; SHOWN_WEIGHT: a chart showed it). Never throws. */
export function noteOpened(sym, { weight = 1, nowMs = Date.now() } = {}) {
  const k = String(sym || '').trim().toUpperCase()
  if (!k || !(weight > 0)) return
  const m = _load()
  const s = _decayed(m.get(k), nowMs) + weight
  m.delete(k)
  m.set(k, { s, at: nowMs })
  if (m.size > MAX_ENTRIES) {
    let weakest = null, low = Infinity
    for (const [kk, e] of m) { if (kk === k) continue; const d = _decayed(e, nowMs); if (d < low) { low = d; weakest = kk } }
    if (weakest) m.delete(weakest)
  }
  _persist()
}

/** This member's score for `sym` now (0 when never opened). */
export function historyScore(sym, nowMs = Date.now()) {
  return _decayed(_load().get(String(sym || '').trim().toUpperCase()), nowMs)
}

/** Tests: forget everything (and, with `cache`, this browser's copy). */
export function __resetTypedHistoryForTests({ cache = true } = {}) {
  if (_writeTimer != null) { try { clearTimeout(_writeTimer) } catch { /* */ } }
  _writeTimer = null
  _map = null
  if (cache) { try { localStorage.removeItem(STORE_KEY) } catch { /* */ } }
}

/** Tests: write the pending copy now. */
export function __flushTypedHistoryForTests() {
  if (_writeTimer == null) return
  clearTimeout(_writeTimer)
  _writeTimer = null
  try {
    const o = {}
    for (const [k, v] of _load()) o[k] = v
    localStorage.setItem(STORE_KEY, JSON.stringify(o))
  } catch { /* */ }
}
