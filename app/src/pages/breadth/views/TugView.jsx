/**
 * Bull/Bear Tug — paired metrics pull against each other around a centre spine.
 *
 * 🔴 THE READER SAW NUMBERS AND LENGTHS DISAGREEING, AND THEY WERE BOTH RIGHT.
 * A bar's length is the pair's SHARE (`up / (up + dn)`), not its count — so
 * "9 vs 7" drew two nearly-equal bars while "342 vs 42" drew one long and one
 * short, and nothing on screen said the two rows were measured differently from
 * each other. Worse, every bar carried `minWidth: 28`, which quietly LIED about
 * small shares to make room for the number printed inside it.
 *
 * ⭐ SO THE ENCODING STATES ITSELF, THREE WAYS, AND THE NUMBER MOVED OUT OF THE
 * BAR:
 *   · each side gets a FULL-LENGTH TRACK with ticks at 25/50/75, so an empty
 *     track is visible and "this bar is 11% of its side" is readable off the
 *     marks rather than inferred;
 *   · the count sits in its own column at the outer edge, so a bar is now pure
 *     share with no minimum width distorting it;
 *   · the centre column prints the split (`11% · 89%`) under the pair's name.
 *
 * 🔴 AND IT TAKES THE HEIGHT. It floated at the top of the panel over ~350px of
 * dead black because every row was a fixed 20px; rows flex now (`fillsRow`), and
 * the centre labels are legible instead of 8px.
 *
 * ⛔ NET POSTURE READS THE PALETTE. It was hardcoded `#34d399` / `#f87171` —
 * classic's bull and bear, verbatim — so the one summary figure on the board
 * rendered the same green in `mono`, a palette with no green in it.
 */
import {
  drillProps, fillsRow, metricValue, netPosture, resolveViewColors,
} from './breadthViewShared'
import signalStyles from './signals.module.css'

// The row's five columns: count · bear track · name · bull track · count.
const END_W = 54
const MID_W = 132
const TEMPLATE = `${END_W}px 1fr ${MID_W}px 1fr ${END_W}px`
const ROW_MIN_H = 24
const ROW_MAX_H = 74

/**
 * ⛔ NOT `NORM_TICKS`. Those mark the board-wide RANK scale five other views
 * draw against; these mark a pair's SHARE of its own total. Same numbers, two
 * different quantities — deriving one from the other would tie a change in the
 * rank scale to a change in what a tug bar means.
 */
const SHARE_TICKS = [25, 50, 75]

// The rail every bar is drawn against, so an empty half is visible as empty.
const trackBase = {
  position: 'absolute', inset: 0, borderRadius: 4,
  background: 'rgba(148,163,184,0.07)',
  boxShadow: 'inset 0 0 0 1px rgba(148,163,184,0.10)',
}

function Track({ metric, barKey, share, side, color, onDrill, dim, pulse }) {
  // `side: 'bear'` grows leftward from the spine on the right edge; `'bull'`
  // grows rightward from the spine on the left edge.
  const anchor = side === 'bear' ? { right: 0 } : { left: 0 }
  return (
    <div {...drillProps(metric, onDrill)}
         style={{ position: 'relative', height: '100%', minWidth: 0,
                  cursor: metric?.drillKey ? 'pointer' : 'default' }}>
      <div style={trackBase} />
      {SHARE_TICKS.map(t => (
        <div key={t} aria-hidden="true"
             style={{ position: 'absolute', top: 3, bottom: 3, width: 1,
                      ...(side === 'bear' ? { right: `${t}%` } : { left: `${t}%` }),
                      background: t === 50 ? 'rgba(226,232,240,0.20)' : 'rgba(148,163,184,0.13)' }} />
      ))}
      {/* ⛔ NO `minWidth`. The old bar had one, which meant a 3% share drew as
          though it were ~12% so the number printed inside it would fit — the bar
          lied to make room for text that has its own column now. */}
      <div data-testid={`tug-bar-${barKey}`}
           className={pulse ? signalStyles.pulse : undefined}
           style={{ position: 'absolute', top: 7, bottom: 7, ...anchor,
                    width: `${Math.max(0, Math.min(100, share))}%`,
                    background: color, opacity: dim ? 0.62 : 0.88,
                    borderRadius: side === 'bear' ? '4px 2px 2px 4px' : '2px 4px 4px 2px',
                    transition: 'width .4s ease' }} />
    </div>
  )
}

const Count = ({ text, align, color }) => (
  <div style={{ font: '800 12px \'Instrument Sans\', sans-serif', color,
                textAlign: align, fontVariantNumeric: 'tabular-nums',
                overflow: 'hidden', whiteSpace: 'nowrap',
                paddingRight: align === 'right' ? 8 : 0,
                paddingLeft: align === 'left' ? 8 : 0 }}>
    {text}
  </div>
)

function CentreLabel({ label, sub, gold }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ font: '700 10px \'Instrument Sans\', sans-serif', letterSpacing: '.5px',
                    color: gold ? '#c9a84c' : '#cbd5e1', textTransform: 'uppercase',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </div>
      {sub != null && (
        <div style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#64748b',
                      fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export default function TugView({ currentRow, metrics, normalize, onDrill, signalKey, notableKey, options = {} }) {
  if (!currentRow || metrics.length === 0) return null
  const ups = metrics.filter(m => m.pair && m.pair.side === 'up')
  const unpaired = metrics.filter(m => !m.pair)
  const posture = netPosture(metrics, currentRow)
  const colors = resolveViewColors(options.palette, options.intensity)
  const dim = colors.dim

  const prefixFor = (...keys) => {
    if (keys.includes(signalKey)) return '★ '
    if (keys.includes(notableKey)) return '◆ '
    return ''
  }

  return (
    <div style={{ height: '100%', minHeight: 0, padding: '12px 18px',
                  display: 'flex', flexDirection: 'column' }}>
      <div data-testid="tug-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 6, flex: '0 0 auto' }}>
        Bar length = that side’s share of its pair (ticks at 25 · 50 · 75%) · the number is today’s count
      </div>

      {/* The share axis, drawn once above the rows it measures. */}
      <div data-testid="tug-scale" aria-hidden="true"
           style={{ display: 'grid', gridTemplateColumns: TEMPLATE, gap: 8,
                    flex: '0 0 auto', marginBottom: 6,
                    font: '700 8px \'Instrument Sans\', sans-serif', color: '#475569',
                    letterSpacing: '.4px' }}>
        <div />
        <div style={{ position: 'relative', height: 10 }}>
          <span style={{ position: 'absolute', left: 0 }}>100%</span>
          <span style={{ position: 'absolute', right: '50%', transform: 'translateX(50%)' }}>50</span>
          <span style={{ position: 'absolute', right: 0 }}>0</span>
        </div>
        <div style={{ textAlign: 'center', color: '#64748b' }}>SHARE OF PAIR</div>
        <div style={{ position: 'relative', height: 10 }}>
          <span style={{ position: 'absolute', left: 0 }}>0</span>
          <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>50</span>
          <span style={{ position: 'absolute', right: 0 }}>100%</span>
        </div>
        <div />
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto',
                    display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ups.map(up => {
          const down = metrics.find(m => m.key === up.pair.partnerKey)
          const u = metricValue(up, currentRow) ?? 0
          const d = down ? (metricValue(down, currentRow) ?? 0) : 0
          const total = u + d || 1
          const uShare = u / total * 100
          const dShare = d / total * 100
          const label = up.label.replace(/^Up\s*/i, '').replace(/^Dn\s*/i, '')
          const prefix = prefixFor(up.key, down?.key)
          return (
            <div key={up.key} data-testid={`tug-pair-${up.key}`}
                 style={{ display: 'grid', gridTemplateColumns: TEMPLATE, gap: 8,
                          alignItems: 'stretch', ...fillsRow(ROW_MIN_H, ROW_MAX_H) }}>
              <Count text={down ? down.getFmt(currentRow) : '—'} align="right" color={colors.bear} />
              <Track metric={down} barKey={down?.key ?? up.pair.partnerKey} share={dShare} side="bear" color={colors.bear}
                     onDrill={onDrill} dim={dim}
                     pulse={!!down && down.key === notableKey} />
              <CentreLabel label={`${prefix}${label}`} gold={prefix === '★ '}
                           sub={`${Math.round(dShare)}% · ${Math.round(uShare)}%`} />
              <Track metric={up} barKey={up.key} share={uShare} side="bull" color={colors.bull}
                     onDrill={onDrill} dim={dim} pulse={up.key === notableKey} />
              <Count text={up.getFmt(currentRow)} align="left" color={colors.bull} />
            </div>
          )
        })}

        {/* An unpaired metric has no opponent, so it leans off the spine by its
            distance from neutral on the shared rank scale — the same quantity
            Meters and Rings draw, on this board's own geometry. */}
        {unpaired.map(m => {
          const n = normalize ? (normalize(m, currentRow) ?? 50) : 50
          const effBull = m.polarity === 'bear' ? (50 - n) : (n - 50)
          const isBull = effBull >= 0
          const mag = Math.min(100, Math.abs(effBull) / 50 * 100)
          const color = isBull ? colors.bull : colors.bear
          const prefix = prefixFor(m.key)
          return (
            <div key={m.key} data-testid={`tug-single-${m.key}`}
                 style={{ display: 'grid', gridTemplateColumns: TEMPLATE, gap: 8,
                          alignItems: 'stretch', ...fillsRow(ROW_MIN_H, ROW_MAX_H) }}>
              <Count text={isBull ? '' : m.getFmt(currentRow)} align="right" color={colors.bear} />
              {isBull
                ? <div />
                : <Track metric={m} barKey={m.key} share={mag} side="bear" color={color} onDrill={onDrill}
                         dim={dim} pulse={m.key === notableKey} />}
              <CentreLabel label={`${prefix}${m.label}`} gold={prefix === '★ '}
                           sub={`${Math.round(n)}/100`} />
              {isBull
                ? <Track metric={m} barKey={m.key} share={mag} side="bull" color={color} onDrill={onDrill}
                         dim={dim} pulse={m.key === notableKey} />
                : <div />}
              <Count text={isBull ? m.getFmt(currentRow) : ''} align="left" color={colors.bull} />
            </div>
          )
        })}
      </div>

      {/* ⭐ THE SUMMARY GETS THE SAME TREATMENT AS THE ROWS ABOVE IT: a signed
          bar off a marked centre, so "+64%" is a position on a scale rather
          than a coloured sentence. */}
      {posture != null && (
        <div data-testid="tug-posture"
             style={{ flex: '0 0 auto', marginTop: 10, display: 'flex',
                      alignItems: 'center', gap: 10 }}>
          <div style={{ font: '700 8px \'Instrument Sans\', sans-serif', color: '#64748b',
                        letterSpacing: '.6px', flex: '0 0 auto' }}>NET POSTURE</div>
          <div style={{ position: 'relative', height: 14, flex: '1 1 auto', minWidth: 0 }}>
            <div style={trackBase} />
            <div aria-hidden="true"
                 style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1,
                          background: 'rgba(226,232,240,0.28)' }} />
            <div style={{ position: 'absolute', top: 3, bottom: 3,
                          ...(posture >= 0 ? { left: '50%' } : { right: '50%' }),
                          width: `${Math.min(50, Math.abs(posture) / 2)}%`,
                          background: posture >= 0 ? colors.bull : colors.bear,
                          opacity: dim ? 0.62 : 0.92, borderRadius: 3 }} />
          </div>
          <div style={{ font: '800 12px \'Instrument Sans\', sans-serif',
                        color: posture >= 0 ? colors.bull : colors.bear,
                        whiteSpace: 'nowrap', flex: '0 0 auto' }}>
            {`${posture >= 0 ? '+' : ''}${posture}% ${posture >= 0 ? 'BULLISH' : 'BEARISH'}`}
          </div>
        </div>
      )}
    </div>
  )
}
