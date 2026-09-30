// TERM-055 (FB-D5-01) — the chart SAYS when its prices are split-adjusted, instead of the
// adjustment happening silently. Owner ruling 2026-09-29: SPLITS ONLY, true today.
// Reads GET /api/adjustment-basis/{sym} (api/services/adjustment_basis.py) -- NOT the
// /api/bars/* spelling, which a Cloudflare Worker sends to the bars-api tier (404) -- whose
// `dividends` is always null by design -- so this label never mentions dividends.
//
// It renders ONLY on `splits === true` (a declared split, with its date). `false` (no split
// on record), `null` (undetermined), an unsupported timeframe and a failed request all render
// NOTHING: the label may be absent, it may never claim more than the endpoint knows.
import useSWR from 'swr'

const BASIS_TFS = new Set(['D', 'W', 'M'])

export function adjustmentText(basis) {
  if (!basis || basis.splits !== true || !basis.as_of) return null
  const by = basis.applied_by === 'vendor'
    ? 'by the data vendor'
    : 'by UCT (the vendor’s bars were not adjusted)'
  return {
    short: `Split-adjusted · last split ${basis.as_of}`,
    full: `Prices are split-adjusted through the ${basis.as_of} split, ${by}.`,
  }
}

// A failure THROWS (SWR records it as `error`, `data` stays undefined, the label renders
// nothing). It is never folded into a `null` answer (TERM-033's rail forbids that idiom).
const fetchBasis = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(`adjustment-basis ${r.status}`)
  return r.json()
})

export default function AdjustmentLabel({ sym, tf, className }) {
  const s = (sym || '').toUpperCase().trim()
  const t = String(tf || '').toUpperCase()
  const key = s && BASIS_TFS.has(t) && !s.startsWith('$')
    ? `/api/adjustment-basis/${encodeURIComponent(s)}?tf=${t}` : null
  const { data } = useSWR(key, fetchBasis, { revalidateOnFocus: false, dedupingInterval: 10 * 60 * 1000 })
  const text = adjustmentText(data?.adjustment_basis)
  if (!key || !text) return null
  return (
    <span className={className} title={text.full} data-testid="adjustment-label">
      {text.short}
    </span>
  )
}
