/**
 * Tactical Readout — every metric as a marker on ONE shared oversold→overbought
 * track, so a dozen instruments with a dozen units can be read against each
 * other at a glance.
 *
 * 🔴 IT HAD THE LEAST WRONG WITH IT AND THE LEAST PRESENCE: thin 10px rails in
 * the top 300px of a 726px panel, no numbers on the scale, and one reading per
 * row with nothing to compare it to. Three changes, each of which adds a fact
 * rather than a decoration:
 *
 *   · THE TRACK IS NUMBERED. Ticks and labels at `NORM_TICKS`, the same marks
 *     the Rings gauge and the Levels axis carry, so "58" on the right-hand
 *     column and the marker's position are visibly the same claim.
 *   · A GHOST MARKER SHOWS WHERE THE METRIC WAS. `prevRow` is the session the
 *     container already hands every board (~3 back — it is what Signal of the
 *     Day is measured against), so the row now answers "and which way is it
 *     moving?" without a second data source.
 *   · THE ROWS FLEX (`fillsRow`) and the rail thickens with them.
 *
 * ⛔ THE TRACK NO LONGER PAINTS ITS OWN GREEN AND RED. It was a hardcoded
 * `linear-gradient(90deg,#14532d,#3f6212,#713f12,#7f1d1d)` — so under `mono`, a
 * palette with neither colour in it, the most colour-dependent element on the
 * board went on rendering a green-to-red ramp. The rail is neutral now and the
 * two end ZONES are tinted from `colors.tier`, which every palette owns.
 */
import {
  NORM_TICKS, drillProps, fillsRow, metricColor, normBasis, resolveViewColors, sortVisibleMetrics,
} from './breadthViewShared'
import signalStyles from './signals.module.css'
import UIcon from '../../../components/ui/UIcon'

const TEMPLATE = '106px 1fr 64px'
const ROW_MIN_H = 20
const ROW_MAX_H = 56
// Where "oversold" stops and "overbought" starts on the shared scale. The two
// numbers the zone tints and the reference ticks are BOTH drawn from.
const ZONE_LOW = 30
const ZONE_HIGH = 70

export default function MetersView({
  currentRow, prevRow, rows = [], metrics, normalize, onDrill, signalKey, notableKey, options = {},
}) {
  if (!currentRow || metrics.length === 0) return null
  const ordered = sortVisibleMetrics(metrics, options.sort ?? 'group', normalize, currentRow)
  const colors = resolveViewColors(options.palette, options.intensity)
  const hasPrev = !!prevRow

  return (
    <div style={{ height: '100%', minHeight: 0, padding: '12px 18px',
                  display: 'flex', flexDirection: 'column' }}>
      <div data-testid="meters-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8, flex: '0 0 auto' }}>
        {`Marker = ${normBasis(rows.length)}`}
        {hasPrev ? ' · the faint mark is where it sat three sessions back' : ''}
      </div>

      {/* The numbered scale, drawn once for every row beneath it. */}
      <div data-testid="meters-scale" aria-hidden="true"
           style={{ display: 'grid', gridTemplateColumns: TEMPLATE, gap: 10,
                    flex: '0 0 auto', marginBottom: 4 }}>
        <div style={{ font: '700 8px \'Instrument Sans\', sans-serif', color: '#475569',
                      letterSpacing: '.5px', textAlign: 'right' }}>OVERSOLD</div>
        <div style={{ position: 'relative', height: 11 }}>
          {NORM_TICKS.map(t => (
            <span key={t}
                  style={{ position: 'absolute', left: `${t}%`,
                           transform: t === 0 ? 'none' : t === 100 ? 'translateX(-100%)' : 'translateX(-50%)',
                           font: '700 8px \'Instrument Sans\', sans-serif', color: '#475569',
                           fontVariantNumeric: 'tabular-nums' }}>{t}</span>
          ))}
        </div>
        <div style={{ font: '700 8px \'Instrument Sans\', sans-serif', color: '#475569',
                      letterSpacing: '.5px' }}>OVERBOUGHT</div>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto',
                    display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ordered.map(m => {
          const norm = normalize(m, currentRow)
          const was = hasPrev ? normalize(m, prevRow) : null
          const color = metricColor(m, currentRow, colors.tier)
          const clickable = !!m.drillKey
          const isSignal = m.key === signalKey
          const isNotable = m.key === notableKey
          return (
            <div key={m.key}
                 {...drillProps(m, onDrill)}
                 style={{ display: 'grid', gridTemplateColumns: TEMPLATE,
                          alignItems: 'center', gap: 10, cursor: clickable ? 'pointer' : 'default',
                          ...fillsRow(ROW_MIN_H, ROW_MAX_H) }}>
              <span style={{ font: '700 9px \'Instrument Sans\', sans-serif', letterSpacing: '.5px',
                             textTransform: 'uppercase', color: isSignal ? '#c9a84c' : '#94a3b8',
                             textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis',
                             whiteSpace: 'nowrap' }}>
                {isSignal ? <><UIcon name="star-fill" size={9} style={{ verticalAlign: '-1px', marginRight: 3 }} /></> : ''}{m.label}
              </span>
              <div style={{ height: 14, borderRadius: 7, position: 'relative',
                            background: 'rgba(148,163,184,0.10)',
                            boxShadow: 'inset 0 0 0 1px rgba(148,163,184,0.12)' }}>
                {/* Zone tints, from the palette's own extremes — the semantic
                    the old hardcoded ramp carried, said in the palette's words. */}
                <div aria-hidden="true"
                     style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${ZONE_LOW}%`,
                              borderRadius: '7px 0 0 7px', background: colors.tier.g3, opacity: 0.09 }} />
                <div aria-hidden="true"
                     style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${100 - ZONE_HIGH}%`,
                              borderRadius: '0 7px 7px 0', background: colors.tier.r3, opacity: 0.11 }} />
                {[ZONE_LOW, 50, ZONE_HIGH].map(t => (
                  <div key={t} aria-hidden="true"
                       style={{ position: 'absolute', top: 2, bottom: 2, left: `${t}%`, width: 1,
                                background: t === 50 ? 'rgba(226,232,240,0.24)' : 'rgba(148,163,184,0.18)' }} />
                ))}
                {/* ⛔ A THIN BAR, NOT A HOLLOW BOX. The ghost was drawn as a
                    rounded outline and at this size it read as the character
                    "0" sitting on the rail — a mark that looks like a value is
                    worse than no mark. It is the live marker's shape, quieter
                    and shorter, so the pair reads as "was here, is here". */}
                {was != null && norm != null && Math.abs(was - norm) >= 1 && (
                  <div data-testid={`meters-ghost-${m.key}`}
                       title={`three sessions back · ${Math.round(was)}/100`}
                       style={{ position: 'absolute', top: 2, left: `${was}%`, width: 3, height: 9,
                                borderRadius: 1, transform: 'translateX(-1.5px)',
                                background: color, opacity: 0.5 }} />
                )}
                {norm != null && (
                  <div data-testid={`meters-marker-${m.key}`}
                       className={isNotable ? signalStyles.pulse : undefined}
                       style={{ position: 'absolute', top: -2, left: `${norm}%`, width: 5, height: 18,
                                borderRadius: 2.5, background: color, transform: 'translateX(-2.5px)',
                                opacity: colors.fillOpacity,
                                boxShadow: colors.dim ? 'none' : `0 0 ${colors.glow ? 14 : 7}px ${color}`,
                                transition: 'left .4s ease' }} />
                )}
              </div>
              <span style={{ font: '800 14px \'Instrument Sans\', sans-serif', color: '#e8eef6',
                             fontVariantNumeric: 'tabular-nums', overflow: 'hidden',
                             whiteSpace: 'nowrap' }}>
                {m.getFmt(currentRow)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
