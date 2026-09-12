// app/src/components/provenance/Cited.jsx
//
// S8 continuation (owner authorization, 2026-09-02) — classified A-READY-NOW,
// not D2-blocked. SPEC-S8 §4.5 is explicit that a NARROW interim form is
// "buildable now against bar_provenance.py's actual return shape... a real,
// shippable, non-degraded state for bars specifically, not a placeholder,"
// distinct from the full D2-gated recursive click-through-to-inputs form
// (SPEC-S8 §19 Step 4, genuinely blocked — D2/the Canonical Data Model does
// not exist).
//
// Props (SPEC-S8 §4.5, prop-shape superset so the D2 form is additive later,
// never a breaking change):
//   <Cited row={ {ticker, tf, bar_time, source, validated_at, verified_at}
//               | {uctUri: string} } />
//
// The bar-shaped row (today's only real data source) renders source/as-of/
// verified-status one level deep — no recursive inputs graph, because
// bar_provenance.py records none. A `uctUri`-shaped row is accepted for
// forward-compatibility but its full recursive rendering is NOT built here
// (D2-gated) — it renders the same one-level summary a bar row would, never
// a fabricated deeper graph.

import { useId, useState } from 'react'
import UIcon from '../ui/UIcon'
import { formatDateTimeViewerLocal } from '../../lib/presentation/presentationPrimitives'
import styles from './Cited.module.css'

// ⚰️ `epochToLocal` LIVED HERE. It is now S10's
// `formatDateTimeViewerLocal`, moved byte for byte:
//
//     function epochToLocal(epochSeconds) {
//       if (!Number.isFinite(epochSeconds)) return null
//       return new Date(epochSeconds * 1000).toLocaleString('en-US')
//     }
//
// ⚠️⚠️ AND MOVING IT MADE A REAL DEFECT VISIBLE THAT HAD NO NAME BEFORE.
// This renders in the VIEWER's timezone. Its two neighbours in this same
// directory — `<Provenance>`'s "Observed:" line and `<FreshnessBadge>`'s "as
// of" clause — pin ET. So on one S8 surface a member outside ET reads two
// timestamps in two different zones, and NEITHER carries a zone label.
//
// ⛔ IT IS NOT FIXED HERE, DELIBERATELY. S10's approved scope is "no
// member-visible layout change; snapshot tests prove S8 renders byte-identical
// before and after adoption" — and changing this zone moves a rendered string
// for every member outside ET, which is exactly what that condition forbids.
// Recorded in `presentationPrimitives.js`'s own header, railed by
// `presentationPrimitives.test.js`, and it needs its own approval line.

export default function Cited({ children, row = null }) {
  const panelId = useId()
  const [open, setOpen] = useState(false)

  if (!row) {
    // Same honest-degraded principle as <Provenance>'s own §9.8 state:
    // never a fabricated citation for a value with no addressed row.
    return (
      <span className={styles.wrap} data-testid="cited-unavailable">
        {children}
        <span className={styles.unavailableNote} role="note" data-testid="cited-unavailable-note">
          citation unavailable
        </span>
      </span>
    )
  }

  const isBarRow = 'ticker' in row
  const detailParts = isBarRow
    ? [
      `${row.ticker} · ${row.tf}`,
      `Source: ${row.source}`,
      row.validated_at && `Validated: ${formatDateTimeViewerLocal(row.validated_at)}`,
      row.verified_at ? 'Reconciliation: verified' : 'Reconciliation: not yet verified',
    ].filter(Boolean)
    : [row.uctUri && `Address: ${row.uctUri}`].filter(Boolean)

  return (
    <span className={styles.wrap} data-testid="cited-present">
      {children}
      <button
        type="button"
        className={styles.toggle}
        data-testid="cited-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Show citation detail"
        onClick={() => setOpen((o) => !o)}
      >
        <UIcon name="info" size={11} />
      </button>
      {open && (
        <span id={panelId} className={styles.panel} role="note" data-testid="cited-panel">
          {detailParts.map((p) => <span key={p} className={styles.panelRow}>{p}</span>)}
          {isBarRow && !row.verified_at && (
            <span className={styles.panelUnverified} data-testid="cited-unverified-note">
              Not independently reconciled yet — a real, honest state, not an error.
            </span>
          )}
        </span>
      )}
    </span>
  )
}
