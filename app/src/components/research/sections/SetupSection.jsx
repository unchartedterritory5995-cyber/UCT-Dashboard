// app/src/components/research/sections/SetupSection.jsx
//
// §4.3.1 — the Setup canvas. ONE hero (ImpliedVsRealized), everything else is
// caption or support: the break-even strip, the key-stats grid, the 52-week
// range, and the consensus-estimate drift line. The gold budget for this
// canvas is spent entirely by the hero's own RICH/CHEAP chip (§3.1) — nothing
// below it may be gold, which is why every RangeSlider here is `tone="neutral"`.
//
// Own fetches, keyed off the settled `sym` the shell already debounced:
//   useFundamentals(sym)               -> key stats + 52-week range
//   GET /api/research/estimates/{sym}  -> consensus-drift stat (revisions[])
// `expectedMove` is NOT fetched here — the shell already holds it (one
// `useExpectedMove` call serves both the banner's Setup Grade chip and this
// hero, per the architecture note in api/routers/expected_move.py).
import { useMemo } from 'react'
import useSWR from 'swr'

import useFundamentals from '../../../hooks/useFundamentals'
import { EyebrowLabel, ImpliedVsRealized, RangeSlider, StatTile } from '../../research-kit'
import { SkeletonBlock } from '../../Skeleton'
import { IMPLIED_MOVE_INFO } from '../../../constants/disclaimer'
import { buildQuarters } from '../earningsHistoryModel'
import styles from './SetupSection.module.css'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)

// `Number(null) === 0` — the single most common defect on this branch (7
// prior tasks). Every formatter below routes through this so a missing value
// can never render as a phantom zero, and a genuine zero can never collapse
// to an em dash.
const num = (v) => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** `$X.XX`, or an em dash for a missing value — never `$0.00` for `null`. */
export const money = (v) => {
  const n = num(v)
  return n == null ? '—' : `$${n.toFixed(2)}`
}

/** Compact market cap: `$3.10T` / `$820M` / `$0` (a genuine zero still prints). */
export function compactCap(v) {
  const n = num(v)
  if (n == null) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

/** Compact average volume: `245.0M` / `0K` — the same null/zero split as above. */
export function compactVol(v) {
  const n = num(v)
  if (n == null) return '—'
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`
}

/** Fixed-decimal stat text (Fwd P/E, Beta). `0` renders as `0.0`, not `—`. */
export function fixedText(v, digits) {
  const n = num(v)
  return n == null ? '—' : n.toFixed(digits)
}

/** Dividend yield from a fraction: `0.0002` -> `0.02%`; `null` -> `—`. */
export function divYieldText(v) {
  const n = num(v)
  return n == null ? '—' : `${(n * 100).toFixed(2)}%`
}

/** "Priced ±X.X% " prefix for the break-even horizon line. Empty string (not
 *  a phantom "±0.0%") when the live pct itself is missing. */
export function moveText(pct) {
  const n = num(pct)
  return n == null ? '' : `Priced ±${Math.abs(n).toFixed(1)}% `
}

// The server's own label for tonight's report-quarter row
// (api/services/research/estimates.py `_PERIOD_LABEL["0q"] = "Current Qtr"`,
// and `_PERIOD_ORDER` walks `["0q","+1q","0y","+1y"]`). This is the ONLY
// revisions row this section may speak for.
const CURRENT_QTR_LABEL = 'Current Qtr'

/** "Est $0.94 · +4¢ / 30d" — the consensus estimate DRIFT for TONIGHT's
 *  quarter (§4.3.1b, §12: never "whisper"). Pinned to the server's
 *  `"Current Qtr"` row — NOT "the first row with a usable current estimate".
 *  Around a print the Current Qtr row's `current` frequently goes null
 *  (consensus resets post-report) while later periods ("Next Qtr"/"Current
 *  Yr") stay populated; walking the array for the first usable value would
 *  then silently present an annual or next-quarter number as tonight's
 *  estimate, with no period qualifier, inside a modal about tonight's print.
 *  A missing Current Qtr row (or a null `current` on it) means no drift line,
 *  full stop — never a fallback to a differently-scoped number. */
export function driftText(revisions) {
  const row = (revisions || []).find((r) => r?.period === CURRENT_QTR_LABEL)
  if (!row) return null
  const cur = num(row.current)
  if (cur == null) return null
  const ago = num(row.ago30)
  if (ago == null) return `Est ${money(cur)}`
  const cents = Math.round((cur - ago) * 100)
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '±'
  return `Est ${money(cur)} · ${sign}${Math.abs(cents)}¢ / 30d`
}

export default function SetupSection({ sym, row, reportDate, expectedMove }) {
  const { data: fundamentals } = useFundamentals(sym)
  // Normalized the same way useEstimates.js/useExpectedMove.js key their SWR
  // calls — a non-canonical-case `sym` (lowercase, stray whitespace) must not
  // fragment the cache from every other surface reading this endpoint.
  const s = (sym || '').toUpperCase().trim()
  const { data: estimates } = useSWR(
    s ? `/api/research/estimates/${encodeURIComponent(s)}` : null, fetcher,
    { refreshInterval: 0, revalidateOnFocus: false },
  )

  const quarters = useMemo(() => buildQuarters({
    beatHistory: row?.beat_history, histStats: row?.hist_stats, reportDate, row,
  }), [row, reportDate])

  const live = expectedMove?.live || null
  const history = expectedMove?.history || []
  const spot = num(live?.spot)
  const dollar = num(live?.dollar)
  const drift = driftText(estimates?.revisions)

  const lo52 = num(fundamentals?.week52_low)
  const hi52 = num(fundamentals?.week52_high)

  return (
    <div className={styles.wrap}>
      {/* HERO — the one instrument this canvas leads with. `recordedCount` is
          the endpoint's STORED snapshot array length: the "n/8 recorded"
          caption must never count tonight's live implied (P2 ruling). */}
      <ImpliedVsRealized
        quarters={quarters}
        impliedHistory={history}
        live={live}
        historySince={expectedMove?.history_since}
        recordedCount={history.length}
        info={IMPLIED_MOVE_INFO}
      />

      {/* `dollar != null` / `spot != null` — a genuine $0 move still draws a
          (degenerate) strip; only an actually-missing live payload omits it. */}
      {live && dollar != null && spot != null && (
        <div className={styles.breakeven} data-testid="setup-breakeven">
          <RangeSlider
            label="Break-even range"
            min={spot - dollar}
            max={spot + dollar}
            value={spot}
            minLabel={money(spot - dollar)}
            maxLabel={money(spot + dollar)}
            valueLabel={money(spot)}
            tone="neutral"
            info={IMPLIED_MOVE_INFO}
          />
          <div className={`${styles.horizon} t-num`}>
            {moveText(live.pct)}{live.horizon || (live.expiry ? `through ${live.expiry}` : '')}
          </div>
        </div>
      )}

      <EyebrowLabel>Key stats</EyebrowLabel>
      {!fundamentals ? (
        // `fundamentals` is `undefined` on EVERY user's first render (SWR
        // before its first resolve) — this is not a rare edge case, it is
        // what everyone sees first. data-testid so a test can assert this
        // branch renders without depending on a CSS-module class.
        <div data-testid="setup-stats-loading"><SkeletonBlock height={72} /></div>
      ) : (
        <div className={styles.stats} data-testid="setup-stats">
          <StatTile label="Mkt cap" value={compactCap(fundamentals.market_cap)} />
          <StatTile label="Fwd P/E" value={fixedText(fundamentals.forward_pe, 1)} />
          <StatTile label="Beta" value={fixedText(fundamentals.beta, 2)} />
          <StatTile label="Avg vol" value={compactVol(fundamentals.avg_vol)} />
          <StatTile label="Div yield" value={divYieldText(fundamentals.div_yield)} />
        </div>
      )}

      {lo52 != null && hi52 != null && (
        <div data-testid="setup-52w">
          <RangeSlider
            label="52-week range"
            min={lo52} max={hi52} value={spot}
            minLabel={money(lo52)} maxLabel={money(hi52)}
            valueLabel={spot != null ? money(spot) : undefined}
            tone="neutral"
          />
        </div>
      )}

      {drift && (
        <div className={`${styles.drift} t-num`} data-testid="setup-drift">{drift}</div>
      )}
    </div>
  )
}
