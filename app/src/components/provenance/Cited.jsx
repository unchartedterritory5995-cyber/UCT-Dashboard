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
import { formatDateTimeEt } from '../../lib/presentation/presentationPrimitives'
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
// IT IS NOW FIXED, on its own line (owner, 2026-09-12).
//
// This rendered in the VIEWER's timezone while its two neighbours in this same
// directory — `<Provenance>`'s "Observed:" line and `<FreshnessBadge>`'s "as of"
// clause — pinned ET, and NEITHER carried a zone label, which is the half that
// made it invisible. One instant, one S8 surface, read four different ways
// depending on where the member sat:
//
//     viewer zone        BEFORE                      AFTER
//     America/New_York   "9/11/2025, 9:32:15 AM"     "9/11/2025, 9:32:15 AM ET"
//     America/Chicago    "9/11/2025, 8:32:15 AM"     "9/11/2025, 9:32:15 AM ET"
//     Europe/London      "9/11/2025, 2:32:15 PM"     "9/11/2025, 9:32:15 AM ET"
//     Asia/Tokyo         "9/11/2025, 10:32:15 PM"    "9/11/2025, 9:32:15 AM ET"
//
// ⭐ A LONDON READER WAS SHOWN A BAR VALIDATED AT "2:32 PM" AND NOTHING SAID
// WHICH AFTERNOON THAT WAS. A provenance surface whose whole job is to say when
// a value was true cannot leave the reader to guess the zone.
//
// ⛔ MEMBER-VISIBLE, DELIBERATELY. S10's first build could not make this change
// — its approval required byte-identical rendering — which is exactly why this
// one is a separate line: it is allowed to move a string, and it does.
//
// ⛔ THE LABEL IS THE OTHER HALF. Pinning the zone silently would swap one
// unlabelled timestamp for another, and a London reader would see a number three
// hours earlier than yesterday's with nothing to explain it.

// ── The transcript-span row (TERM-044 / FB-A6-02) ────────────────────────────
//
//   <Cited row={ {transcript: {segment, start, end, speaker, text}} }
//          onOpenSource={(transcript) => ...} />
//
// A THIRD row shape, additive like the other two. `text` is the transcript's
// own characters at [start, end) of turn `segment` — the server located it and
// verified it before it was stored, so the panel shows the passage itself, not
// a description of one. `onOpenSource` is optional: a surface that can scroll
// the full transcript to that turn passes it; one that cannot simply shows the
// passage.
//
// Rendered as a block that flows with its sentence (the toggle sits at the end
// of the line, the passage opens beneath it) rather than the floating panel
// the bar row uses: a passage is a paragraph, and a popover that paragraph
// wide clips inside a scrolling modal on a phone.
function TranscriptCited({ children, transcript, onOpenSource }) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const who = transcript.speaker || 'Unattributed speaker'
  return (
    <span className={styles.wrapPassage} data-testid="cited-present">
      {children}
      <button
        type="button"
        className={`${styles.toggle} ${styles.togglePassage}`}
        data-testid="cited-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Show the transcript passage this point comes from"
        title="Show the transcript passage this point comes from"
        onClick={() => setOpen((o) => !o)}
      >
        <UIcon name="info" size={12} />
      </button>
      {open && (
        <span id={panelId} className={styles.panelPassage} role="note" data-testid="cited-panel">
          <span className={styles.passageHead}>From the call transcript · {who}</span>
          <q className={styles.passage} data-testid="cited-passage">{transcript.text}</q>
          {onOpenSource && (
            <button
              type="button"
              className={styles.openSource}
              data-testid="cited-open-source"
              onClick={() => onOpenSource(transcript)}
            >
              Show in full transcript
            </button>
          )}
        </span>
      )}
    </span>
  )
}

export default function Cited({ children, row = null, onOpenSource = null }) {
  const panelId = useId()
  const [open, setOpen] = useState(false)

  if (row && row.transcript && typeof row.transcript === 'object') {
    return (
      <TranscriptCited transcript={row.transcript} onOpenSource={onOpenSource}>
        {children}
      </TranscriptCited>
    )
  }

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
      row.validated_at && `Validated: ${formatDateTimeEt(row.validated_at)}`,
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
