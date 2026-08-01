// app/src/hooks/useSignatureIndicators.js — the three Signature indicators
// (dark-pool levels, GEX walls, flow-confirmed breakouts) as chart-ready arrays.
//
// Thin by design: SWR fetch + the already-tested pure transforms in
// components/chart/signatureData.js. Every return value is an array, always —
// `[]` while loading, disabled, unpaid, or failed — so the StockChart wiring
// stays branch-free and never has to ask "did this indicator fail?".
//
// SUPPRESSION (the usePatternDetections idiom): a null SWR key makes no request
// at all. Unpaid, no symbol, or the toggle off ⇒ null key ⇒ zero traffic. That
// null key — not a caught error — is what guarantees an unpaid chart never
// storms the paid-gated endpoints with 402s.
import { useMemo } from 'react'
import useSWR from 'swr'
import {
  dpToPriceLines,
  dpToZones,
  gexToPriceLines,
  flowToMarkers,
} from '../components/chart/signatureData'

/**
 * The chart_settings keys that drive these fetches — the contract with
 * CHART_DEFAULTS.signature (chartDefaults.js).
 *
 * Read sites index THROUGH these constants and never hard-code the strings, so
 * the contract test cannot pass while the hook is actually reading a different
 * key. Renaming a toggle on either side turns the test red.
 */
export const SIGNATURE_TOGGLE = {
  dpl: 'darkPoolLevels',
  gxw: 'gexWalls',
  fcb: 'flowSignals',
}

// StockChart's own timeframe taxonomy (see its chartEventMarkers / newsMarkers
// memos, which gate on exactly this list).
const INTRADAY_TFS = new Set(['1', '5', '15', '30', '60'])

/**
 * The three SWR keys for this (symbol, settings, plan, timeframe) — null where
 * the request must be suppressed. Pure + exported so the gating is testable
 * without rendering anything.
 *
 * `tf` is optional: omit it and the flow-breakout key behaves as if daily.
 */
export function signatureUrls(sym, cfg, isPaid, tf) {
  const s = typeof sym === 'string' ? sym.trim() : ''
  if (!isPaid || !s) return { dpl: null, gxw: null, fcb: null }
  const q = encodeURIComponent(s)
  const on = (k) => !!(cfg && cfg[k])
  return {
    dpl: on(SIGNATURE_TOGGLE.dpl) ? `/api/signature/darkpool-levels?sym=${q}` : null,
    gxw: on(SIGNATURE_TOGGLE.gxw) ? `/api/signature/gex-walls?sym=${q}` : null,
    // FCB signals are detected on, and recorded against, DAILY bars — their
    // `barTime` is a calendar key that becomes an ISO date string. Lightweight
    // Charts does NOT drop a marker whose time is absent from the series: it
    // SNAPS it to the nearest bar (`_recalculateMarkers` → timeToIndex(t, true)
    // → NearestLeft/NearestRight). On an intraday chart that would plant a
    // confident arrow on an arbitrary bar, so the request is suppressed there —
    // the same reason chartEventMarkers/newsMarkers are daily-gated.
    fcb: on(SIGNATURE_TOGGLE.fcb) && !INTRADAY_TFS.has(String(tf))
      ? `/api/signature/flow-breakout?sym=${q}`
      : null,
  }
}

// Quiet on purpose: no console noise on a 402/5xx. The endpoints are paid-gated
// and Schwab-auth-dependent, so a non-OK response is a routine state, not an
// incident — it surfaces as an absent overlay, never as an error UI.
const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

const OPTS = {
  refreshInterval: 120_000,
  revalidateOnFocus: false,
  dedupingInterval: 30_000,
}

/**
 * @returns {{dpLines: Array, dpZones: Array, gexLines: Array, flowMarkers: Array}}
 *
 * Each result is memoized on its SWR payload, NOT rebuilt per render: StockChart
 * feeds these into reference-guarded appliers (mergedPriceLines tears down and
 * rebuilds every price line when its array identity changes), so a fresh array
 * per render would rebuild the whole overlay on every live tick.
 */
export function useSignatureIndicators(sym, cfg, isPaid, tf) {
  const urls = signatureUrls(sym, cfg, isPaid, tf)
  const { data: dp } = useSWR(urls.dpl, fetcher, OPTS)
  const { data: gex } = useSWR(urls.gxw, fetcher, OPTS)
  const { data: fcb } = useSWR(urls.fcb, fetcher, OPTS)

  const dpLines = useMemo(() => dpToPriceLines(dp), [dp])
  const dpZones = useMemo(() => dpToZones(dp), [dp])
  const gexLines = useMemo(() => gexToPriceLines(gex), [gex])
  const flowMarkers = useMemo(() => flowToMarkers(fcb), [fcb])

  return { dpLines, dpZones, gexLines, flowMarkers }
}

export default useSignatureIndicators
