// D-9 (Personalization PRD UC-1): "a member's signal reaches a surface that did not
// compute it". ONE reader of GET /api/member/interest for every consumer, so the
// Research line, the Breadth drill, the Screener and the Morning Wire all ask the
// SAME SWR key (the server keeps a 15s per-member cache; the client dedupes too).
//
// PRESENCE ONLY. The resolver folds a failing source into an empty set, so the
// absence of a reason is never rendered as "not on your watchlist". Every helper
// here answers only what IS in the answer.
import useSWR from 'swr'
import { useAuth } from '../context/AuthContext'
import { depthFetcher } from '../pages/research/depth/depthFetch'

export const MEMBER_INTEREST_KEY = '/api/member/interest'
const SWR_OPTS = { revalidateOnFocus: false }

// The resolver's source vocabulary (api/services/member_interest.SOURCES), in words.
// A source this list does not know is shown by its own name, never dropped.
export const BECAUSE = {
  positions: 'in your open Journal positions',
  flagged: 'flagged by you',
  watchlist: 'on your watchlists',
  uct20: 'on the UCT 20',
}

export function interestReasons(entities, sym) {
  const e = entities?.[sym]
  if (!e || !Array.isArray(e.because) || e.because.length === 0) return []
  return e.because.map((b) => BECAUSE[b] || b)
}

/** The followed tickers among `syms`, in the order given (never re-ranked), each
 *  with its reasons in words. Duplicates and blanks are dropped. */
export function followedAmong(entities, syms) {
  const out = []
  const seen = new Set()
  for (const raw of syms || []) {
    const s = String(raw || '').toUpperCase().trim()
    if (!s || seen.has(s)) continue
    seen.add(s)
    const reasons = interestReasons(entities, s)
    if (reasons.length) out.push({ sym: s, reasons })
  }
  return out
}

/** The member's interest answer, or null. `enabled` false => no request at all. */
export function useMemberInterest(enabled = true) {
  const { data } = useSWR(enabled ? MEMBER_INTEREST_KEY : null, depthFetcher, SWR_OPTS)
  if (!enabled || !data || data.paywalled) return null
  return data
}

// The non-Research consumers' gates. The server sends each key ONLY when that
// surface is on (api/routers/auth.py::_member_interest_flags), so absent and false
// mean the same thing. Read `=== true`: an enablement gate never defaults to exposed.
// ⛔ Mirrors `_MEMBER_INTEREST_SURFACES` in auth.py; tests/test_member_interest_surfaces.py
// reads the Python tuple and asserts every key is listed here.
export const MEMBER_INTEREST_SURFACE_KEYS = [
  'member_interest_breadth_enabled',
  'member_interest_screener_enabled',
  'member_interest_wire_enabled',
]

export function readMemberInterestSurfaces(d) {
  const out = {}
  for (const k of MEMBER_INTEREST_SURFACE_KEYS) out[k] = d?.[k] === true
  return out
}

/** Is this D-9 consumer's gate on for the signed-in member? Reads the auth payload
 *  through `useAuth`; outside an AuthProvider (isolated component tests, embedded
 *  renders) useAuth throws, and that reads as OFF, never as exposed. */
export function useMemberInterestSurface(key) {
  try {
    return useAuth()?.memberInterestSurfaces?.[key] === true
  } catch {
    return false
  }
}
