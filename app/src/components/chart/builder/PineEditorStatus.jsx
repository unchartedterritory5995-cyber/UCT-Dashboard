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
import { afterFirstChartPaint } from '../../../lib/barsPackClient'
import { runHereWhenLanded, RUN, MIN_BARS, STOPPED_HEADLINE, CHECKING_HEADLINE, WAITING_HEADLINE, WAITING_LINE } from './runsHere'
import { drawingLossOf, LOST_DRAWINGS_HEADLINE } from './authoring/scriptAnswer'
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

/** What a real run on THIS chart said, and the drawings the lane lost: the engine's own sentences. */
function OnThisChart({ status, shown }) {
  const run = shown.run
  const stops = shown.state === SHOWN_STATE.STOPPED_HERE && run ? run.stops : []
  const lost = shown.state === SHOWN_STATE.DRAWINGS_LOST ? status.lostDrawings : null
  const waiting = shown.state === SHOWN_STATE.WAITS_FOR_THE_BAR && run ? [WAITING_LINE, ...new Set(run.waiting.map((w) => w.sentence))] : []
  const notes = run && run.state === RUN.RAN ? [...waiting, ...run.notes, ...run.unchecked.map((u) => `Not checked here (${u.guard}): it is checked when the script is on the chart.`)] : []
  if (!stops.length && !lost && !notes.length) return null
  return (
    <section className={styles.body} aria-label="On this chart" data-testid="pine-status-on-this-chart" data-run={run ? run.state : ''}>
      <h5 className={styles.subhead}>On this chart</h5>
      <ul className={styles.items}>
        {stops.map((s, i) => (
          <li key={`s${i}`} className={styles.item} data-testid="pine-status-run-stop" data-guard={s.guard}>
            {/* ⛔ VERBATIM: the engine's own sentence for the stop. */}
            <p className={styles.itemWhy}>{s.sentence}</p>
          </li>
        ))}
        {lost && (
          <li className={styles.item} data-testid="pine-status-lost-drawings">
            <p className={styles.itemWhy}>{lost}</p>
          </li>
        )}
        {notes.map((n, i) => (
          <li key={`n${i}`} className={styles.item} data-testid="pine-status-run-note">
            <p className={styles.itemWhy}>{n}</p>
          </li>
        ))}
      </ul>
      {stops.length > 0 && (
        <p className={styles.still}>This is about the chart you opened the builder over. The script itself can still be saved.</p>
      )}
    </section>
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
            {/* ⭐ a number the box's threshold control can make a screen of: still [--],
                worded "needs a threshold" (the evaluability sentence stays beside it) */}
            {!r.ok && r.thresholdWhy && (
              <span className={styles.consumerWhy} data-testid="pine-status-threshold">{r.thresholdWhy}</span>
            )}
            {!r.ok && r.why && (
              <span className={styles.consumerWhy} data-testid="pine-status-consumer-why">
                {r.subject ? `${r.subject}: ${r.why}` : r.why}
              </span>
            )}
            {/* ⭐ The screener lane's refusals of single plots: facts about SCREENS,
                named, verbatim. Never a line mark, never "Tell us". */}
            {Array.isArray(r.refused) && r.refused.length > 0 && (
              <details className={styles.details} data-testid="pine-status-refused">
                <summary>{`Plots it cannot use: ${r.refused.length}`}</summary>
                <ul className={styles.refusedList}>
                  {r.refused.map((x, i) => (
                    <li key={`${x.name}-${i}`} data-guard={x.guard || ''}>
                      <b>{x.name}</b>{x.why ? `: ${x.why}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      {/* ⭐ THE SAVED VERSION, beside the live rows and never instead of them: its own
          facts, labelled, shown only while the editor holds that version's script. */}
      {status.saved && (
        <div className={styles.saved} data-testid="pine-status-saved">
          {status.saved.held && (
            <p className={styles.savedLine} data-testid="pine-status-saved-held">
              <b>{`Saved version: ${status.saved.label}.`}</b>{' '}{status.saved.why}
            </p>
          )}
          {status.saved.held && status.saved.detail && (
            <details className={styles.details}>
              <summary>Details</summary>
              {/* ⛔ VERBATIM: the script engine's own reason for the hold. */}
              <span>{status.saved.detail}</span>
            </details>
          )}
          {status.saved.scan && (
            <p className={styles.savedLine} data-testid="pine-status-saved-scan">
              <b>Saved version, in screens and scans:</b>{' '}{status.saved.scan.detail}
            </p>
          )}
        </div>
      )}
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

// ─── ⭐⭐ "RUNS" MEANS IT RAN (2026-11-19) ─────────────────────────────────────────
//
// `editorStatus` is decided before any bar is computed. It says "Runs on the chart" for a script
// the engine then refuses when it runs it (a value kept since the first bar on a chart that does
// not reach the listing, a clock read, a loop past its limit), and "runs, with 1 note" for one
// whose whole drawing program was lost. A member told "Runs" who then gets an empty pane was told
// something false. So the panel also asks for a REAL RUN on the chart the builder was opened over,
// through the one function the Create Indicator dock uses (`runsHere.js`), and leads with what it
// said.
//
// ⛔ THE STATUS ITSELF IS NOT CHANGED. `status.state`, `status.headline` and `status.items` are the
// SCRIPT's (what is saved, what gates the buttons, what is recorded beside a saved version); a stop
// on THIS chart is a fact about this chart. It rides beside them (`status.run`, `status.lostDrawings`)
// and only `shownStatus` (what the panel leads with) reads it.
//
// ⛔ NEVER ON THE CRITICAL PATH. The run is asked for after the chart's first paint, once per
// script per (symbol, timeframe, listing fact): a new bar does not re-run it.

/** The display state of a script whose run stopped on this chart / whose drawings were lost. */
export const SHOWN_STATE = Object.freeze({ STOPPED_HERE: 'stopped-here', DRAWINGS_LOST: 'drawings-lost', WAITS_FOR_THE_BAR: 'waits-for-the-bar' })

// ⛔ READ WHEN ASKED, NEVER WHEN THIS FILE LOADS. `editorStatus.js` reaches this file through an import
// cycle (editorStatus -> memberPaneDefinition -> BuilderSheet -> PineBox -> here), so a test or a page
// that loads `editorStatus.js` FIRST evaluates this file while `PANEL_STATE` is still undefined. A
// list built at load crashed two test files on exactly that (`Cannot read properties of undefined`).
const runsStates = () => [PANEL_STATE.RUNS, PANEL_STATE.RUNS_WITH_NOTES, PANEL_STATE.RUNS_WITHHELD]

/**
 * A real run of `pane` on `chart` (`{bars, ctx}`), or null while there is nothing to run on.
 * PENDING from the moment it is asked for until the engine answers.
 */
export function useRunOnChart(pane, chart, { run = runHereWhenLanded, after = afterFirstChartPaint } = {}) {
  const [out, setOut] = useState(null)
  const bars = chart && Array.isArray(chart.bars) ? chart.bars : null
  const ctx = chart && chart.ctx ? chart.ctx : null
  const runnable = !!(pane && pane.ok === true && ctx && bars && bars.length >= MIN_BARS)
  // one run per script per chart identity, never per bar
  const key = runnable ? `${ctx.sym}|${ctx.tf}|${ctx.historyFromListing === true ? 'listing' : 'off'}` : null
  // ⛔ the effect depends on the SCRIPT and the CHART'S IDENTITY only. The bars, the runner and the
  // "after first paint" hook are read through a ref: a caller that hands a fresh function (or a
  // fresh bars array) on every render must not start a run on every render.
  const latest = useRef({ pane, chart, run, after })
  // (kept current in an effect declared BEFORE the one that reads it: effects run in order)
  useEffect(() => { latest.current = { pane, chart, run, after } })
  useEffect(() => {
    if (!key) { setOut(null); return undefined }
    let live = true
    const asked = latest.current.pane
    setOut({ pane: asked, result: { state: RUN.PENDING, stops: [], unchecked: [], waiting: [], notes: [] } })
    latest.current.after(() => {
      if (!live) return
      Promise.resolve()
        .then(() => latest.current.run(latest.current.pane, latest.current.chart))
        .then((result) => { if (live) setOut({ pane: asked, result }) })
        .catch(() => { if (live) setOut(null) })
    })
    return () => { live = false }
  }, [pane, key])
  return out && out.pane === pane ? out.result : null
}

/**
 * What the panel LEADS with: the script's status, unless this chart says otherwise.
 *   a run that STOPPED here     -> "It does not run on this chart"
 *   drawings the lane lost      -> "Its plots run on the chart, but its drawings are not all drawn"
 *   a run still in flight       -> "Still being checked on this chart" (only where the status said "runs")
 *   a run waiting for the bar   -> "Draws once this bar has finished" (a last-bar script on a forming bar)
 */
export function shownStatus(status) {
  if (!status) return { headline: '', state: null, run: null }
  const run = status.run || null
  const says = runsStates().includes(status.state)
  if (says && run && run.state === RUN.STOPPED) return { headline: STOPPED_HEADLINE, state: SHOWN_STATE.STOPPED_HERE, run }
  if (says && status.lostDrawings) return { headline: LOST_DRAWINGS_HEADLINE, state: SHOWN_STATE.DRAWINGS_LOST, run }
  if (says && run && run.state === RUN.PENDING) return { headline: CHECKING_HEADLINE, state: PANEL_STATE.CHECKING, run }
  // (a script that draws on the chart's last bar, on a chart whose newest bar is still forming: nothing is wrong
  // with it, and it is not drawn yet. `runsHere.js::WAITS_FOR_THE_BAR`)
  if (says && run && run.state === RUN.RAN && run.waiting && run.waiting.length) {
    return { headline: WAITING_HEADLINE, state: SHOWN_STATE.WAITS_FOR_THE_BAR, run }
  }
  return { headline: status.headline, state: status.state, run }
}

/**
 * The panel's status for PasteBox's report, or null (flag off / not Pine).
 * A hook so PasteBox can hand the SAME status to the panel and to the editor's
 * line marks: one computation, two renderers.
 */
export function usePineEditorStatus({ enabled, report, inspectedSource = '', savedRow = null, computePane = paneFor, chart = null, runOnChart = undefined }) {
  // ⭐ A Pine paste the translator threw on is the door's controlled error report,
  // stamped `formula` by the auto door; `faultDialect` is the door's own record that
  // it had read the text as Pine (`PineBox.inspectSource`), so the engine-fault
  // state can be shown for it.
  const isPine = !!(enabled && report && !report.foreign
    && (report.dialect === 'pine' || report.faultDialect === 'pine'))
  const pane = useMemo(() => (isPine ? computePane(report, inspectedSource) : null),
    [isPine, report, inspectedSource, computePane])
  const status = useMemo(() => (isPine ? editorStatus({ report, pane, savedRow, inspectedSource }) : null),
    [isPine, report, pane, savedRow, inspectedSource])
  // ⭐ the real run, and the drawings the lane lost: beside the status, never inside it (see above)
  const run = useRunOnChart(status ? pane : null, chart, runOnChart ? { run: runOnChart } : undefined)
  const lostDrawings = useMemo(() => (status ? drawingLossOf(pane) : null), [status, pane])
  return useMemo(() => (status && (run || lostDrawings) ? { ...status, run, lostDrawings } : status), [status, run, lostDrawings])
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
  const shown = shownStatus(status)
  const headline = checking ? CHECKING_TEXT : shown.headline
  const state = checking ? PANEL_STATE.CHECKING : shown.state
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
    <>
      <OnThisChart status={status} shown={shown} />
      <Body status={status} source={inspectedSource} onGoToLine={goTo}
        onReport={() => setReportOpen(true)} reportOffered={reportOffered} />
    </>
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
