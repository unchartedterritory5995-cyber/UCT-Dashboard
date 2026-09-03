// app/src/components/provenance/Provenance.jsx
//
// S8 Step 1 (PRD-S8 §4.2, §9.8; SPEC-S8 §4.2, §19 Step 1). This pass builds
// exactly the piece §19 Step 1 names as buildable now: the DEGRADED state —
// "provenance unavailable", rendered honestly when no provenance record
// exists for a value yet (e.g. pre-D2-registration, or any capability D1
// hasn't attached one to). It needs zero provenance records to render
// correctly, since that is a valid state by design (PRD-S8 §9.8).
//
// ⚠️ NOT BUILT YET, deliberately: the full hover/click source/as-of/calc-
// version popover. SPEC-S8 §4.2 defers the actual number/percent/date
// formatting inside that popover to S10's shared formatter (§19 Step 2) —
// "S8 must not become fmt* implementation #119." Building a rich popover now
// would either invent a fourth formatter or hard-code presentation this pass
// has no product mandate to finalize. `value` therefore renders plainly in
// the present-provenance case; a minimal, testable "provenance present"
// affordance marks the distinction from the degraded case without a popover.

import styles from './Provenance.module.css'

export default function Provenance({
  value,
  provenance = null,
  calcVersion = null,
  density = 'ondemand',
  citedRow = null,
}) {
  if (!provenance) {
    // PRD-S8 §9.8's own state: S8's OWN inputs degraded, not the value's.
    // Never fabricated as a receipt, never silently rendered bare.
    return (
      <span className={styles.wrap} data-density={density} data-testid="provenance-degraded">
        <span className={styles.value}>{value}</span>
        <span
          className={styles.unavailable}
          role="note"
          data-testid="provenance-unavailable-note"
          title="Provenance unavailable"
        >
          provenance unavailable
        </span>
      </span>
    )
  }

  // Present-provenance case, minimal per this file's header note above.
  const title = [
    provenance.sourceActivity,
    provenance.timestamp ? new Date(provenance.timestamp).toLocaleString('en-US') : null,
    calcVersion ? `calc ${calcVersion}` : null,
  ].filter(Boolean).join(' · ') || undefined

  return (
    <span
      className={styles.wrap}
      data-density={density}
      data-testid="provenance-present"
      data-cited-row={citedRow || undefined}
      title={title}
    >
      <span className={styles.value}>{value}</span>
    </span>
  )
}
