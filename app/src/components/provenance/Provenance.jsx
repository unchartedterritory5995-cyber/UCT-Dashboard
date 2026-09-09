// app/src/components/provenance/Provenance.jsx
//
// S8 Step 1 (PRD-S8 §4.2, §9.8) built the DEGRADED state. S8 Step 2 (owner
// authorization, 2026-09-02) extends it with the rest of §9.3/§9.7/§16's
// honest-state contract this component owns:
//   - `loading` (§9.7) — a distinct affordance while fields are in flight,
//     never a value with no freshness indicator and never a stale-looking
//     blank that could be mistaken for §9.3's "empty."
//   - `availability` (§9.3/§16, via `availabilityContract.js`) — the
//     orthogonal not-found / entitlement-denied / provider-error axis. NEVER
//     folded into `freshness` — see that module's header for why.
//   - A real, accessible, keyboard-operable detail disclosure for the
//     present-provenance case, replacing Step 1's native-tooltip stand-in.
//     Still deliberately minimal formatting (`presentationFormat.js`, NOT
//     S10 — see that file's header) since S10 does not exist yet.

import { useId, useState } from 'react'
import UIcon from '../ui/UIcon'
import { AVAILABLE, AVAILABILITY_LABEL } from './availabilityContract'
import { formatEtTime } from './presentationFormat'
import styles from './Provenance.module.css'

export default function Provenance({
  value,
  provenance = null,
  calcVersion = null,
  density = 'ondemand',
  citedRow = null,
  loading = false,
  availability = AVAILABLE,
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)

  // §9.7 — a fetch in flight. Checked FIRST: a loading value has no honest
  // opinion yet about degraded/available/anything else.
  if (loading) {
    return (
      <span className={styles.wrap} data-density={density} data-testid="provenance-loading">
        <UIcon name="clock" size={12} className={styles.loadingIcon} />
        <span className={styles.loadingLabel} role="status" aria-live="polite">loading…</span>
      </span>
    )
  }

  // §9.3/§16 — the orthogonal availability axis. Checked before the plain
  // provenance-present/degraded split: a not-found/entitlement-denied/
  // provider-error value has nothing to wrap in the first place.
  if (availability !== AVAILABLE) {
    const label = AVAILABILITY_LABEL[availability] || AVAILABILITY_LABEL.unknown
    return (
      <span
        className={styles.wrap}
        data-density={density}
        data-testid="provenance-unavailable"
        data-availability={availability}
      >
        <UIcon name="warning" size={12} />
        <span className={styles.unavailable} role="note" data-testid="availability-note">{label}</span>
      </span>
    )
  }

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

  // Present-provenance case: value + an accessible, keyboard-operable
  // detail disclosure (a real <button>, so Enter/Space/click/tab all work
  // without any hand-rolled key handling) — still minimal formatting per
  // this file's header note.
  const asOfText = formatEtTime(provenance.timestamp)
  const detailParts = [
    provenance.sourceActivity && `Source: ${provenance.sourceActivity}`,
    asOfText && `Observed: ${asOfText} ET`,
    calcVersion && `Calc: ${calcVersion}`,
    provenance.tieBreak && `Tie-break: ${provenance.tieBreak}`,
  ].filter(Boolean)

  return (
    <span
      className={styles.wrap}
      data-density={density}
      data-testid="provenance-present"
      data-cited-row={citedRow || undefined}
    >
      <span className={styles.value}>{value}</span>
      {detailParts.length > 0 && (
        <>
          <button
            type="button"
            className={styles.detailToggle}
            data-testid="provenance-detail-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label="Show source and as-of detail"
            onClick={() => setOpen((o) => !o)}
          >
            <UIcon name="info" size={11} />
          </button>
          {open && (
            <span id={panelId} className={styles.detailPanel} role="note" data-testid="provenance-detail-panel">
              {detailParts.map((p) => <span key={p} className={styles.detailRow}>{p}</span>)}
            </span>
          )}
        </>
      )}
    </span>
  )
}
