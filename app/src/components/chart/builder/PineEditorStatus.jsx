// app/src/components/chart/builder/PineEditorStatus.jsx
//
// ─── THE PINE EDITOR'S STATUS PANEL ──────────────────────────────────────────
//
// Spec: `docs/pine/EDITOR-STATUS-PANEL-SPEC.md` (mockups 3.1 to 3.3 of the Pine
// full-parity plan). Mounted by `PineBox.jsx::PasteBox` only while
// `editorStatusEnabled()` (VITE_PINE_EDITOR_STATUS === '1').
//
// ⛔ IT RENDERS `editorStatus.js`'s answer and writes no reason of its own. Every
// engine sentence is shown verbatim under "Details"; the plain-English line above
// it is the FAMILY's, from the one table in `editorStatus.js`.
//
// ⭐ Touch tier (<= 1024 px, `useIsTouch`): a one-row summary whose `Details`
// button opens the full panel in `mobile/Sheet`. Above that, inline.

import { useEffect, useMemo, useRef, useState } from 'react'
import { memberPaneDefinition } from './memberPane/memberPaneDefinition'
import {
  editorStatus, PANEL_STATE, SEVERITY, stillWorksText, sourceLine,
} from './editorStatus'
import { importGaps, gapLogPayload } from '../supportLoop/importGaps'
import useReportsConfig from '../supportLoop/useReportsConfig'
import { LazyReportMismatchDialog } from '../supportLoop/reportDoor'
import Sheet from '../../mobile/Sheet'
import { useIsTouch } from '../../../hooks/useBreakpoint'
import styles from './PineEditorStatus.module.css'

export const CHECKING_TEXT = 'Checking your script...'
export const POLICY_TEXT = 'Anything we cannot compute the way TradingView does is withheld and named '
  + 'here, never guessed.'

const BADGE = Object.freeze({ true: '[OK]', partial: '[~]', false: '[--]' })

/** The chart's view of the script, through the door "Add to chart" uses. Never throws.
 *  ⛔ NOT GATED ON `report.ok`. The report is the screener lane's translation; it
 *  refuses a strategy and an objects-only script that the chart door draws, so the
 *  chart row always asks the chart door, which answers with its own refusal. */
export function paneFor(report, source) {
  if (!report || report.dialect !== 'pine' || report.error || report.foreign) return null
  try {
    return memberPaneDefinition({ source })
  } catch (e) {
    return { ok: false, reason: `the translator threw: ${String((e && e.message) || e)}`, guard: 'import:internal-error' }
  }
}

function ItemRow({ it, source, onGoToLine }) {
  const text = it.line != null ? sourceLine(source, it.line) : null
  return (
    <li className={styles.item} data-testid="pine-status-item" data-severity={it.severity}
      data-family={it.family} data-line={it.line ?? ''} data-guard={it.guard || ''}>
      <div className={styles.itemHead}>
        {it.line != null ? (
          <button type="button" className={styles.lineBtn} onClick={() => onGoToLine && onGoToLine(it.line)}
            aria-label={`Go to line ${it.line}`} data-testid="pine-status-goto">
            {`Line ${it.line}`}
          </button>
        ) : <span className={styles.lineNone}>This script</span>}
        <span className={styles.itemName}>{it.name}</span>
      </div>
      {text && <code className={styles.itemSource}>{text}</code>}
      <p className={styles.itemWhy}><b>{it.label}.</b>{' '}{it.why}</p>
      {it.reason && (
        <details className={styles.details}>
          <summary>Details</summary>
          {/* ⛔ VERBATIM: the refusing door owns this sentence. */}
          <span data-testid="pine-status-reason">{it.reason}</span>
        </details>
      )}
    </li>
  )
}

function Body({ status, source, onGoToLine, onReport, reportOffered }) {
  const withheld = status.items.filter((x) => x.severity === SEVERITY.WITHHELD)
  const maybe = status.items.filter((x) => x.severity === SEVERITY.MAY_WITHHOLD)
  const notes = status.items.filter((x) => x.severity === SEVERITY.NOTE)
  return (
    <div className={styles.body}>
      <ul className={styles.runsOn} aria-label="Where this script runs" data-testid="pine-status-runs-on">
        {status.runsOn.map((r) => (
          <li key={r.id} className={styles.consumer} data-consumer={r.id} data-ok={String(r.ok)}>
            <span className={styles.badge} data-ok={String(r.ok)}>{BADGE[String(r.ok)]}</span>
            <span className={styles.consumerLabel}>{r.label}</span>
            {r.ok === true && r.note && <span className={styles.consumerWhy}>{`(${r.note})`}</span>}
            {r.ok === 'partial' && <span className={styles.consumerWhy}>(draws, with values withheld below)</span>}
            {!r.ok && r.why && <span className={styles.consumerWhy}>{r.why}</span>}
            {!r.ok && r.detail && (
              <details className={styles.details}>
                <summary>Details</summary>
                <span>{r.detail}</span>
              </details>
            )}
          </li>
        ))}
      </ul>
      {status.lane && (
        <p className={styles.engine} data-testid="pine-status-engine" data-lane={status.lane}>
          {status.lane === 'runtime'
            ? 'Engine: runtime (runs bar by bar, chart only)'
            : 'Engine: host (fast path)'}
        </p>
      )}
      {withheld.length > 0 && (
        <section aria-label="Withheld, not guessed">
          <h5 className={styles.subhead}>Withheld, not guessed</h5>
          <ul className={styles.items}>
            {withheld.map((it, i) => <ItemRow key={`w${i}`} it={it} source={source} onGoToLine={onGoToLine} />)}
          </ul>
        </section>
      )}
      {maybe.length > 0 && (
        <section aria-label="May be withheld on some charts">
          <h5 className={styles.subhead}>May be withheld on some charts</h5>
          <ul className={styles.items}>
            {maybe.map((it, i) => <ItemRow key={`m${i}`} it={it} source={source} onGoToLine={onGoToLine} />)}
          </ul>
        </section>
      )}
      {notes.length > 0 && (
        <section aria-label="Notes">
          <h5 className={styles.subhead}>Notes</h5>
          <ul className={styles.items}>
            {notes.map((it, i) => (
              <li key={`n${i}`} className={styles.item} data-testid="pine-status-item" data-severity={it.severity} data-line={it.line ?? ''}>
                <div className={styles.itemHead}>
                  {it.line != null ? (
                    <button type="button" className={styles.lineBtn} onClick={() => onGoToLine && onGoToLine(it.line)}
                      aria-label={`Go to line ${it.line}`}>{`Line ${it.line}`}</button>
                  ) : null}
                  <span className={styles.itemName}>{it.name}</span>
                </div>
                <p className={styles.itemWhy}>{it.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {status.state !== PANEL_STATE.ENGINE_ERROR && (
        <p className={styles.still} data-testid="pine-status-still">{stillWorksText(status.stillWorks)}</p>
      )}
      {reportOffered && (withheld.length > 0 || maybe.length > 0) && (
        <button type="button" className={styles.action} onClick={onReport} data-testid="pine-status-tell-us"
          aria-haspopup="dialog">
          Tell us you need this
        </button>
      )}
      <p className={styles.policy}>{POLICY_TEXT}</p>
    </div>
  )
}

/**
 * The panel's status for PasteBox's report, or null (flag off / not Pine).
 * A hook so PasteBox can hand the SAME status to the panel and to the editor's
 * line marks: one computation, two renderers.
 */
export function usePineEditorStatus({ enabled, report, inspectedSource = '', savedRow = null, computePane = paneFor }) {
  // ⭐ A Pine paste the translator threw on is the door's controlled error report,
  // stamped `formula` by the auto door; `faultDialect` is the door's own record that
  // it had read the text as Pine (`PineBox.inspectSource`), so the engine-fault
  // state can be shown for it.
  const isPine = !!(enabled && report && !report.foreign
    && (report.dialect === 'pine' || report.faultDialect === 'pine'))
  const pane = useMemo(() => (isPine ? computePane(report, inspectedSource) : null),
    [isPine, report, inspectedSource, computePane])
  return useMemo(() => (isPine ? editorStatus({ report, pane, savedRow }) : null),
    [isPine, report, pane, savedRow])
}

/**
 * @param {object} props
 * @param {object|null} props.status   `usePineEditorStatus`'s answer
 * @param {object|null} props.report   PasteBox's report (`inspectSource`)
 * @param {string} props.inspectedSource the text that report was computed on
 * @param {string} props.currentText   the editor's text now
 * @param {(line: number) => void} [props.onGoToLine]
 */
export default function PineEditorStatus({
  status, report, inspectedSource = '', currentText = '', sym = null, tf = null, onGoToLine = null,
}) {
  const isTouch = useIsTouch()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const isPine = !!status
  const cfg = useReportsConfig(isPine)
  const gaps = useMemo(() => gapLogPayload(importGaps(report)).gaps, [report])
  // ⛔ A `Line N` tapped inside the touch Sheet is applied AFTER the Sheet closes.
  // `mobile/Sheet` hands focus back to its opener when it closes; called at the
  // tap, the editor's focus was taken straight back to the Details button. This
  // effect's setup runs after the Sheet's close cleanup, so the editor keeps it.
  const pendingLine = useRef(null)
  useEffect(() => {
    if (sheetOpen || pendingLine.current == null) return
    const n = pendingLine.current
    pendingLine.current = null
    if (onGoToLine) onGoToLine(n)
  }, [sheetOpen, onGoToLine])

  if (!isPine || !status || !String(currentText || '').trim()) return null
  const checking = currentText !== inspectedSource
  const headline = checking ? CHECKING_TEXT : status.headline
  const state = checking ? PANEL_STATE.CHECKING : status.state
  const reportOffered = !!(cfg && cfg.reportsEnabled)
  const goTo = (n) => {
    if (sheetOpen) {
      pendingLine.current = n
      setSheetOpen(false)
      return
    }
    if (onGoToLine) onGoToLine(n)
  }

  const body = checking ? null : (
    <Body status={status} source={inspectedSource} onGoToLine={goTo}
      onReport={() => setReportOpen(true)} reportOffered={reportOffered} />
  )

  return (
    <section className={styles.wrap} aria-labelledby="uct-pine-status-head" data-testid="pine-editor-status"
      data-state={state}>
      <div className={styles.top}>
        <h4 className={styles.head} id="uct-pine-status-head">Status</h4>
        <p className={styles.headline} role="status" data-testid="pine-status-headline" data-state={state}>{headline}</p>
        {isTouch && !checking && (
          <button type="button" className={styles.action} onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog" data-testid="pine-status-open-sheet">
            Details
          </button>
        )}
      </div>
      {!isTouch && body}
      {isTouch && (
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} variant="auto" title="Script status"
          labelledByTitle maxWidth={520}>
          <p className={styles.headline}>{headline}</p>
          {body}
        </Sheet>
      )}
      <LazyReportMismatchDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        source={inspectedSource}
        sym={sym}
        tf={tf}
        gaps={gaps}
        name={report && report.title ? report.title : null}
        maxSourceBytes={cfg ? cfg.maxSourceBytes : undefined}
        maxNoteChars={cfg ? cfg.maxNoteChars : undefined}
      />
    </section>
  )
}
