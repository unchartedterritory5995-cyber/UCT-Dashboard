import { useMemo } from 'react'
import useSWR, { preload } from 'swr'

// Frozen so the shared fallback can never be mutated by a consumer.
const NULLS = Object.freeze({ name: null, sector: null, industry: null, theme: null })

// ── localStorage layer: instant watermark on first paint ──
// SWR's in-memory cache is empty on every page load, so without this the
// watermark renders ticker-only and then "pops in" the company/sector/theme
// ~half a second later when the network fetch resolves. Company name, sector,
// industry, and primary theme are extremely stable, so we persist them to
// localStorage and seed SWR's `fallbackData` from it — the full watermark
// paints synchronously on the very first frame for any previously-seen ticker.
// SWR still revalidates in the background (revalidateIfStale) so a changed
// theme/taxonomy edit is picked up within the session.
const LS_PREFIX = 'tmeta:'
const LS_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

function lsGet(sym) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + sym)
    if (!raw) return undefined
    const { t, d } = JSON.parse(raw)
    if (!t || Date.now() - t > LS_TTL || !d) return undefined
    return d
  } catch {
    return undefined // private mode / disabled storage — degrade to network fetch
  }
}

function lsPut(sym, data) {
  // Only persist a real hit — never cache an all-null transient miss.
  if (!sym || !data || !(data.name || data.sector || data.industry || data.theme)) return
  try {
    localStorage.setItem(LS_PREFIX + sym, JSON.stringify({ t: Date.now(), d: data }))
  } catch {
    /* quota exceeded / private mode — non-fatal, watermark just isn't pre-warmed */
  }
}

// Root cause of the "watermark only shows the ticker for an hour" bug:
// the old fetcher swallowed every failure and returned NULLS as a *successful*
// value. SWR then cached that transient miss (e.g. a cold-start backend right
// after a redeploy) as authoritative and — with a 1h dedupe + no revalidation
// — never recovered within the session.
//
// Fix: a failure must be an ERROR, not cached data. We THROW on !ok / parse
// failure so SWR error-handles + retries instead of pinning NULLS, and the
// hook self-heals quickly (short dedupe + revalidate-if-stale). The component
// still degrades gracefully to NULLS while loading/erroring (chart just shows
// the ticker line until real data arrives, then upgrades).
export async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`ticker-meta ${r.status}`)
  const j = await r.json() // a malformed body throws → SWR retries (not cached)
  return { name: j?.name ?? null, sector: j?.sector ?? null, industry: j?.industry ?? null, theme: j?.theme ?? null }
}

// Warm the cache for a ticker BEFORE its chart mounts (call on hover/selection).
// Populates both the SWR memory cache (same key the hook reads) and localStorage
// so a first-ever view of the ticker paints its full watermark instantly too.
export function prefetchTickerMeta(sym) {
  if (!sym || lsGet(sym)) return // already warm
  preload(`/api/ticker-meta/${encodeURIComponent(sym)}`, async (url) => {
    const d = await fetcher(url)
    lsPut(sym, d)
    return d
  })
}

// Per-symbol company metadata for the chart watermark. Never throws to the
// component; returns NULLS until real data resolves.
export default function useTickerMeta(sym) {
  // Synchronous localStorage seed, recomputed only when the symbol changes
  // (avoids a storage read on every chart tick re-render).
  const fallbackData = useMemo(() => (sym ? lsGet(sym) : undefined), [sym])

  const { data } = useSWR(
    sym ? `/api/ticker-meta/${encodeURIComponent(sym)}` : null,
    fetcher,
    {
      fallbackData,               // instant first paint from localStorage
      revalidateOnFocus: false,   // don't refetch on every tab focus (decorative)
      revalidateOnReconnect: true,
      revalidateIfStale: true,    // a stale/transient miss self-corrects on next view
      dedupingInterval: 60000,    // 1 min — long enough to dedupe a render storm,
                                  // short enough that a transient miss recovers fast
      errorRetryCount: 4,
      errorRetryInterval: 4000,   // ~4s backoff — recovers within seconds, not an hour
      onSuccess: (d) => lsPut(sym, d), // persist real hits for instant future paints
    },
  )
  return data || NULLS
}
