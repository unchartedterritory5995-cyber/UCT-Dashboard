// Wave 10 (Task 10.15): the pieces the seven dedicated embeds share. Lazy: imported only by the embeds, which load
// through snapshotEmbeds.js (the snapshot chunk), never by a first-open module.
//
// ⛔ THE SERVER OWNS THE COPY. Every sentence a member reads about their numbers is a payload line, rendered verbatim
// (shelf_discipline.py / shelf_compose.py). The words written here are only labels: column headings, a legend, a bar's
// name. No number is computed that the payload does not carry; a bar's LENGTH is drawn from the carried figures.
import { useId, useState } from 'react'
import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import SnapshotFrame, {
  useSnapshotFrame, fmtPrice, fmtMoneySigned, accountSourceLine, snapshotStyles as s,
} from './SnapshotFrame'
import { SMALL_SAMPLE } from './builtViews/builtModel'
import d from './DedicatedEmbeds.module.css'

/** Bar geometry: a 300-unit viewBox stretched to the widget's width, always 44 px tall. */
export const BAR_W = 300
export const BAR_H = 44
/** An unknown figure in a table: "no data", never a 0 (W9-R7). */
export const NO_DATA = 'no data'
/** A carried 0 in a money cell (none used, none left): the honest word, never "$0.00". */
export const NONE = 'none'

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
export const strings = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string' && x) : [])

/** The payload's own sentences, one per line, verbatim. */
export function Lines({ lines, testId, className = '' }) {
  const list = strings(lines)
  if (!list.length) return null
  return (
    <ul className={`${d.lines} ${className}`} data-testid={testId}>
      {list.map((t, i) => <li key={i} className={d.line}>{t}</li>)}
    </ul>
  )
}

/** A money cell: "no data" for an unknown, `zero` ("none") for a carried zero, else the phase 1 formatter.
 *  `whole: true` decides "zero" the way the server's sentence does (whole dollars, half up: `_whole`), so a +$0.30
 *  average reads "about even" in the table exactly as it does in the sentence (review M-10). */
export function moneyCell(v, { signed = false, zero = NONE, whole = false } = {}) {
  if (!isNum(v)) return <span className={s.none}>{NO_DATA}</span>
  if (whole ? Math.floor(Math.abs(v) + 0.5) === 0 : Math.round(v * 100) === 0) {
    return <span className={s.none}>{zero}</span>
  }
  return signed ? fmtMoneySigned(v) : fmtPrice(v)
}

/** An unknown cell in a table: "no data", never blank and never a 0. */
export function NoData() {
  return <span className={s.none}>{NO_DATA}</span>
}

/**
 * The frame every dedicated embed is drawn in: the phase 1 snapshot frame (title, as-of, privacy, See it now), the
 * widget's figure role and caption, and the provenance line. The body is the embed's own.
 */
export function DedicatedShell({ kind, attrs, height, editable, onUpdateParams, uid, testId, children }) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame(kind, attrs, { editable, onUpdateParams, uid })
  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid={testId}>
      <SnapshotFrame {...frame} sourceLine={accountSourceLine(p)}>
        <div className={d.wrap}>{children}</div>
      </SnapshotFrame>
    </div>
  )
}

export function SmallBadge() {
  return <span className={d.badge}>{SMALL_SAMPLE}</span>
}

/** The "Show as table" toggle and its state (spec 5.11: every chart has a table). */
export function useTableToggle() {
  const [asTable, setAsTable] = useState(false)
  const toggle = (
    <div className={d.tools}>
      <button type="button" className={`${s.btn} ${d.tableToggle}`} aria-pressed={asTable}
        onClick={() => setAsTable((v) => !v)}>
        Show as table
      </button>
    </div>
  )
  return [asTable, toggle]
}

/**
 * One limit as a 44 px bar: used against left, and past the limit HATCHED with a "Past the limit" label, never colour
 * alone. Drawn only from the carried `limit`, `used` and `left`; the scale is the larger of the limit and what was
 * used, so a breach shows how far past the limit it went.
 */
export function LimitBar({ label, limit, used, left, testId }) {
  const hatch = useId()
  if (!isNum(limit) || limit <= 0 || !isNum(used)) return null
  const total = Math.max(limit, used)
  const x = (v) => (Math.max(0, v) / total) * BAR_W
  const past = used > limit
  const usedW = x(Math.min(used, limit))
  const pastW = past ? x(used - limit) : 0
  const leftW = isNum(left) && left > 0 ? x(left) : 0
  return (
    <div className={d.barRow} data-testid={testId} data-past={past ? '' : undefined}>
      <span className={d.barLabel}>{label}</span>
      <svg data-bar="" className={d.bar} viewBox={`0 0 ${BAR_W} ${BAR_H}`} preserveAspectRatio="none" height={BAR_H}
        aria-hidden="true" focusable="false">
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className={d.hatchLine} data-hatch-line="" />
          </pattern>
        </defs>
        <rect className={d.track} x="0" y="0" width={BAR_W} height={BAR_H} />
        {usedW > 0 && <rect className={d.used} data-bar-used="" x="0" y="0" width={usedW} height={BAR_H} />}
        {leftW > 0 && <rect className={d.track} data-bar-left="" x={usedW} y="0" width={leftW} height={BAR_H} />}
        {pastW > 0 && (
          <rect data-bar-past="" x={x(limit)} y="0" width={pastW} height={BAR_H} fill={`url(#${hatch})`} />
        )}
        {past && (
          <>
            <line className={d.limitMarkUsed} vectorEffect="non-scaling-stroke" x1={x(limit) - 1} y1="0"
              x2={x(limit) - 1} y2={BAR_H} />
            <line className={d.limitMark} data-limit-mark="" vectorEffect="non-scaling-stroke" x1={x(limit) + 1} y1="0"
              x2={x(limit) + 1} y2={BAR_H} />
          </>
        )}
      </svg>
      <ul className={d.legend}>
        <li className={d.legendItem}><span className={`${d.swatch} ${d.swUsed}`} />Used</li>
        {!past && <li className={d.legendItem}><span className={`${d.swatch} ${d.swLeft}`} />Left</li>}
        {past && (
          <li className={`${d.legendItem} ${d.pastText}`}><span className={`${d.swatch} ${d.swPast}`} />Past the limit</li>
        )}
      </ul>
    </div>
  )
}

export { d as dedicatedStyles }
