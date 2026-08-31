/**
 * Vitals Rings — one gauge per metric: the arc is the reading's RANK on the
 * board-wide 0–100 scale, the number in the middle is the reading itself.
 *
 * 🔴 THE ARC WAS LYING BY OMISSION. Ten rings sat in a single row using ~110px
 * of a 726px panel, and "342" in a nearly-full ring next to "42" in a nearly
 * empty one reads as though 342 were a percentage of something. It never was:
 * the arc is `normalizeMetric` — a percentile against that metric's own history,
 * or its native % where it has one — and NOTHING on screen said so.
 *
 * ⭐ TWO FIXES, AND THEY ARE THE SAME FIX. The gauge now carries its own scale
 * (ticks at `NORM_TICKS`, and the rank printed under the value as `62/100`), and
 * the basis line states the sentence `normBasis` owns for every board that draws
 * this scale. A reader can now decode the arc without being told, and can tell
 * the two numbers apart because they are drawn as two different things.
 *
 * 🔴 AND THE GRID TAKES THE HEIGHT. The rings are laid out as a grid whose rows
 * share the offered space rather than as one centred row that declines it. The
 * gauge is an SVG on a viewBox, so it scales to whatever cell it lands in —
 * which is what makes a quarter-size compare pane a smaller board rather than a
 * clipped one.
 */
import {
  NORM_TICKS, drillProps, metricColor, normBasis, resolveViewColors,
} from './breadthViewShared'
import signalStyles from './signals.module.css'
import UIcon from '../../../components/ui/UIcon'

// The gauge's own coordinate space. Everything inside scales with the cell.
const CX = 50, CY = 50, R = 39

// A cell is a floor and a ceiling: it shrinks before the board scrolls, and
// stops growing so a two-metric board does not draw two dinner plates.
//
// ⭐ THE FLOOR IS DERIVED FROM THE SMALLEST BOX THIS BOARD IS ASKED TO FILL, not
// picked. A 1512-wide desktop's compare pane is 316px tall and gives the grid
// 271 of that once the basis line and the padding are taken; the default board
// is ten metrics, which `columnsFor` lays out in three rows, so the floor is
// `(271 − 2 gaps) / 3` rounded down. At 92 the three rows demanded 296 and the
// bottom row was cut by a scrollbar in every compare pane on the tab.
const CELL_MIN_H = 82
const CELL_MAX_H = 226
const GRID_GAP = 10

/**
 * Columns are derived from how many rings there are, aiming at roughly three
 * rows — the shape that actually fills a wide panel. Bounded at both ends so a
 * two-metric board is not one enormous column and a thirty-metric board does not
 * shrink to unreadable.
 *
 * ⛔ NO OVERSIZED HERO. The first visible metric used to draw at 140px against
 * everyone else's 84px and, once the rings were laid out as a grid, its
 * double-width cell was mostly empty box with a small ring centred in it. The
 * ★ already marks the metric worth looking at, in gold, on a board where
 * everything else is the same size — which is a stronger emphasis than being
 * bigger than a neighbour that is also large.
 */
const columnsFor = (n) => Math.max(2, Math.min(6, Math.ceil(n / 3)))

const valueFont = (text) => {
  const len = String(text ?? '').length
  return len <= 3 ? 22 : len <= 5 ? 17 : len <= 7 ? 13 : 11
}

function Ring({ metric, row, norm, onDrill, isSignal, isNotable, colors }) {
  const pct = norm == null ? 0 : Math.max(0, Math.min(100, norm))
  const c = 2 * Math.PI * R
  const offset = c * (1 - pct / 100)
  const color = metricColor(metric, row, colors.tier)
  const clickable = !!metric.drillKey
  const value = metric.getFmt(row)
  return (
    <div data-testid={`rings-gauge-${metric.key}`}
         className={isNotable ? signalStyles.pulse : undefined}
         style={{ minHeight: 0, minWidth: 0, borderRadius: 12, padding: '4px 4px 2px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  background: isSignal ? 'rgba(201,168,76,.05)' : 'transparent',
                  boxShadow: isSignal ? '0 0 0 1px rgba(201,168,76,.55)' : 'none' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"
           style={{ flex: '1 1 auto', minHeight: 0, width: '100%',
                    cursor: clickable ? 'pointer' : 'default' }}
           {...drillProps(metric, onDrill)}>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1b2534" strokeWidth="9" />
        {/* ⭐ THE TICKS ARE THE POINT. Without them the arc is a shape; with
            them it is a gauge, and `62/100` below the value says which gauge. */}
        {NORM_TICKS.map(t => {
          const ang = (-90 + t * 3.6) * Math.PI / 180
          const inner = R - 5.4, outer = R + 5.4
          return (
            <line key={t} x1={CX + inner * Math.cos(ang)} y1={CY + inner * Math.sin(ang)}
                  x2={CX + outer * Math.cos(ang)} y2={CY + outer * Math.sin(ang)}
                  stroke={t === 50 ? '#64748b' : '#334155'}
                  strokeWidth={t === 50 ? 1.1 : 0.7} />
          )
        })}
        <circle cx={CX} cy={CY} r={R} fill="none" stroke={color} strokeWidth="9"
                strokeLinecap="round" strokeDasharray={c.toFixed(2)}
                strokeDashoffset={offset.toFixed(2)}
                opacity={colors.fillOpacity}
                transform={`rotate(-90 ${CX} ${CY})`}
                style={{ filter: colors.dim ? 'none' : `drop-shadow(0 0 ${colors.glow ? 7 : 3}px ${color}66)`,
                         transition: 'stroke-dashoffset .4s ease' }} />
        <text x={CX} y={norm == null ? CY + 4 : CY - 1} textAnchor="middle" fill="#e8eef6"
              fontFamily="Instrument Sans, sans-serif" fontWeight="800"
              fontSize={valueFont(value)}>{value}</text>
        {norm != null && (
          <text data-testid={`rings-rank-${metric.key}`}
                x={CX} y={CY + 12} textAnchor="middle" fill="#64748b"
                fontFamily="Instrument Sans, sans-serif" fontWeight="700" fontSize="8">
            {`${Math.round(norm)}/100`}
          </text>
        )}
      </svg>
      <div style={{ font: '700 9px \'Instrument Sans\', sans-serif', letterSpacing: '.6px',
                    textTransform: 'uppercase', color: isSignal ? '#c9a84c' : '#94a3b8',
                    marginTop: 2, maxWidth: '100%', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '0 0 auto' }}>
        {isSignal ? <><UIcon name="star-fill" size={9} style={{ verticalAlign: '-1px', marginRight: 3 }} /></> : ''}{metric.label}
      </div>
    </div>
  )
}

export default function RingsView({
  currentRow, rows = [], metrics, normalize, onDrill, signalKey, notableKey, options = {},
}) {
  if (!currentRow || metrics.length === 0) return null
  const colors = resolveViewColors(options.palette, options.intensity)
  const cols = columnsFor(metrics.length)
  const gridRows = Math.ceil(metrics.length / cols)
  return (
    <div style={{ height: '100%', minHeight: 0, padding: '12px 18px',
                  display: 'flex', flexDirection: 'column' }}>
      <div data-testid="rings-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8, flex: '0 0 auto' }}>
        {`Arc = ${normBasis(rows.length)} · the number is today’s reading`}
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto',
                    display: 'flex', flexDirection: 'column' }}>
        {/* ⛔ THE CEILING IS DERIVED from the row count and the cell maximum,
            the same way the Heat Ribbon derives its strip's: rows share what is
            spare (`1fr`), stop growing at `CELL_MAX_H`, and never exceed the
            room — which is what stopped the last row's names being clipped off
            the foot of the panel.

            🔴 AND `minHeight: 0` IS THE WHOLE FIX, not the ceiling above it.
            Every gauge is an `<svg>` with a 1:1 viewBox, so its max-content
            height is its own WIDTH — at a full-width panel each 358px-wide cell
            wanted to be 358px tall. That reaches this box through
            `min-height: auto`, a flex item's automatic minimum, which is its
            MIN-CONTENT height: 1139px for three rows of it, clamped by the
            ceiling to 698, and a minimum is a floor, so the board sat 698px tall
            in the 641px it was given and the third row of rings was cut in half
            by a scrollbar (measured in Chromium at 1500×686). With the automatic
            minimum off, the grid takes the room offered, the ceiling binds only
            when that room is larger than three rows of rings need, and a
            two-metric board still does not draw two dinner plates.

            ⛔ THE BASIS IS `0` FOR THE SAME REASON `fillsRow` uses it: siblings
            that share space equally must not start from their own content. Both
            are longhands because jsdom's CSSOM drops the `flex` shorthand. */}
        <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0,
                      display: 'grid', gap: GRID_GAP,
                      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                      gridAutoRows: `minmax(${CELL_MIN_H}px, 1fr)`,
                      maxHeight: gridRows * CELL_MAX_H + Math.max(0, gridRows - 1) * GRID_GAP }}>
          {metrics.map(m => (
            <Ring key={m.key} metric={m} row={currentRow} norm={normalize(m, currentRow)}
                  onDrill={onDrill} isSignal={m.key === signalKey}
                  isNotable={m.key === notableKey} colors={colors} />
          ))}
        </div>
      </div>
    </div>
  )
}
