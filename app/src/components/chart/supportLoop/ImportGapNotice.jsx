// app/src/components/chart/supportLoop/ImportGapNotice.jsx
//
// ─── A1 — THE HONEST NOTICE AT IMPORT, AND THE DOOR TO A3 ───────────────────
//
// Spec: `docs/pine/support-loop/PHASE-A.md`.
//
// ⭐ ONE COMPONENT, THREE JOBS, ALL FROM ONE ANSWER (`importGaps(report)`):
//   1. the note — shown EXACTLY when a gap exists, naming the unsupported
//      TradingView built-ins in plain words (and only names from the closed list);
//   2. the gap log (A2) — fired once per distinct gap set per page, carrying only
//      allowlisted names, their kind, and a count of unnamed gaps;
//   3. "Doesn't match TradingView?" — the A3 button, on the note, and as a quiet
//      link for a script that translated fully but still looks different. Shown
//      only while the server's report flag is on (`reportsConfig`), so a member is
//      never offered a button whose request would be refused.
//
// ⛔ THE NOTE ITSELF IS NOT FLAGGED. It stores nothing and sends nothing; it says
// what is true about the script on screen.

import { useEffect, useMemo, useState } from 'react'
import { importGaps, gapNoticeText, gapLogPayload } from './importGaps'
import { logImportGaps } from './supportApi'
import useReportsConfig from './useReportsConfig'
import { LazyReportMismatchDialog } from './reportDoor'
import styles from './ImportGapNotice.module.css'

/**
 * @param {object} props
 * @param {object|null} props.report  the import report (`inspectSource`)
 * @param {string} props.source       the pasted text the report was computed from
 * @param {string|null} [props.sym]
 * @param {string|null} [props.tf]
 * @param {boolean} [props.logGaps]   A2 on (default true)
 */
export default function ImportGapNotice({ report, source = '', sym = null, tf = null, logGaps = true }) {
  const result = useMemo(() => importGaps(report), [report])
  const text = gapNoticeText(result)
  const isPine = !!(report && (report.dialect === 'pine' || report.dialect === undefined) && !report.foreign)
  const cfg = useReportsConfig(isPine)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (logGaps && result.gaps.length) logImportGaps(gapLogPayload(result))
  }, [result, logGaps])

  if (!isPine) return null
  const offer = !!(cfg && cfg.reportsEnabled)
  if (!text && !offer) return null

  const dialog = (
    <LazyReportMismatchDialog
      open={open}
      onClose={() => setOpen(false)}
      source={source}
      sym={sym}
      tf={tf}
      gaps={gapLogPayload(result).gaps}
      name={report && report.title ? report.title : null}
      maxSourceBytes={cfg ? cfg.maxSourceBytes : undefined}
      maxNoteChars={cfg ? cfg.maxNoteChars : undefined}
    />
  )

  if (!text) {
    return (
      <div className={styles.quiet}>
        <button type="button" className={styles.link} onClick={() => setOpen(true)} data-testid="import-report-mismatch">
          Doesn’t match TradingView?
        </button>
        {dialog}
      </div>
    )
  }
  return (
    <div className={styles.notice} role="status" data-testid="import-gap-notice" data-gaps={result.gaps.length}>
      <span>{text}</span>
      {offer && (
        <button type="button" className={styles.link} onClick={() => setOpen(true)} data-testid="import-report-mismatch">
          Doesn’t match TradingView?
        </button>
      )}
      {dialog}
    </div>
  )
}
