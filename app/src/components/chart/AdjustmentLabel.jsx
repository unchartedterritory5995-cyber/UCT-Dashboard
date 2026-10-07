// TERM-055 (FB-D5-01) — the chart SAYS when its prices are split-adjusted, instead of the
// adjustment happening silently. Owner ruling 2026-09-29: SPLITS ONLY, true today.
// Reads GET /api/adjustment-basis/{sym} (api/services/adjustment_basis.py) -- NOT the
// /api/bars/* spelling, which a Cloudflare Worker sends to the bars-api tier (404) -- whose
// `dividends` is always null by design -- so this label never mentions dividends.
//
// It renders on `splits === true` (a declared split, with its date), and -- TERM-055
// remainder -- on `splits === false` WITH `unadjusted_split_at` (a declared split this series
// shows as an unapplied cliff; on intraday nothing heals one). `false` without a cliff (no
// split on record), `null` (undetermined), an unsupported timeframe and a failed request all
// render NOTHING: the label may be absent, it may never claim more than the endpoint knows.
//
// RAW VIEW (dark, RAW_PRICE_VIEW_ENABLED): only when the basis payload carries
// `raw_view: true` does an "As traded" toggle render, opening the vendor's unadjusted daily
// closes beside the adjusted ones around the split (GET /api/adjustment-basis/{sym}/raw).
// Gate off ⇒ the key is absent ⇒ the DOM is exactly the label alone.
import { useState } from 'react'
import useSWR from 'swr'
import { formatCurrency, formatNumberMax } from '../../lib/presentation/presentationPrimitives'
import styles from './AdjustmentLabel.module.css'

const BASIS_TFS = new Set(['D', 'W', 'M', '1', '5', '15', '30', '60'])

export function adjustmentText(basis) {
  if (!basis) return null
  if (basis.splits === false && basis.unadjusted_split_at) {
    const split = basis.as_of ? `the ${basis.as_of} split` : 'a declared split'
    return {
      short: `Not split-adjusted · cliff at ${basis.unadjusted_split_at}`,
      full: `Prices are NOT split-adjusted: ${split} shows as a price jump at ${basis.unadjusted_split_at}; bars before it are on the pre-split scale.`,
    }
  }
  if (basis.splits !== true || !basis.as_of) return null
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
const fetchJson = (url) => fetch(url, { credentials: 'include' }).then((r) => {
  if (!r.ok) throw new Error(`adjustment-basis ${r.status}`)
  return r.json()
})

function RawPanel({ sym, around }) {
  const key = `/api/adjustment-basis/${encodeURIComponent(sym)}/raw${around ? `?around=${encodeURIComponent(around)}` : ''}`
  const { data, error } = useSWR(key, fetchJson, { revalidateOnFocus: false, dedupingInterval: 10 * 60 * 1000 })
  let body
  if (error) body = <p className={styles.caption}>The as-traded prices could not be loaded.</p>
  else if (!data) body = <p className={styles.caption}>Loading as-traded prices…</p>
  else if (!data.available || !data.rows?.length) body = <p className={styles.caption}>The vendor returned no as-traded prices for this window.</p>
  else {
    body = (
      <table className={styles.table}>
        <thead>
          <tr><th>Session</th><th>As traded</th><th>Split-adjusted</th><th>Factor</th></tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => {
            const prev = data.rows[i - 1]
            const step = prev && prev.factor !== r.factor
            return (
              <tr key={r.t} className={step ? styles.split : undefined} data-testid="raw-row">
                <td>{r.t}</td>
                <td>{formatCurrency(r.raw?.c)}</td>
                <td>{formatCurrency(r.adjusted?.c)}</td>
                <td>{formatNumberMax(r.factor, { maxDecimals: 4 })}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }
  return (
    <div className={styles.panel} role="region" aria-label="As-traded prices" data-testid="raw-panel">
      <p className={styles.caption}>Daily closes from the data vendor, as traded and split-adjusted. The chart shows the split-adjusted series.</p>
      {body}
    </div>
  )
}

export default function AdjustmentLabel({ sym, tf, className }) {
  const s = (sym || '').toUpperCase().trim()
  const t = String(tf || '').toUpperCase()
  const key = s && BASIS_TFS.has(t) && !s.startsWith('$')
    ? `/api/adjustment-basis/${encodeURIComponent(s)}?tf=${t}` : null
  const { data } = useSWR(key, fetchJson, { revalidateOnFocus: false, dedupingInterval: 10 * 60 * 1000 })
  const [rawOpen, setRawOpen] = useState(false)
  const basis = data?.adjustment_basis
  const text = adjustmentText(basis)
  if (!key || !text) return null
  const label = (
    <span className={className} title={text.full} data-testid="adjustment-label">
      {text.short}
    </span>
  )
  if (data?.raw_view !== true) return label
  return (
    <span className={styles.wrap}>
      {label}
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={rawOpen}
        aria-label="Show as-traded (unadjusted) prices"
        onClick={() => setRawOpen((v) => !v)}
        data-testid="raw-toggle"
      >
        As traded
      </button>
      {rawOpen && <RawPanel sym={s} around={basis?.unadjusted_split_at || basis?.as_of} />}
    </span>
  )
}
