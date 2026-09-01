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
import { moveIsUnavailable, moveUnavailableTitle } from '../../../constants/expectedMoveOutcome'
import { buildQuarters } from '../earningsHistoryModel'
import SectionLead from '../SectionLead'
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

/** Market cap: pass-through, NOT a numeric formatter. `/api/fundamentals/{sym}`
 *  always sends `market_cap` already formatted (`"$1.23T"` / `"$820M"` / `"$0"`)
 *  or `null` — see api/routers/fundamentals.py's own comment on the field.
 *  A prior version ran this through `Number()` expecting a raw dollar amount;
 *  `Number("$138.79B")` is `NaN`, which silently fell back to the em dash and
 *  rendered "Mkt cap —" for every ticker (live-verified against UBER). */
export function compactCap(v) {
  return typeof v === 'string' && v.length > 0 ? v : '—'
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

/** Dividend yield — the endpoint already returns a PERCENT number, not a
 *  fraction: `2.81` -> `2.81%`; `null` -> `—`. Verified live against
 *  `/api/fundamentals/{sym}` (MCD -> 2.81, CAT -> 0.8) and against
 *  `api/services/fundamentals.py`'s own comment on `dividend_yield_pct`
 *  ("yfinance changed `dividendYield` semantics: it is now ALREADY a
 *  percent ... so no ×100. The old ×100 path displayed '37%' product-wide.")
 *  — the exact bug this function reintroduced. `FundamentalsStrip.jsx`'s
 *  `fmtPct` (same endpoint) already gets this right; this brings
 *  `SetupSection` in line with it rather than the other way around. */
export function divYieldText(v) {
  const n = num(v)
  return n == null ? '—' : `${n.toFixed(2)}%`
}

/** "Priced ±X.X% " prefix for the break-even horizon line. Empty string (not
 *  a phantom "±0.0%") when the live pct itself is missing. */
export function moveText(pct) {
  const n = num(pct)
  return n == null ? '' : `Priced ±${Math.abs(n).toFixed(1)}% `
}

/** The horizon clause the payload can speak for, or '' — never invented. */
function horizonOf(live) {
  return live?.horizon || (live?.expiry ? `through ${live.expiry}` : '')
}

/**
 * Sentence 1 of the canvas lead: what the options market is charging.
 *
 * DETERMINISTIC, and that is the point. Every value here is already on this
 * screen — nothing is generated, nothing is inferred, and there is no model
 * call to be slow or wrong. Prose about the company belongs in the Brief tab,
 * which is where a generated sentence can be checked against its sources.
 */
export function pricedLine(live) {
  const pct = num(live?.pct)
  if (pct == null) return null
  const horizon = horizonOf(live)
  return `Options price a ±${Math.abs(pct).toFixed(1)}% move${horizon ? ` ${horizon}` : ''}.`
}

/**
 * Sentence 2: how often this name has actually done that.
 *
 * Compares each PAST realized reaction against TONIGHT'S implied move — not
 * against each quarter's own recorded implied. That is deliberate, and it is
 * the only comparison the data supports today: the implied store keeps one
 * snapshot per report and starts empty, so most symbols have one or two
 * recorded quarters against eight of realized history. Waiting two years for
 * the paired form is not a plan; measuring the eight quarters we DO have
 * against the number that matters tonight is.
 *
 * ⛔ `q.reported !== false` — not `q.reported === true`. buildQuarters marks
 * the CURRENT quarter with `reported: false` and leaves the flag off entirely
 * on accrued history rows, so testing for a literal `true` would filter every
 * past quarter out and report "0 of its last 0 prints".
 */
export function recordLine(sym, quarters, live) {
  const pct = num(live?.pct)
  if (pct == null) return null
  const threshold = Math.abs(pct)
  const past = (quarters || []).filter(
    (q) => q?.reported !== false && num(q?.reaction_pct) != null,
  )
  if (!past.length) return null
  const cleared = past.filter((q) => Math.abs(num(q.reaction_pct)) > threshold).length
  const name = sym || 'This stock'
  const n = past.length
  const prints = `its last ${n} print${n === 1 ? '' : 's'}`
  // "after 0 of its last 8 prints" is accurate and reads like a bug. The
  // zero case is the most informative one on this canvas — the market is
  // pricing a move the stock has never made — so it gets plain words.
  return cleared === 0
    ? `${name} has not moved that much after any of ${prints}.`
    : `${name} has moved more than that after ${cleared} of ${prints}.`
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

export default function SetupSection({ sym, row, reportDate, expectedMove, livePrice = null }) {
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
  // WHY there is no live implied move, as `{kind, reason}` from the SAME
  // evaluation that withheld it (api/routers/expected_move.py `live_outcome`,
  // serialized by implied_move.wire_outcome — the one serializer the calendar
  // uses too, so the two surfaces cannot describe one absence two ways).
  //
  // This endpoint is where refusals actually reach members: the calendar skips
  // the live chain read for a past report, but the research modal asks for
  // every symbol it opens, so a refusal lands HERE first. Until this line
  // existed the payload was correct, tested, and read by nothing — the canvas
  // just quietly had no hero.
  //
  // ⛔ No reason token appears in this file, or anywhere under `app/src`. The
  // vocabulary belongs to `api/services/implied_move.py`; naming one here would
  // be a copy of a list that grows without us, and it is a backend test rail.
  const liveOutcome = expectedMove?.live_outcome ?? null
  const spot = num(live?.spot)
  const dollar = num(live?.dollar)
  const drift = driftText(estimates?.revisions)

  const lo52 = num(fundamentals?.week52_low)
  const hi52 = num(fundamentals?.week52_high)

  // ⭐ ONE PRICE IN THIS MODAL. The banner reads `useLivePrices`; this canvas
  // read `live.spot` off the expected-move payload — a DIFFERENT endpoint with
  // a different vintage — and stamped it, unlabelled, on both range markers.
  // Live-verified on DELL: banner $456.01, break-even marker $459.88, 52-week
  // marker $459.88, and nothing on screen said which one was "now".
  // The shell hands its own number down rather than this section opening a
  // second read of the same quantity; `spot` remains the fallback for a symbol
  // the live pool has no quote for.
  const marker = num(livePrice?.price) ?? spot
  const markerLabel = marker == null ? undefined : `Now ${money(marker)}`

  const priced = pricedLine(live)
  const record = recordLine(sym, quarters, live)

  return (
    <div className={styles.wrap}>
      {/* THE LEAD. The canvas used to open on the chart and let the reader
          assemble the read themselves; four instruments, no sentence, and the
          one thing that IS a judgement (the Setup Grade) was a grey chip in the
          far corner of the banner. Two derived sentences state the question
          this modal is opened to answer, and the hero below is the picture of
          the second one. */}
      <SectionLead testId="setup-lead">
        {priced ? `${priced}${record ? ` ${record}` : ''}` : null}
      </SectionLead>

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

      {/* PRICED WINS. This branch is reachable only when there is no live
          percentage to show, so a priced canvas renders byte-identically to
          before. And a canvas whose payload has not landed yet renders
          nothing: `expectedMove` is null until SWR resolves, so `liveOutcome`
          is null and `moveIsUnavailable` is false — the outcome's PRESENCE is
          the arrival signal, which is why no `enrichReady` is threaded here.
          The canvas has room for the plain words, so unlike the 112px calendar
          cell it says them instead of hiding them in a tooltip. */}
      {num(live?.pct) == null && moveIsUnavailable(liveOutcome) && (
        <div className={styles.moveNa} data-testid="setup-move-unavailable">
          {moveUnavailableTitle(liveOutcome)}
        </div>
      )}

      {/* `dollar != null` / `spot != null` — a genuine $0 move still draws a
          (degenerate) strip; only an actually-missing live payload omits it. */}
      {live && dollar != null && spot != null && (
        <div className={styles.breakeven} data-testid="setup-breakeven">
          <RangeSlider
            label="Break-even range"
            min={spot - dollar}
            max={spot + dollar}
            value={marker}
            minLabel={money(spot - dollar)}
            maxLabel={money(spot + dollar)}
            valueLabel={markerLabel}
            tone="neutral"
            info={IMPLIED_MOVE_INFO}
          />
          <div className={`${styles.horizon} t-num`}>
            {moveText(live.pct)}{horizonOf(live)}
          </div>
        </div>
      )}

      {/* The eyebrow and the grid it labels are ONE block, so the 24px canvas
          rhythm falls between blocks rather than between a label and the thing
          it names. */}
      <div className={styles.block}>
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

        {/* The consensus drift used to float unlabelled at the very bottom of
            the canvas, below the 52-week range and attached to nothing — an
            "Est $4.92 · +2¢ / 30d" with no word saying what it estimated. It is
            a stat, so it lives with the stats, and it says which quarter it is
            for. Still OUTSIDE the fundamentals gate above: it comes from a
            different endpoint and must not vanish while fundamentals load. */}
        {drift && (
          <div className={`${styles.drift} t-num`} data-testid="setup-drift">
            <span className={styles.driftKey}>Consensus, current quarter</span>
            {drift}
          </div>
        )}
      </div>

      {lo52 != null && hi52 != null && (
        <div data-testid="setup-52w">
          <RangeSlider
            label="52-week range"
            min={lo52} max={hi52} value={marker}
            minLabel={money(lo52)} maxLabel={money(hi52)}
            valueLabel={markerLabel}
            tone="neutral"
          />
        </div>
      )}
    </div>
  )
}
