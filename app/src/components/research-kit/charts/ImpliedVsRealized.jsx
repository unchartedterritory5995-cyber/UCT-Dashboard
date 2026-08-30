// app/src/components/research-kit/charts/ImpliedVsRealized.jsx

import useMeasuredWidth from './useMeasuredWidth'
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import VerdictChip from '../VerdictChip'
import styles from './ImpliedVsRealized.module.css'

// `width` is the FALLBACK only. The rendered chart re-cuts its viewBox to the
// wrapper's MEASURED pixel width (see `useMeasuredWidth`) so the viewBox scale
// is always exactly 1 and one viewBox unit is one CSS pixel. Before that, the
// svg was `width:100%` with a fixed 320-unit box and `meet`, which is
// HEIGHT-limited at any container wider than 320px: scale pinned at
// min(boxW/320, 140/140) = 1, so the chart drew 320px wide and centred inside
// the modal's ~604px canvas — 53% of its width, with ~140px of dead margin on
// each side, and the labels stuck at their literal 7-8 unit sizes.
export const VIEWBOX = { width: 320, height: 140 }
/** §3.4 skeleton size contract. The HEIGHT is what a skeleton has to reserve;
 *  the width is fluid by design and always was (`SIZE.width === '100%'`). */
export const SIZE = { width: '100%', height: VIEWBOX.height }

const PAD_TOP = 12
const PAD_BOTTOM = 16
/** §4.3.1a: below this many recorded implied quarters the paired form is a lie. */
const MIN_PAIRED = 3
/** The store keeps 8 quarters (implied_store.get_implied_history limit=8). */
const TARGET_QUARTERS = 8

// NOTE (fixed vs. task brief draft): `Number(null)` coerces to `0`, so a bare
// `Number.isFinite(Number(v))` check turns a missing value into a phantom
// zero — the exact "hard lesson" this kit's tests guard against (it broke
// pairs[4].realizedPct, which must stay null for the unreported current
// quarter, and cascaded into pairGeometry drawing a zero-height realized bar
// instead of omitting it). The `v == null` short-circuit below matches the
// same `num()` idiom already established in ../charts/ReactionBars.jsx.
const num = (v) => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const dayKey = (d) => {
  const s = typeof d === 'string' ? d.trim() : ''
  return s ? s.slice(0, 10) : null
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

// The provider's own fiscal identity (Finnhub quarter/year — present on both
// /stock/earnings and /calendar/earnings, verified live to agree for the same
// event) as a Map key. null when either side is missing so a row with no
// fiscal key never accidentally collides with another (e.g. two rows both
// missing the field would otherwise both key as "null:null").
const fiscalKey = (fy, fq) => (fy != null && fq != null ? `${fy}:${fq}` : null)

/**
 * Pairs earnings-history rows (realized) with implied snapshots (expectation),
 * oldest-first.
 *
 * PAIRING KEY (P2 T8b): the provider's fiscal identity (`fiscal_year` +
 * `fiscal_quarter`) when BOTH sides carry it — a history row's `report_date`
 * is usually unknown for an already-reported quarter (see
 * earningsHistoryModel.js DECISION 3), so date equality alone can never match
 * real accrued history. `report_date` string equality is kept as the
 * FALLBACK so a snapshot recorded before this task (no fiscal key yet) still
 * pairs, and so the CURRENT quarter — whose `report_date` IS the real
 * announcement date — keeps working exactly as before.
 *
 * Both payloads arrive exactly as their endpoints return them:
 *   quarters       — GET /api/research/earnings-history/{sym}, oldest-first
 *   impliedHistory — GET /api/research/expected-move/{sym} .history, newest-first
 *   live           — the same payload's .live (fills the CURRENT quarter, whose
 *                    snapshot is not in the store until tonight's capture)
 * There is no adapter between P2 and this function, by design.
 */
export function pairQuarters(quarters, impliedHistory, live) {
  const byDate = new Map()
  const byFiscal = new Map()
  for (const row of impliedHistory || []) {
    const pct = num(row?.pct)
    const k = dayKey(row?.report_date)
    // First write wins: the store's own first-write-wins rule already makes the
    // earliest snapshot the honest pre-report one.
    if (k && !byDate.has(k)) byDate.set(k, pct)
    // MINOR (P2 T8b review r1) — this does NOT inherit byDate's "earliest is
    // honest" reasoning. `report_date` is the store's PRIMARY KEY, so byDate's
    // per-date first-write-wins IS the store's own invariant. A fiscal key has
    // no such guarantee: a rescheduled print is captured TWICE under two
    // DIFFERENT report_dates but the SAME fiscal_year/fiscal_quarter, and
    // `impliedHistory` arrives report_date DESC (newest first) — so "first
    // occurrence wins" here resolves to the NEWER report_date, i.e. the LATEST
    // capture for that fiscal identity, not necessarily the temporally-first
    // one. Verified: report_date DESC array [(newer, pct=9.9), (older,
    // pct=5.5)] resolves byFiscal to 9.9. Treated as correct on purpose — the
    // most recent known snapshot for a quarter beats a stale one from before
    // the reschedule — but it is a deliberate resolution rule, not an
    // accidental inheritance of byDate's semantics.
    const fk = fiscalKey(num(row?.fiscal_year), num(row?.fiscal_quarter))
    if (fk && !byFiscal.has(fk)) byFiscal.set(fk, pct)
  }

  return (quarters || []).map((q, i) => {
    const k = dayKey(q?.report_date)
    const qfk = fiscalKey(num(q?.fiscal_year), num(q?.fiscal_quarter))
    const isCurrent = q?.reported === false
    let impliedPct = null
    if (qfk && byFiscal.has(qfk)) {
      impliedPct = byFiscal.get(qfk)
    } else if (k && byDate.has(k)) {
      impliedPct = byDate.get(k)
    }
    if (impliedPct == null && isCurrent) impliedPct = num(live?.pct)
    return {
      key: q?.quarter ?? String(i),
      quarter: q?.quarter ?? '',
      report_date: k,
      isCurrent,
      impliedPct,
      realizedPct: num(q?.reaction_pct),
    }
  })
}

/**
 * The §4.3.1a cold-start state — DESIGNED, not degraded-by-accident.
 *
 * The nightly store starts empty, so early on there is nothing to pair. Rather
 * than draw two bars where one is guesswork, the widget shows realized bars +
 * the current implied and says exactly how much history exists.
 */
export function coldStartState(
  pairs, historySince,
  { minPaired = MIN_PAIRED, total = TARGET_QUARTERS, recorded = null } = {},
) {
  // RULED (P2): `n` in "n/8 recorded" counts STORED history snapshots only —
  // never tonight's live implied. `pairs` cannot answer that, because
  // pairQuarters fills the current quarter's impliedPct from `live`. When the
  // caller knows the stored count it passes it; the internal count stays as
  // the fallback for callers that have only pairs.
  // `Number.isFinite(recorded)` is deliberate on the RAW value: Number(null)
  // is 0, so `Number.isFinite(Number(recorded))` would silently accept null
  // as a stored count of zero.
  const counted = Number.isFinite(recorded)
    ? recorded
    : (pairs || []).filter((p) => p.impliedPct != null).length
  const cold = counted < minPaired
  const since = typeof historySince === 'string' && historySince.length >= 7 ? historySince.slice(0, 7) : null
  // `coverageText` is computed UNCONDITIONALLY (unlike `caption`, which stays
  // null when warm — existing contract, left alone). I2: `counted` here
  // counts every quarter with an impliedPct, INCLUDING the live current
  // quarter (unless the caller passed a stored `recorded` count), so `cold`
  // can be false (warm) while `impliedVerdict` still returns null (it
  // requires fully-paired PAST quarters only, a stricter count). The
  // component needs this text even in that warm-but-chipless gap — see the
  // `chip`/`coverageCaption` wiring below.
  const coverageText = `Implied tracking since ${since ?? '—'} · ${counted}/${total} recorded`
  return {
    cold,
    recorded: counted,
    total,
    since,
    caption: cold ? coverageText : null,
    coverageText,
  }
}

/**
 * "Is the options market overpaying for this print?" — the nameable
 * differentiator (§13.2). Returns null below MIN_PAIRED fully-paired PAST
 * quarters: a two-quarter sample is not an opinion.
 *
 * Copy follows §4.3.1a exactly and never contains the word "verdict" (§12).
 */
export function impliedVerdict(pairs, live) {
  const both = (pairs || []).filter((p) => !p.isCurrent && p.impliedPct != null && p.realizedPct != null)
  if (both.length < MIN_PAIRED) return null

  const avgImplied = mean(both.map((p) => Math.abs(p.impliedPct)))
  const avgRealized = mean(both.map((p) => Math.abs(p.realizedPct)))
  // An implied move is a magnitude, never signed, but the source payload is
  // just a number — Math.abs() BEFORE both the ± display and the rich/cheap
  // comparison so a stray negative `live.pct` can't flip the verdict or print
  // "priced ±-6.2%".
  const livePctRaw = num(live?.pct)
  const livePct = livePctRaw == null ? null : Math.abs(livePctRaw)
  // Judge tonight's price when we have it; fall back to the historical average.
  const reference = livePct ?? avgImplied
  const rich = avgRealized < reference

  const horizon = live?.horizon || (live?.expiry ? `through ${live.expiry}` : null)
  const priced = livePct == null ? '' : `priced ±${livePct.toFixed(1)}%${horizon ? ` ${horizon}` : ''}, `
  return {
    rich,
    tone: 'gold',
    glyph: rich ? '▲' : '▼',
    avgImplied,
    avgRealized,
    label: `PREMIUM ${rich ? 'RICH' : 'CHEAP'} — ${priced}typically moves ±${avgRealized.toFixed(1)}%`,
  }
}

/**
 * Bar rectangles in VIEWBOX units. Pure and DOM-free.
 *
 * NORMATIVE (§3.3): the SOLID realized bar is SIGNED — a down-close descends
 * below the baseline. The HOLLOW implied bar has no sign of its own, so it is
 * drawn on the SAME side as its realized outcome; that is what makes "hollow
 * taller than solid" read as "the market overpaid". When the outcome is not
 * known yet (the current quarter) the hollow bar points up and its label
 * carries ±. Do not "fix" this into an unsigned pair.
 */
export function pairGeometry(pairs, { width = VIEWBOX.width, height = VIEWBOX.height } = {}) {
  const list = pairs || []
  const mags = []
  for (const p of list) {
    if (p.impliedPct != null) mags.push(Math.abs(p.impliedPct))
    if (p.realizedPct != null) mags.push(Math.abs(p.realizedPct))
  }
  const peak = Math.max(0, ...mags)
  const scaleMax = (peak > 0 ? peak : 1) * 1.15

  const plotH = height - PAD_TOP - PAD_BOTTOM
  const halfH = plotH / 2
  const baselineY = PAD_TOP + halfH
  const n = Math.max(list.length, 1)
  const slot = width / n
  // The cap used to be 9 units, which was the RIGHT number when the viewBox was
  // always 320 wide (slot 35.6 -> 0.28*slot = 9.96, so the cap bound). Now that
  // the box tracks the real container the slot roughly doubles on desktop, and a
  // 9px bar in a 67px slot reads as a stick, not a column. 18 keeps the pair
  // occupying the same FRACTION of its slot at the width this actually renders
  // at; below ~320px the 0.28 term still binds first, so narrow layouts are
  // byte-identical to before.
  const barW = Math.min(18, slot * 0.28)
  const half = barW / 2 + 1

  const cols = list.map((p, i) => {
    const cx = slot * (i + 0.5)
    const dir = p.realizedPct != null ? (p.realizedPct >= 0 ? 1 : -1) : 1
    const bar = (v, offset) => {
      if (v == null) return null
      const h = Math.min(halfH, (Math.abs(v) / scaleMax) * halfH)
      return { x: cx + offset - barW / 2, w: barW, h, y: dir > 0 ? baselineY - h : baselineY }
    }
    return {
      key: p.key,
      label: p.quarter,
      isCurrent: !!p.isCurrent,
      dir,
      cx,
      implied: bar(p.impliedPct, -half),
      realized: bar(p.realizedPct, half),
    }
  })

  return { cols, baselineY, scaleMax, width, height, labelY: height - 4 }
}

/**
 * THE Setup hero (spec §4.3.1a): what the options market charged for each past
 * print versus what the stock actually did.
 *
 * GRAMMAR (§3.3): hollow = expectation, solid = realized, signed = direction.
 * GOLD BUDGET (§3.1): the RICH/CHEAP chip is the ONE gold element on this
 * canvas. The current quarter is marked with a brighter stroke and a NOW tick —
 * deliberately not gold. (The gold dashed bracket lives on ReactionBars, in the
 * Earnings History canvas.)
 */
export default function ImpliedVsRealized({
  quarters,
  impliedHistory,
  live,
  historySince,
  label = 'Implied vs realized move',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
  recordedCount = null,
}) {
  // Both hooks run ABOVE the EmptyState early-return — an early return that
  // skips a hook is the classic hook-order crash, and this component has one.
  const [wrapRef, vbWidth] = useMeasuredWidth(VIEWBOX.width)

  const paired = pairQuarters(quarters, impliedHistory, live)
  const cold = coldStartState(paired, historySince, { recorded: recordedCount })

  const plotted = cold.cold
    // Cold start: a sparse hollow bar invites a false read, so only the current
    // quarter's implied survives. The caption states the real coverage.
    ? paired.map((p) => (p.isCurrent ? p : { ...p, impliedPct: null }))
    : paired

  const hasAnything = plotted.some((p) => p.impliedPct != null || p.realizedPct != null)
  if (!hasAnything) {
    return (
      <EmptyState
        icon="chart"
        title="No expected-move history yet"
        hint="Implied moves are captured the night before each report; realized moves need one reported quarter."
        className={className}
      />
    )
  }

  const geo = pairGeometry(plotted, { width: vbWidth, height: VIEWBOX.height })
  const chip = cold.cold ? null : impliedVerdict(paired, live)
  // I2: coldStartState's `cold` flag counts the LIVE current quarter as
  // "recorded", so it can read warm (cold.cold === false, cold.caption ===
  // null) while impliedVerdict still refuses to speak (it needs 3 fully-paired
  // PAST quarters, a stricter bar). Rendering neither a chip nor a caption in
  // that gap left the hero silently empty. Whenever there is no chip — cold OR
  // not — the coverage disclosure renders instead, so the widget never shows
  // nothing.
  const coverageCaption = chip ? null : cold.coverageText
  const built = ariaLabel || (chip
    ? `Implied versus realized move by quarter. ${chip.label}.`
    : `Realized move by quarter. ${coverageCaption ?? ''}`.trim())

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <svg
        ref={wrapRef}
        className={styles.svg}
        viewBox={`0 0 ${vbWidth} ${VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ height }}
        role="img"
        aria-label={built}
        data-testid="rk-ivr"
      >
        <line className={styles.baseline} x1="0" y1={geo.baselineY} x2={geo.width} y2={geo.baselineY} />

        {geo.cols.map((c) => (
          <g key={c.key}>
            {c.implied && (
              <rect
                className={c.isCurrent ? styles.impliedNow : styles.implied}
                data-testid="rk-ivr-implied"
                x={c.implied.x} y={c.implied.y} width={c.implied.w} height={c.implied.h} rx="1"
              />
            )}
            {c.realized && (
              <rect
                className={c.dir > 0 ? styles.realizedUp : styles.realizedDown}
                data-testid="rk-ivr-realized"
                x={c.realized.x} y={c.realized.y} width={c.realized.w} height={c.realized.h} rx="1"
              />
            )}
            {c.isCurrent && (
              <text
                className={styles.now}
                data-testid="rk-ivr-now"
                x={c.cx} y={PAD_TOP - 3}
                textAnchor="middle"
              >
                NOW
              </text>
            )}
            <text className={styles.qlabel} x={c.cx} y={geo.labelY} textAnchor="middle">
              {c.isCurrent ? `±${c.label}` : c.label}
            </text>
          </g>
        ))}
      </svg>

      {chip && (
        <VerdictChip label={chip.label} tone={chip.tone} glyph={chip.glyph} size="sm" info={info} />
      )}
      {coverageCaption && (
        <div className={`${styles.cold} t-num`} data-testid="rk-ivr-cold">
          {coverageCaption}
        </div>
      )}
    </div>
  )
}
