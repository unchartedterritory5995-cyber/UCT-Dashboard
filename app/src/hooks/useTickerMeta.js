import useSWR from 'swr'

// Frozen so the shared fallback can never be mutated by a consumer.
const NULLS = Object.freeze({ name: null, sector: null, industry: null, theme: null })

// Fetcher intentionally swallows all errors and returns NULLS rather than
// throwing: the watermark degrades silently (no error surface) — a failed
// meta lookup just means fewer lines, never a broken chart.
async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) return NULLS
  try {
    const j = await r.json()
    return { name: j?.name ?? null, sector: j?.sector ?? null, industry: j?.industry ?? null, theme: j?.theme ?? null }
  } catch {
    return NULLS
  }
}

// Per-symbol company metadata for the chart watermark. Never throws.
export default function useTickerMeta(sym) {
  const { data } = useSWR(
    sym ? `/api/ticker-meta/${encodeURIComponent(sym)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 3600000 }, // 1h — company meta is stable intraday
  )
  return data || NULLS
}
