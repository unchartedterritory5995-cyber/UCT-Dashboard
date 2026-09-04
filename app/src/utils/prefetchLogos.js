// app/src/utils/prefetchLogos.js
//
// Warm the browser's HTTP cache for company logos AHEAD of render, so the first
// time a list opens the real logos are already on disk — no monogram flash.
//
// It fires the SAME bare `/api/ticker-logo/{SYM}?v=` URL that CompanyLogo requests
// (see the cache-key note there): the browser dedupes a prefetch and the later
// <img> to one request, and once cached (immutable ~1yr) every later view is a
// zero-network read. Low-priority, deduped for the session, and bounded so a giant
// scan list can't fire thousands at once.
import { LOGO_ASSET_VERSION } from '../components/CompanyLogo'

const _warmed = new Set()          // session-dedup: never warm the same symbol twice
const MAX_PER_CALL = 300           // bound a single call (huge scan lists)

export function prefetchLogos(syms, { max = MAX_PER_CALL } = {}) {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return
  if (!syms) return
  const list = Array.isArray(syms) ? syms : Array.from(syms)
  let fired = 0
  for (const raw of list) {
    if (fired >= max) break
    const s = String(raw || '').toUpperCase().trim()
    // Skip blanks, dupes, and UCT pseudo-tickers (breadth/index syms render the
    // brand mark, not a fetched logo — CompanyLogo's brandMark path).
    if (!s || _warmed.has(s)) continue
    _warmed.add(s)
    fired++
    try {
      const img = new Image()
      img.decoding = 'async'
      // Hint the browser this is background work so it never contends with
      // critical requests (live prices, bars). Not all browsers honor it; harmless.
      try { img.fetchPriority = 'low' } catch { /* older browsers */ }
      img.src = `/api/ticker-logo/${encodeURIComponent(s)}?v=${LOGO_ASSET_VERSION}`
    } catch { /* never throw from a prefetch */ }
  }
}
