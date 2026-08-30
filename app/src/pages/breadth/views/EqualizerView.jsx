/**
 * Levels — a mixing board: one column per metric, column height = where that
 * reading sits on the shared 0–100 scale, colour = its tier.
 *
 * 🔴 IT WAS THE LOUDEST THING ON THE TAB AND THE HARDEST TO READ. Full-height
 * columns of saturated gradient, no axis to read a height against, and — the
 * defect underneath the loudness — the metric NAMES WERE NOT ON SCREEN AT ALL:
 * each column was `height: 100%` with the label appended after the bar, so the
 * label was pushed out of the panel and clipped. A board whose bars have no
 * scale and whose columns have no names is a colour field.
 *
 * ⭐ THREE CHANGES, IN THAT ORDER OF IMPORTANCE:
 *   · THE LABEL GUTTER IS RESERVED. The plot takes what is left after the names,
 *     never the other way round, so a name cannot be squeezed off the board.
 *   · THE AXIS IS DRAWN AND NUMBERED at `NORM_TICKS`, with 50 emphasised — the
 *     same marks the Rings gauge, the Meters track and the Radar rings carry.
 *   · THE FILL IS RESTRAINED. A tinted body with a bright CAP at the reading,
 *     instead of a solid saturated slab: the eye lands on the level, which is
 *     the number, rather than on the mass of paint beneath it.
 */
import {
  NORM_TICKS, drillProps, metricColor, normBasis, resolveViewColors, sortVisibleMetrics,
} from './breadthViewShared'
import signalStyles from './signals.module.css'
import UIcon from '../../../components/ui/UIcon'

// The axis gutter on the left, and the name gutter at the foot. Both reserved
// before the plot gets a pixel.
const AXIS_W = 30
const NAME_H = 30
const COL_MIN_W = 34

export default function EqualizerView({
  currentRow, rows = [], metrics, normalize, onDrill, signalKey, notableKey, options = {},
}) {
  if (!currentRow || !metrics?.length) return null
  const ordered = sortVisibleMetrics(metrics, options.sort ?? 'board', normalize, currentRow)
  const colors = resolveViewColors(options.palette, options.intensity)

  return (
    <div style={{ height: '100%', minHeight: 0, padding: '12px 18px 10px',
                  display: 'flex', flexDirection: 'column' }}>
      <div data-testid="equalizer-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8, flex: '0 0 auto' }}>
        {`Column height = ${normBasis(rows.length)} · the cap marks the reading`}
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', alignItems: 'stretch' }}>
        {/* The numbered axis. It owns its own gutter so a gridline label can
            never sit on top of a column. */}
        <div data-testid="equalizer-axis" aria-hidden="true"
             style={{ width: AXIS_W, flex: `0 0 ${AXIS_W}px`, position: 'relative',
                      marginBottom: NAME_H }}>
          {NORM_TICKS.map(t => (
            <span key={t}
                  style={{ position: 'absolute', right: 6, bottom: `${t}%`,
                           transform: 'translateY(50%)',
                           font: '700 8px \'Instrument Sans\', sans-serif',
                           color: t === 50 ? '#64748b' : '#475569',
                           fontVariantNumeric: 'tabular-nums' }}>{t}</span>
          ))}
        </div>

        <div style={{ flex: '1 1 auto', minWidth: 0, overflowX: 'auto', overflowY: 'hidden',
                      display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative',
                        display: 'flex', flexDirection: 'column' }}>
            {/* Gridlines span the whole plot, behind every column. */}
            <div aria-hidden="true"
                 style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: NAME_H,
                          pointerEvents: 'none' }}>
              {NORM_TICKS.map(t => (
                <div key={t}
                     style={{ position: 'absolute', left: 0, right: 0, bottom: `${t}%`, height: 1,
                              background: t === 50 ? 'rgba(226,232,240,0.16)'
                                : t === 0 ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.08)' }} />
              ))}
            </div>

            <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex',
                          alignItems: 'stretch', gap: 6 }}>
              {ordered.map(m => {
                const norm = normalize(m, currentRow)
                const h = norm == null ? 0 : Math.max(1.5, Math.min(100, norm))
                const color = metricColor(m, currentRow, colors.tier)
                const isSignal = m.key === signalKey
                const isNotable = m.key === notableKey
                const clickable = !!m.drillKey
                return (
                  <div key={m.key} {...drillProps(m, onDrill)}
                       style={{ flex: `1 1 ${COL_MIN_W}px`, minWidth: COL_MIN_W,
                                display: 'flex', flexDirection: 'column',
                                cursor: clickable ? 'pointer' : 'default' }}>
                    <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
                      <div data-testid={`equalizer-column-${m.key}`}
                           className={isNotable ? signalStyles.pulse : undefined}
                           style={{ position: 'absolute', left: 0, right: 0, bottom: 0,
                                    height: `${h}%`, borderRadius: '3px 3px 0 0',
                                    background: `${color}33`,
                                    borderTop: `2.5px solid ${color}`,
                                    opacity: colors.fillOpacity,
                                    boxShadow: isSignal
                                      ? '0 0 0 1px #c9a84c, 0 0 10px rgba(201,168,76,.35)'
                                      : (colors.glow ? `0 0 12px ${color}55` : 'none'),
                                    transition: 'height .4s ease' }} />
                      {/* The reading rides just above its own cap, and stops
                          short of the ceiling so a 100 never prints off-panel. */}
                      <div data-testid={`equalizer-value-${m.key}`}
                           style={{ position: 'absolute', left: 0, right: 0,
                                    bottom: `min(calc(${h}% + 4px), calc(100% - 13px))`,
                                    textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
                                    font: '800 10px \'Instrument Sans\', sans-serif',
                                    fontVariantNumeric: 'tabular-nums', color: '#dbe4ee' }}>
                        {m.getFmt(currentRow)}
                      </div>
                    </div>
                    <div style={{ flex: `0 0 ${NAME_H}px`, height: NAME_H, paddingTop: 6,
                                  font: '700 8px \'Instrument Sans\', sans-serif',
                                  color: isSignal ? '#c9a84c' : '#94a3b8', textAlign: 'center',
                                  textTransform: 'uppercase', letterSpacing: '.3px',
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isSignal ? <><UIcon name="star-fill" size={7} style={{ verticalAlign: '-1px', marginRight: 2 }} /></> : ''}{m.label}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
