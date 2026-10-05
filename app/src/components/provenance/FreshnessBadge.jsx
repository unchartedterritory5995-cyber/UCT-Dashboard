// app/src/components/provenance/FreshnessBadge.jsx
//
// S8 Step 1 (PRD-S8 §4.3, §7.2/§9; SPEC-S8 §4.3, §19 Step 1). Renders the
// `LIVE / delayed N min / as-of HH:MM ET / stale` vocabulary off D1's
// FreshnessClass, via `freshnessContract.js`'s exhaustive mapping.
//
// ⛔ SOURCE STALENESS vs SESSION STALENESS ARE NEVER THE SAME RENDER. D1's
// `freshnessClass="stale"` (the vendor's own data looks abandoned) and this
// component's own `sessionStale` prop (the rendered view is outdated for the
// current session, PRD-S8 §9.6) are independent, orthogonal facts — a value
// can be either, both, or neither. See `freshnessContract.js`'s header for
// why this distinction exists and the naming it enforces.
//
// ⚠️ `sessionStale` is CALLER-SUPPLIED ONLY — this component still computes
// NOTHING from elapsed time itself, by design (it renders; it does not
// decide). The real "has this value gone stale for THIS session"
// computation now exists (S11 shipped 2026-09-03 — SPEC-S8 §19 Step 3) in
// `components/provenance/sessionStale.js::computeSessionStale`, which reads
// S11's real session/holiday model (`lib/marketClock/marketClock.js`); see
// `ProvenanceDemo.jsx` for the live wiring. `sessionState`
// (sessionModel()'s own `{label, tone}` output) stays session CONTEXT only
// (open/pre-market/after-hours/closed) and is never used here to derive
// `sessionStale` — the two props remain independent inputs a caller passes.
//
// ⚠️ Entitlement/licensing state (D1's `entitlement_denied`) is a SEPARATE,
// orthogonal dimension from freshness — per the owner's explicit ruling this
// pass, it is never folded into this component's freshness rendering. A
// future entitlement/availability indicator is a distinct primitive's job.

import { useEffect, useState } from 'react'
import UIcon from '../ui/UIcon'
import { mapD1Freshness } from './freshnessContract'
// ⛔ ALIASED ON PURPOSE: this component's own `freshnessClass` PROP (D1's tier) would shadow the
// authority's `freshnessClass()` inside the render, and the call would hit `null`.
import { freshnessClass as dataClassOf } from './freshnessAge'
import { formatFreshnessAsOf } from '../../lib/presentation/presentationPrimitives'
import styles from './FreshnessBadge.module.css'

const _ICON_BY_TIER = {
  real_time: 'clock',
  delayed_15: 'clock',
  end_of_day: 'clock',
  historical: 'clock',
  stale: 'warning',
  unknown: 'info',
}

// ⚰️ `formatAsOf` LIVED HERE, AND THE "tier !== 'real_time'" TEST LIVED IN
// `Tier` BELOW. Both are now S10's `formatFreshnessAsOf`, which is the same two
// rules in one place:
//
//     function formatAsOf(asOf) {
//       if (!asOf) return null
//       const d = new Date(asOf)
//       if (Number.isNaN(d.getTime())) return null
//       return d.toLocaleTimeString('en-US', {
//         timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
//       })
//     }
//
// ⭐ It was byte-identical to `presentationFormat.js::formatEtTime` except for
// one field — `second: '2-digit'` — so this component and `<Provenance>`, two
// files apart in one directory, rendered the same instant two different ways.
// That is the whole S10 case, at the smallest scale it can occur.
//
// ⛔ The suppression rule moved WITH the formatter on purpose. "A real-time
// value gets no as-of clause" is a presentation fact, not a freshness fact:
// leaving the `!== 'real_time'` test here and moving only the formatting would
// have split one decision across two systems.

/** TERM-059 — the AGE CLAUSE, for a value the CALLER has already judged must
 *  show its age (`freshnessAge.js::mustShowAge`). This component still decides
 *  nothing: the caller mounts it with `age` only when the authority said so,
 *  exactly as `sessionStale` arrives already computed.
 *
 *  `age = { cadence, asOfDate }` — `cadence` is the series' own publication
 *  rhythm in words ("weekly"), `asOfDate` the value's own calendar as-of
 *  (`YYYY-MM-DD`) or `null` when the value is undated.
 *
 *  ⛔ THE DATE IS RENDERED AS GIVEN, NEVER PARSED. A calendar date has no time
 *  and no zone; `new Date('2026-06-17')` is UTC midnight, the PREVIOUS evening in
 *  New York, and feeding it to the time-of-day as-of clause above would print
 *  "as of 8:00 PM ET" for a survey that was never timed at all.
 *
 *  ⛔ AN UNDATED VALUE SAYS "undated", never nothing: an unknown age is not a
 *  fresh one (`freshnessAge.js`, reason `no_timestamp`). */
function AgeClause({ cadence = null, asOfDate = null }) {
  const when = asOfDate ? `as of ${asOfDate}` : 'undated'
  return (
    <span className={styles.age} data-testid="freshness-age">
      <UIcon name="clock" size={12} />
      <span>{cadence ? `${cadence} · ${when}` : when}</span>
    </span>
  )
}

/** One badge for one freshness-shaped value or one `fields[]` row (PRD-S8
 *  §9.5 composite support — "delayed price, live volume" on one row). */
function Tier({ freshnessClass, asOf, label: labelOverride, testIdSuffix = '' }) {
  const presentation = mapD1Freshness(freshnessClass)
  const asOfText = formatFreshnessAsOf({ tier: presentation.tier, asOf })
  const label = labelOverride || presentation.label || 'UNKNOWN'
  return (
    <span
      className={`${styles.tier} ${styles[`tier_${presentation.tier}`] || ''}`}
      data-testid={`freshness-tier${testIdSuffix}`}
      data-freshness-tier={presentation.tier}
      data-source-stale={presentation.isSourceStale ? 'true' : 'false'}
    >
      <UIcon name={_ICON_BY_TIER[presentation.tier] || 'clock'} size={12} />
      <span className={styles.tierLabel}>{label}</span>
      {/* ⛔ `asOfText` now ARRIVES as the whole clause — "as of 9:32 AM ET" —
          because the words and the zone label are part of the presentation
          decision, not decoration around it. The rendered HTML is unchanged:
          JSX serialises `as of {x} ET` and `{x}` to the same text content when
          `x` carries the same characters, which is what the byte-identity
          render test asserts rather than assumes. */}
      {asOfText && <span className={styles.tierAsOf}>{asOfText}</span>}
      {presentation.isSourceStale && (
        // ⛔ NEVER THE BARE WORD "stale" ALONE — always qualified, so a reader
        // (and a test) can never mistake this for §9.6's session concept.
        <span className={styles.sourceStaleNote} data-testid={`source-stale-note${testIdSuffix}`}>
          source data is stale
        </span>
      )}
    </span>
  )
}

export default function FreshnessBadge({
  freshnessClass = null,
  asOf = null,
  sessionState = null,
  sessionStale = false,
  fields = null,
  disclosureRequired = null,
  disclosureText = null,
  age = null,
}) {
  const [, setTick] = useState(0)
  // An age clause is a calendar date, fixed for the life of the render, so a
  // badge carrying one has nothing to re-render every second. That matters at
  // the first consumer: one NAAIM badge per Monitor row would otherwise be one
  // interval per row.
  const ticks = age == null
  // `ChartMarketClock.jsx`'s existing ticking idiom, reused verbatim
  // (SPEC-S8 §9) rather than a second pattern — this badge's "as of HH:MM"
  // text is a formatted-once string per render, so the tick only needs to
  // trigger a re-render; it holds no clock state of its own.
  useEffect(() => {
    if (!ticks) return undefined
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [ticks])

  const primary = mapD1Freshness(freshnessClass)
  const requiresDisclosure = disclosureRequired ?? primary.disclosureRequired
  const hasFields = Array.isArray(fields) && fields.length > 0
  // ⭐ An age clause STANDS IN for the tier when there is no D1 class to state:
  // printing UNKNOWN beside an as-of the caller KNOWS would contradict itself.
  // With a class (or composite fields) present, both render.
  const ageOnly = age != null && freshnessClass == null && !hasFields

  return (
    <span className={styles.wrap} data-testid="freshness-badge">
      {ageOnly ? null : hasFields ? (
        // Composite row (PRD-S8 §9.5): one Tier per field, each independently
        // labeled — never collapsed to a single freshness for the whole row.
        fields.map((f, i) => (
          <Tier
            key={f.label ?? i}
            freshnessClass={f.freshnessClass}
            asOf={f.asOf}
            label={f.label ? `${f.label}: ${mapD1Freshness(f.freshnessClass).label}` : undefined}
            testIdSuffix={`-${i}`}
          />
        ))
      ) : (
        <Tier freshnessClass={freshnessClass} asOf={asOf} />
      )}

      {/* TERM-006: a caller that names its data class gets the class's own cadence words from
          the age authority (`freshnessAge.js` FRESHNESS_CLASSES) — never a second spelling. */}
      {age != null && (
        <AgeClause
          cadence={age.dataClass != null ? dataClassOf(age.dataClass).cadence : age.cadence}
          asOfDate={age.asOfDate}
        />
      )}

      {sessionState?.label && (
        <span
          className={`${styles.session} ${styles[`session_${sessionState.tone}`] || ''}`}
          data-testid="freshness-session-context"
        >
          {sessionState.label}
        </span>
      )}

      {sessionStale && (
        // ⛔ A SEPARATE data-testid from source-stale-note above, on purpose —
        // this is the test surface `test_freshness_badge_source_vs_session_
        // stale_are_distinct` in FreshnessBadge.test.jsx pins directly.
        <span className={styles.sessionStaleNote} data-testid="session-stale-note">
          <UIcon name="clock" size={12} />
          view needs refresh
        </span>
      )}

      {requiresDisclosure && (
        // PRD-S8 §9.4/§10.3: the UTP/CTA delayed-data disclosure obligation.
        // Plumbed from day one (this is a compliance requirement, not a
        // design nicety) even though no real delayed-price surface is wired
        // to this component yet — Step 2+ work.
        <span className={styles.disclosure} role="note" data-testid="freshness-disclosure">
          {disclosureText || 'Data Delayed 15 Minutes'}
        </span>
      )}
    </span>
  )
}
