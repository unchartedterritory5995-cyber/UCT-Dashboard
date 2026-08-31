/**
 * Timeline — THE READABLE TAPE. Rows = metrics, columns = the most recent
 * sessions, and every cell prints the reading it is tinted by.
 *
 * ⛔⛔ IT IS NOT A SHORTER HEAT RIBBON, AND THAT WAS THE WHOLE PROBLEM.
 *
 * Until now it drew the same picture the Ribbon draws — metric rows × session
 * columns, cell coloured by tier — in 11px bands over ~110px of a 726px panel,
 * with no dates on the columns and no numbers in the cells. Two views answering
 * one question, one of them badly, is worse than either alone: the reader learns
 * that some of this tab is decoration.
 *
 * ⭐ SO THE TWO ARE SPLIT BY WHAT THEY CAN STRUCTURALLY CARRY, not by a
 * preference that can drift:
 *
 *   Heat Ribbon — the WHOLE loaded window (up to 365 columns) under a playhead.
 *     At that density a column is one to three pixels wide, so it can never
 *     carry a date or a number. It is a picture of a SHAPE: "when did the regime
 *     turn?"
 *
 *   Timeline — the recent tape. The container hands it `recentRows`, which is
 *     `filledRows.slice(rowIdx, rowIdx + 30)`, so it is capped at thirty columns
 *     BY CONSTRUCTION and can never become a ribbon. That cap is what buys the
 *     room to print a DATE on every column and the READING in every cell. It is
 *     a table: "what were the actual numbers this fortnight, and which day did
 *     each one turn?"
 *
 * The distinction is enforced by the props each is given, not by a comment: the
 * Ribbon reads `rows`, this reads `recentRows`. A change that let this view see
 * the whole window would have to change the container's bundle to do it.
 *
 * 🔴 AND THE ROWS FLEX (`fillsRow`). The height was always offered — the
 * container hands every view `flex: 1; min-height: 0` — and every band declined
 * it at a fixed 16px. Nothing a reader is meant to read values off should be
 * eleven pixels tall.
 */
import { Fragment } from 'react'
import {
  ALL_METRICS_HIDDEN, drillProps, inkOn, metricColor, resolveViewColors,
} from './breadthViewShared'
import useHoverReadout from './useHoverReadout'
import HoverReadout from './HoverReadout'
import UIcon from '../../../components/ui/UIcon'
import signalStyles from './signals.module.css'

// The label gutter and the gap, declared once and read by BOTH grids — the
// dated header and the cell body are separate elements so the header can stay
// put while the body flexes, and two copies of these numbers would put a date
// a pixel off the column it names.
const LABEL_W = 108
const GAP = 3
// A band is a floor and a ceiling, never a height: it shrinks to `MIN` in a
// quarter-size compare pane before the tape scrolls, and stops at `MAX` so a
// two-metric board does not draw two slabs.
const ROW_MIN_H = 22
const ROW_MAX_H = 62

// One delegated listener for the whole grid — every cell names the metric and
// the column it belongs to, so the handler needs no per-cell closure.
const cellOf = (e) => {
  const el = e.target?.closest?.('[data-seek-idx]')
  if (!el) return null
  const i = Number(el.getAttribute('data-seek-idx'))
  return Number.isInteger(i) ? { i, mkey: el.getAttribute('data-mkey') } : null
}

// A column header says MM-DD: the year is the same on every column of a
// thirty-session tape, and the basis line above already carries the full dates.
const dayLabel = (d) => (typeof d === 'string' && d.length >= 10 ? d.slice(5) : String(d ?? ''))

// The reading has to fit the column it is printed in, and the column width is a
// function of how many there are. Derived rather than measured so it is the same
// answer in a compare pane as at full width.
const valueFont = (cols) => (cols <= 12 ? 12 : cols <= 20 ? 11 : 9.5)

export default function TimelineView({
  recentRows = [], metrics, onDrill, onSeek, canSeek, signalKey, notableKey, options = {},
}) {
  const { hostRef, tipRef, show, hide } = useHoverReadout()
  if (!recentRows.length) return null

  // 🔴 UNCHECK EVERY METRIC IN CUSTOMIZE AND THIS RENDERED `null` — a blank
  // panel, no message, indistinguishable from a view that crashed. Same sentence
  // the Monitor tab and the two lenses beside it give.
  if (!metrics?.length) {
    return (
      <div data-testid="timeline-refusal"
           style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        {ALL_METRICS_HIDDEN}
      </div>
    )
  }

  const win = options.windowDays ?? 10
  const days = [...recentRows].slice(0, win).reverse()  // oldest → newest, up to `win`
  const colors = resolveViewColors(options.palette, options.intensity)
  const cols = days.length
  const byKey = Object.fromEntries(metrics.map(m => [m.key, m]))
  const reachable = days.map(r => (canSeek ? !!canSeek(r.date) : false))
  const template = `${LABEL_W}px repeat(${cols}, minmax(0, 1fr))`
  const fs = valueFont(cols)

  return (
    <div ref={hostRef}
         style={{ height: '100%', minHeight: 0, padding: '12px 18px', position: 'relative',
                  display: 'flex', flexDirection: 'column' }}>
      <div data-testid="timeline-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8, flex: '0 0 auto' }}>
        {`${cols} session${cols === 1 ? '' : 's'} · ${days[0]?.date} → ${days[cols - 1]?.date}`}
        {' · each cell prints that session’s reading, tinted by its tier'}
      </div>

      {/* ⭐ THE DATED HEADER IS THE THING THE RIBBON CANNOT HAVE. It is a
          separate element from the body grid, on the SAME column template, so
          the body can flex under it while the dates stay a fixed strip. */}
      <div data-testid="timeline-dates"
           style={{ display: 'grid', gridTemplateColumns: template, gap: GAP,
                    flex: '0 0 auto', marginBottom: GAP }}>
        <div />
        {days.map((row, i) => (
          <div key={row.date ?? i}
               style={{ font: '700 9px \'Instrument Sans\', sans-serif', color: '#64748b',
                        letterSpacing: '.3px', textAlign: 'center', fontVariantNumeric: 'tabular-nums',
                        overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {dayLabel(row.date)}
          </div>
        ))}
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto',
                    display: 'flex', flexDirection: 'column' }}>
        {/* ⛔ THE CEILING IS DERIVED from the same two constants the bands lay
            out with — every band at its maximum plus the gaps between them.
            A literal here would drift the moment a band height moved. */}
        <div style={{ display: 'grid', gridTemplateColumns: template,
                      gridTemplateRows: `repeat(${metrics.length}, minmax(${ROW_MIN_H}px, 1fr))`,
                      gap: GAP, flex: '1 1 auto',
                      maxHeight: metrics.length * ROW_MAX_H + Math.max(0, metrics.length - 1) * GAP }}
             onClick={(e) => {
               const hit = cellOf(e)
               if (!hit || !reachable[hit.i]) return
               onSeek?.(days[hit.i].date)
             }}
             onMouseOver={(e) => {
               const hit = cellOf(e)
               if (!hit) { hide(); return }
               const m = byKey[hit.mkey]
               const row = days[hit.i]
               if (!m || !row) { hide(); return }
               show(e, `${hit.mkey}:${hit.i}`, row.date, [`${m.label} · ${m.getFmt(row)}`])
             }}
             onMouseLeave={hide}>
          {metrics.map(m => {
            const isSignal = m.key === signalKey
            const isNotable = m.key === notableKey
            const clickable = !!m.drillKey
            return (
              <Fragment key={m.key}>
                <div {...drillProps(m, onDrill)}
                     className={isNotable ? signalStyles.pulse : undefined}
                     style={{ font: '700 9px \'Instrument Sans\', sans-serif', textTransform: 'uppercase',
                              letterSpacing: '.3px', color: isSignal ? '#c9a84c' : '#94a3b8',
                              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                              textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap', paddingRight: 4,
                              cursor: clickable ? 'pointer' : 'default' }}>
                  {isSignal ? <><UIcon name="star-fill" size={9} style={{ verticalAlign: '-1px', marginRight: 3 }} /></> : ''}{m.label}
                </div>
                {days.map((row, i) => {
                  const bg = metricColor(m, row, colors.tier)
                  return (
                    <div key={row.date ?? i} data-testid={`timeline-cell-${m.key}-${i}`}
                         data-seek-idx={i} data-seek-date={row.date} data-mkey={m.key}
                         title={`${m.label} · ${row.date}: ${m.getFmt(row)}`}
                         style={{ borderRadius: 3, cursor: reachable[i] ? 'pointer' : 'default',
                                  background: bg, opacity: colors.fillOpacity,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  overflow: 'hidden', whiteSpace: 'nowrap',
                                  font: `800 ${fs}px 'Instrument Sans', sans-serif`,
                                  fontVariantNumeric: 'tabular-nums',
                                  // Derived from the fill, not chosen: the tier
                                  // range runs from pale mint to near-black.
                                  color: inkOn(bg) }}>
                      {m.getFmt(row)}
                    </div>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
      </div>
      <HoverReadout tipRef={tipRef} styleKey="timeline" />
    </div>
  )
}
