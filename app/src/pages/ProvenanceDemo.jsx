// app/src/pages/ProvenanceDemo.jsx
//
// S8 Step 2 (owner authorization, 2026-09-02) — the "visible Terminal value"
// deliverable: a real, live D1 -> S8 wire, not just another unit-tested
// component in isolation. Fetches `/api/provenance/quote` (the new, minimal
// endpoint this same pass added) and renders each vendor's quote through
// `<Provenance>` + `<FreshnessBadge>`, demonstrating exactly the example the
// authorization named:
//
//   $505.24 · Massive · LIVE · Observed 10:32:14 PM ET
//   $505.09 · FMP · DELAYED 15 MIN · Observed 10:17:01 PM ET
//
// ⚠️ NOT a product placement decision. This route is deliberately NOT added
// to NavBar/MobileNav or any FREE_PAGES list — where this capability
// eventually belongs in the real Terminal UI (a dashboard tile? inside
// TickerPopup? a dedicated panel?) is a product decision this pass does not
// make. It IS a real, reachable route (unlike Step 1's components, which
// carry AWAITING_A_DECISION entries) specifically so the wire is proven
// end-to-end, not merely asserted in a mocked test.

import { useEffect, useState } from 'react'
import Provenance from '../components/provenance/Provenance'
import FreshnessBadge from '../components/provenance/FreshnessBadge'
import Cited from '../components/provenance/Cited'
import { mapAvailability, AVAILABLE } from '../components/provenance/availabilityContract'
import { formatPrice, epochSecondsToIso } from '../components/provenance/presentationFormat'
import { sessionModel } from '../components/dashboard/sessionModel'
import useMarketOpen from '../hooks/useMarketOpen'
import jsonFetcher from '../utils/jsonFetcher'
import styles from './ProvenanceDemo.module.css'

const VENDOR_LABEL = { massive: 'Massive', fmp: 'FMP' }

/** ⛔ DEMO-SPECIFIC EXTRACTION, NOT A NEW NORMALIZATION LAYER. D1
 *  deliberately does not normalize vendor payload shapes (that is D2's job,
 *  not built) — this pulls "the headline price" out of each vendor's own
 *  raw shape purely for THIS display, never asserting the two numbers are
 *  computed the same way. If a future page needs this, it is D2's
 *  normalization to build, not a reason to promote this out of this file. */
function headlinePrice(vendor, rawValue) {
  if (!rawValue) return null
  if (vendor === 'fmp') {
    const row = Array.isArray(rawValue) ? rawValue[0] : rawValue
    return row?.price ?? null
  }
  if (vendor === 'massive') {
    return rawValue?.day?.c ?? rawValue?.lastTrade?.p ?? rawValue?.prevDay?.c ?? null
  }
  return null
}

function VendorRow({ vendor, result }) {
  const availability = mapAvailability(result)
  const label = VENDOR_LABEL[vendor] || vendor

  if (availability !== AVAILABLE) {
    return (
      <div className={styles.row} data-testid={`vendor-row-${vendor}`}>
        <span className={styles.vendor}>{label}</span>
        <Provenance value={null} availability={availability} />
      </div>
    )
  }

  const price = headlinePrice(vendor, result.value)
  const asOfIso = epochSecondsToIso(result.provenance?.source_observed_at)

  return (
    <div className={styles.row} data-testid={`vendor-row-${vendor}`}>
      <span className={styles.vendor}>{label}</span>
      <Provenance
        value={formatPrice(price)}
        provenance={result.provenance && {
          sourceActivity: result.provenance.source_activity,
          timestamp: asOfIso,
          tieBreak: result.provenance.tie_break,
        }}
      />
      <FreshnessBadge freshnessClass={result.freshness} asOf={asOfIso} />
    </div>
  )
}

/** Today's most recent daily-bar time, midnight UTC — the conventional key
 *  for a daily bar's own `bar_time`. A best-effort illustrative lookup: if
 *  nothing has been recorded for this exact bar yet, `<Cited>` renders its
 *  own honest "citation unavailable" state (a real, valid outcome — see
 *  Cited.jsx), not an error. */
function todayDailyBarTime() {
  const d = new Date()
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000)
}

function CitedBarExample({ symbol }) {
  const [row, setRow] = useState(undefined) // undefined = loading, null = confirmed absent
  useEffect(() => {
    let cancelled = false
    setRow(undefined)
    const barTime = todayDailyBarTime()
    jsonFetcher(`/api/provenance/bar?ticker=${encodeURIComponent(symbol)}&tf=D&bar_time=${barTime}`)
      .then((data) => { if (!cancelled) setRow(data) })
      .catch(() => { if (!cancelled) setRow(null) }) // 404 (genuinely absent) or network — both honest absence here
    return () => { cancelled = true }
  }, [symbol])

  if (row === undefined) return <Provenance value={null} loading />
  return (
    <div className={styles.row} data-testid="cited-bar-example">
      <span className={styles.vendor}>Daily bar</span>
      <Cited row={row}><span>{symbol} · D</span></Cited>
    </div>
  )
}

export default function ProvenanceDemo() {
  const [symbol, setSymbol] = useState('AAPL')
  const [inputValue, setInputValue] = useState('AAPL')
  const [state, setState] = useState({ loading: true, data: null })
  const session = useMarketOpen()

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, data: null })
    // jsonFetcher (SPEC-S8 §3.6's own cited primitive: "the one throwing
    // fetcher... S8 renders what it resolves to") — never a bare
    // `fetch(...).then(r => r.json())`, which treats a non-2xx JSON body as
    // valid data (the exact TD-18 shape jsonFetcher.test.js's AST census
    // fails a build on). A rejection here (network down, or the endpoint
    // itself answering non-2xx) is an honest "down" fact, never data.
    jsonFetcher(`/api/provenance/quote?symbol=${encodeURIComponent(symbol)}`)
      .then((data) => { if (!cancelled) setState({ loading: false, data }) })
      .catch(() => {
        if (!cancelled) {
          setState({
            loading: false,
            data: { symbol, vendors: { massive: { error: true, kind: 'transient' }, fmp: { error: true, kind: 'transient' } } },
          })
        }
      })
    return () => { cancelled = true }
  }, [symbol])

  const sessionState = sessionModel(session)

  return (
    <main className={styles.page} data-testid="provenance-demo-page">
      <h1>Provenance &amp; Freshness — Live Trust Layer</h1>
      <p className={styles.intro}>
        One symbol, every configured vendor&rsquo;s own quote — source, freshness,
        and as-of, side by side. This is a capability demonstration for S8
        Step 2, not a finished product placement.
      </p>

      <form
        className={styles.form}
        onSubmit={(e) => { e.preventDefault(); setSymbol(inputValue.trim().toUpperCase() || 'AAPL') }}
      >
        <label htmlFor="provenance-demo-symbol">Symbol</label>
        <input
          id="provenance-demo-symbol"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          data-testid="provenance-demo-input"
        />
        <button type="submit" data-testid="provenance-demo-submit">Look up</button>
      </form>

      <span className={styles.session} data-testid="provenance-demo-session">
        {sessionState.label}
      </span>

      {state.loading ? (
        <Provenance value={null} loading />
      ) : (
        <div className={styles.rows}>
          {Object.entries(state.data?.vendors || {}).map(([vendor, result]) => (
            <VendorRow key={vendor} vendor={vendor} result={result} />
          ))}
        </div>
      )}

      <h2 className={styles.sectionHeading}>Citation detail (bars)</h2>
      <p className={styles.intro}>
        <code>&lt;Cited&gt;</code>&rsquo;s narrow interim form (SPEC-S8 §4.5), against
        real <code>bar_provenance.py</code> data — click to see source and
        reconciliation status one level deep.
      </p>
      <CitedBarExample symbol={symbol} />
    </main>
  )
}
