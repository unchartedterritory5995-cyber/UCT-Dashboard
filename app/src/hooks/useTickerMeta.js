import useSWR from 'swr'

const NULLS = { name: null, sector: null, industry: null }

async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) return NULLS
  try {
    const j = await r.json()
    return { name: j?.name ?? null, sector: j?.sector ?? null, industry: j?.industry ?? null }
  } catch {
    return NULLS
  }
}

// Per-symbol company metadata for the chart watermark. Never throws.
export default function useTickerMeta(sym) {
  const { data } = useSWR(
    sym ? `/api/ticker-meta/${sym}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 3600000 },
  )
  return data || NULLS
}
