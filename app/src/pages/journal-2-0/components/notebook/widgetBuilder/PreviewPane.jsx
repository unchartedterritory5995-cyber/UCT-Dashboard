import { useEffect, useId, useState } from 'react'
import UIcon from '../../../../../components/ui/UIcon'
import NumberView from '../widgets/builtViews/NumberView'
import TableView from '../widgets/builtViews/TableView'
import TableAlt from '../widgets/builtViews/TableAlt'
import CompareView from '../widgets/builtViews/CompareView'
import BarView from '../widgets/builtViews/BarView'
import LineView from '../widgets/builtViews/LineView'
import ScatterView from '../widgets/builtViews/ScatterView'
import HeatView from '../widgets/builtViews/HeatView'
import ListView from '../widgets/builtViews/ListView'
import ProgressView from '../widgets/builtViews/ProgressView'
import { CoverageNote, Footnotes } from '../widgets/builtViews/Counts'
import { measuresOf, cellOf, countNoun } from '../widgets/builtViews/builtModel'
import { failureText } from '../../../lib/builtWidgets'
import styles from './WidgetBuilderSheet.module.css'

/**
 * The builder's live preview (spec 5.2). It draws the preview payload with the SAME view components a placed widget
 * uses (widgets/builtViews), so what the member builds is what the note will show.
 *
 * ⛔ THE LAST GOOD RESULT STAYS. A preview that fails (busy, took too long, the preview pausing, offline) keeps the
 * last answer on screen, dimmed, with the failure's own sentence (lib/builtWidgets failureText) — never a blank.
 * `stale` (Task 10.16 fix 1, m-6): no preview could be asked for (one of the member's own fields is refused, and says
 * why beside it): the last answer is dimmed the same way, with no sentence of its own.
 * ⛔ The live region announces ONLY the summary sentence, a second after it settles (spec 5.11), never a table, a
 * failure or "Updating".
 *
 * Phone (<= 640 px): a one-line sticky summary ("<name> · 47 trades · +$2,140.00") that opens the full preview on
 * tap and is not drawn while the keyboard is open, so a field being typed in keeps the screen.
 */
const VIEWS = {
  number: NumberView, compare: CompareView, table: TableView, bar: BarView, line: LineView,
  scatter: ScatterView, heat: HeatView, list: ListView, progress: ProgressView,
}
export const SAMPLE_LABEL = 'Sample data'
export const ANNOUNCE_DELAY_MS = 1000

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** The phone summary line: "<name> · <count> <unit> · <first value>" (the value only when there is one total). */
export function summaryLine(name, payload, unit) {
  // Fix 1, I-4: a preview on the bundled sample book says so first, wherever its summary is read.
  const parts = payload?.sample === true ? [SAMPLE_LABEL, name || 'Widget'] : [name || 'Widget']
  if (payload && finite(payload.count)) parts.push(`${payload.count.toLocaleString('en-US')} ${countNoun(unit, payload.count)}`)
  const m = measuresOf(payload || {})[0]
  const v = payload?.value
  if (m && v && typeof v === 'object' && (finite(v.v1) || v.s1 === 'hide')) parts.push(cellOf(v, 1, m).text)
  return parts.join(' · ')
}

/** The summary sentence, announced politely a second after it last changed. One region, one sentence. */
function useAnnounced(summary) {
  const [said, setSaid] = useState('')
  useEffect(() => {
    if (!summary) return undefined
    const t = setTimeout(() => setSaid(summary), ANNOUNCE_DELAY_MS)
    return () => clearTimeout(t)
  }, [summary])
  return said
}

function PreviewBody({ payload, status, error, onRetry, onSuggestRange, canSuggestRange, suggestOff, stale }) {
  const [asTable, setAsTable] = useState(false)
  const failed = status === 'error' && error
  const text = failed ? failureText(error.code, error.message) : ''
  if (!payload) {
    return (
      <div className={styles.previewEmpty}>
        {failed ? (
          <>
            <p className={styles.previewMsg}>{text}</p>
            <PreviewActions code={error.code} onRetry={onRetry} onSuggestRange={onSuggestRange}
              canSuggestRange={canSuggestRange} suggestOff={suggestOff} />
          </>
        ) : <p className={styles.sectionHint}>Working out your preview…</p>}
      </div>
    )
  }
  const view = Object.hasOwn(VIEWS, payload.view) ? payload.view : 'number'
  const View = VIEWS[view]
  const empty = typeof payload.empty === 'string' && payload.empty && !payload.tooLarge ? payload.empty : null
  const canToggle = !empty && view !== 'table'
  return (
    <>
      {payload.sample === true && <p className={styles.sampleRibbon}>{SAMPLE_LABEL}</p>}
      {failed && (
        <div className={styles.previewFail}>
          <p className={styles.previewMsg}>{text}</p>
          <PreviewActions code={error.code} onRetry={onRetry} onSuggestRange={onSuggestRange}
            canSuggestRange={canSuggestRange} suggestOff={suggestOff} />
        </div>
      )}
      <div className={`${styles.previewView} ${failed || stale ? styles.dimmed : ''}`} aria-busy={status === 'loading'}
        data-stale={stale ? '' : undefined}
        data-testid="builder-preview-view">
        {payload.title && <p className={styles.previewTitle}>{payload.title}</p>}
        {(payload.scopeLabel || payload.rangeLabel) && (
          <p className={styles.previewLabels}>{[payload.scopeLabel, payload.rangeLabel].filter(Boolean).join(' · ')}</p>
        )}
        {empty ? <p className={styles.sectionHint}>{empty}</p>
          : asTable && canToggle ? <TableAlt params={payload} onDrill={null} />
            : <View params={payload} onDrill={null} />}
        {!empty && view !== 'number' && view !== 'compare' && view !== 'progress' && <CoverageNote params={payload} />}
        {typeof payload.notice === 'string' && payload.notice && <p className={styles.sectionHint}>{payload.notice}</p>}
        {!empty && <Footnotes params={payload} />}
        {canToggle && (
          <button type="button" className={styles.btn} aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
            Show as table
          </button>
        )}
      </div>
    </>
  )
}

/** `suggestOff`: the range suggestion is shown but says it is not available (saved but gone, fix 4, NEW-2). The builder
 *  itself takes no edit then (its one guard), so the click needs none here. */
function PreviewActions({ code, onRetry, onSuggestRange, canSuggestRange, suggestOff }) {
  if (code === 'offline' || code === 'superseded') return null
  return (
    <div className={styles.pickerActions}>
      {code === 'too_long' && canSuggestRange && (
        <button type="button" className={styles.btn} aria-disabled={suggestOff || undefined} onClick={onSuggestRange}>
          Last 90 days
        </button>
      )}
      <button type="button" className={styles.btn} onClick={onRetry}>
        <UIcon name="refresh" size={14} gold={false} aria-hidden="true" />
        <span>Try again</span>
      </button>
    </div>
  )
}

export default function PreviewPane({
  payload, status, error, name, unit, phone, keyboardOpen, onRetry, onSuggestRange, canSuggestRange, suggestOff = false,
  stale = false,
}) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const said = useAnnounced(typeof payload?.summary === 'string' && payload.summary
    ? `${payload.sample === true ? `${SAMPLE_LABEL} · ` : ''}${payload.summary}` : '')
  const summary = typeof payload?.summary === 'string' ? payload.summary : ''
  const body = (
    <PreviewBody payload={payload} status={status} error={error} onRetry={onRetry}
      onSuggestRange={onSuggestRange} canSuggestRange={canSuggestRange} suggestOff={suggestOff} stale={stale} />
  )
  const live = (
    <p className={styles.srOnly} role="status" aria-live="polite" data-testid="builder-live">{said}</p>
  )

  if (phone) {
    // The live region stays outside the part the keyboard hides: a hidden region announces nothing.
    return (
      <>
        {live}
        <div className={styles.phonePreview} data-testid="builder-phone-preview" hidden={keyboardOpen}>
        {!keyboardOpen && (
          <>
            <button type="button" className={styles.summaryBar} aria-expanded={open} aria-controls={bodyId}
              onClick={() => setOpen((v) => !v)} data-testid="builder-summary-bar">
              <span className={`${styles.summaryText} ${status === 'error' || stale ? styles.dimmed : ''}`}>
                {summaryLine(name, payload, unit)}
              </span>
              <UIcon name={open ? 'chevronUp' : 'chevronDown'} size={16} gold={false} aria-hidden="true" />
              <span className={styles.srOnly}>{open ? 'Hide the preview' : 'Show the preview'}</span>
            </button>
            <div id={bodyId} className={styles.phonePreviewBody} hidden={!open}>
              {open && (
                <>
                  {body}
                  {summary && <p className={styles.summary}>{summary}</p>}
                </>
              )}
            </div>
          </>
        )}
        </div>
      </>
    )
  }
  return (
    <aside className={styles.preview} aria-label="Preview" data-testid="builder-preview">
      <h3 className={styles.previewHeading}>Preview</h3>
      {body}
      {summary && <p className={styles.summary}>{summary}</p>}
      {live}
    </aside>
  )
}
