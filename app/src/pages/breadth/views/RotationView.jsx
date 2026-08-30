/**
 * Rotation Lens — equal-weight vs cap-weight, small vs large, and the VXN-VIX
 * spread. All three series already ride in every breadth row and appear
 * nowhere else on this tab.
 *
 * ⭐ THREE STACKED INSTRUMENT PANELS, EACH ONE A FULL-WIDTH TRACE.
 *
 * Side by side on a 1500px page the three sat in a third of the width each with
 * a 30px sparkline. The first correction stacked them — right — but kept the
 * reading in a 232px column BESIDE the trace and gave every panel a 132px
 * floor, so three panels needed 460px before they had drawn anything and the
 * lens grew a scrollbar to show three numbers. A lens that scrolls to show
 * three numbers is worse than one that was too small.
 *
 * 🔴 SO NOTHING HERE HAS A HEIGHT OF ITS OWN. The panel is a flex column of
 * three bands — header, trace, footer — where only the trace flexes. The header
 * and footer are two thin lines of type whose height is their own text; the
 * trace takes every pixel left over. Three panels therefore fit whatever height
 * the container offers, from a full page down to a quarter-size compare pane,
 * and the thing that grows with the room is the SHAPE, which is the only thing
 * on the panel that gets better with more of it.
 *
 * 🔴 AND THE TRACE IS A LINE ON A ROBUST DOMAIN, NOT A FILLED MOUNTAIN.
 *
 * Two separate defects wore one appearance. The domain was min…max, so a single
 * extreme session owned the whole height and crushed the rest of the window
 * flat — the trace read as a jagged spike over a dead line, and the panel looked
 * like mostly empty rectangle because it WAS mostly empty. And the fill was
 * anchored to the floor of the box, an axis position with no meaning for a
 * ratio, so every wiggle was rendered as a change in area against an arbitrary
 * baseline. `traceDomain` (in `rotation.js`) fixes the first; the fill is gone
 * for the second. What is left is a line, the dashed reference it is measured
 * from, and the two numbers that bound the axis.
 */
import { resolveViewColors } from './breadthViewShared'
// ⭐ The panel table MOVED to `rotation.js` (framework-free) — The Read quotes a
// panel's own `up`/`down` sentence, and a second copy of that copy is how the
// strip and the card beneath it would end up naming opposite directions. The
// `risingIsBull` ruling and the `measured` ruling both live there now, and so
// does the drawn domain.
import { ROTATION_PANELS as PANELS, rotationMeasured, traceDomain } from './rotation'
// Outer padding + inter-panel gap only — and the pane-scoped trim of both. The
// reason both live in a stylesheet instead of the inline style below is stated
// at the top of that file.
import styles from './RotationView.module.css'

const pointIndex = (e) => {
  const el = e.target?.closest?.('[data-seek-idx]')
  if (!el) return null
  const i = Number(el.getAttribute('data-seek-idx'))
  return Number.isInteger(i) ? i : null
}

// The plot's own box. Height is a viewBox unit, not pixels — the svg stretches
// to whatever the trace band gives it — but the top/bottom insets keep the trace
// off its own edges so a series pinned at the top of its domain is still
// visible, and so a clipped run reads as "against the ceiling" rather than as
// part of the border.
const H = 40
const TOP = 3
const BOT = H - 3

/**
 * A panel's PREFERRED size — three of these plus the basis line is ~230px,
 * inside what a quarter-size compare pane offers and far inside a full-height
 * single view. All three share equally, so with equal bases the panels come out
 * the same height at any container size.
 *
 * 🔴 IT IS A `flex-basis`, NOT A `min-height`, AND THE DIFFERENCE IS A BUG.
 * As an explicit px floor it sat BELOW the panel's own content whenever the
 * verdict line wrapped — at 358px wide (a phone's compare pane) the footer
 * takes two lines and the panel needs ~88px. The panel was pinned at 66, the
 * content did not fit, and `overflow: visible` painted the overflow straight
 * over the header of the panel beneath it. With no explicit minimum the flex
 * item's automatic one is its CONTENT, so a squeezed lens scrolls — which is
 * what the root's `overflow: auto` is for — instead of overlapping itself.
 */
const PANEL_BASIS_H = 66
// Enough for the two domain bounds at 9px with a sign, and no more: it is a
// scale, not a column.
const AXIS_W = 46

// Every number this lens prints, printed the same way. It formats RATIOS (and a
// volatility spread), which is this file's own reading — the shared registry
// `getFmt` formats a metric ROW and none of these three is a registry metric —
// so one local authority is the right number of authorities.
const fmt = (v) => Number(v).toFixed(3)

export default function RotationView({
  rows = [], rowIdx = 0, onSeek, canSeek, options = {},
}) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const lookback = Number(options.lookback ?? 20)
  // `win`, not `window`: a local named `window` shadows the global for the
  // whole function body.
  const win = rows.slice(rowIdx)
  if (!win.length) return null

  // The traces below plot oldest → newest; this is the session each drawn
  // x-position belongs to, computed ONCE rather than per panel.
  const ascRows = [...win].reverse()
  const lastX = Math.max(1, ascRows.length - 1)
  const colW = 100 / Math.max(1, ascRows.length - 1)
  const reachable = ascRows.map(r => (canSeek ? !!canSeek(r.date) : false))

  // THE SPAN MEASURED IS THE SPAN PRINTED — the rule, and its reason, live in
  // `rotation.js` beside the table this lens draws from.
  const measured = rotationMeasured(lookback, win.length)

  return (
    <div className={styles.root}
         style={{ height: '100%', minHeight: 0, overflow: 'auto',
                  display: 'flex', flexDirection: 'column' }}>
      <div data-testid="rotation-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', flex: '0 0 auto' }}>
        {win.length} session{win.length === 1 ? '' : 's'} · since {win[win.length - 1].date}
        {measured < lookback
          ? ` · shorter than the ${lookback}-day setting, so changes are measured over ${measured}`
          : ` · changes measured over ${measured} sessions`}
      </div>

      {PANELS.map(p => {
        const series = win.map(p.read)
        const vals = series.filter(v => v != null && !isNaN(Number(v))).map(Number)
        const now = series[0]
        const prior = measured > 0 ? series[measured] : null
        const usable = now != null && prior != null && vals.length >= 2

        const delta = usable ? Number(now) - Number(prior) : null
        // A ratio's own direction is the whole signal; `up`/`down` name what
        // that direction means for THIS pair rather than a generic bull/bear.
        const verdict = !usable
          ? `${p.sub} not reported over this window`
          : (delta >= 0 ? p.up : p.down)
        // …and the colour reads the SAME declaration the sentence does.
        const rising = usable && delta >= 0
        const deltaColor = rising === p.risingIsBull ? colors.bull : colors.bear

        // The axis. Pinned to the two numbers the panel prints so the headline
        // is never off its own scale — see `traceDomain`.
        const { lo, hi, clipped, min, max } = traceDomain(vals, [now, prior])
        const span = hi - lo
        const asc = [...series].reverse()
        const X = (i) => (i / lastX) * 100
        // Clamped, deliberately: a reading past the fence is drawn AT the edge
        // and counted in `clipped`, rather than being allowed to reset the scale
        // for the other eighty-nine sessions.
        const Y = (v) => {
          const t = (Number(v) - lo) / span
          return BOT - Math.min(1, Math.max(0, t)) * (BOT - TOP)
        }
        const drawn = asc.map((v, i) => (v == null ? null : { i, v: Number(v) })).filter(Boolean)
        const pts = drawn.map(d => `${X(d.i).toFixed(2)},${Y(d.v).toFixed(2)}`).join(' ')
        // Where the reference reading sits, on both axes.
        const refY = usable ? Y(prior) : null
        const refX = usable ? X(lastX - measured) : null
        const head = drawn.length ? drawn[drawn.length - 1] : null

        return (
          <div key={p.key} data-testid={`rotation-panel-${p.key}`} className={styles.panel}
               style={{ background: '#0e131a', borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.05)',
                        // Longhands, never the `flex` shorthand: jsdom's CSSOM
                        // drops the shorthand silently, so the rail that pins
                        // this would pass on a panel declaring nothing at all.
                        flexGrow: 1, flexShrink: 1, flexBasis: PANEL_BASIS_H,
                        minWidth: 0,
                        display: 'flex', flexDirection: 'column' }}>

            {/* Header — what this is, on the left; what it reads, on the right.
                One line, so it costs the trace nothing it does not have to. */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: '0 0 auto',
                          minWidth: 0 }}>
              <span style={{ font: '700 10px \'Instrument Sans\', sans-serif', letterSpacing: '.5px',
                             textTransform: 'uppercase', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                {p.label}
              </span>
              <span style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#475569',
                             whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.sub}
              </span>
              <span data-testid={`rotation-value-${p.key}`}
                    style={{ font: '800 22px \'Instrument Sans\', sans-serif', color: '#e8e8ea',
                             letterSpacing: '-0.4px', lineHeight: 1, marginLeft: 'auto',
                             fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {usable ? fmt(now) : '—'}
              </span>
              {usable && (
                <span data-testid={`rotation-delta-${p.key}`}
                      style={{ font: '700 11px \'Instrument Sans\', sans-serif', color: deltaColor,
                               fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {delta >= 0 ? '+' : ''}{fmt(delta)} / {measured}d
                </span>
              )}
            </div>

            {/* The trace band — the ONLY thing on the panel that flexes. */}
            <div style={{ flex: '1 1 auto', minHeight: 18, display: 'flex', alignItems: 'stretch',
                          gap: 6, margin: '3px 0 2px', minWidth: 0 }}>
              {/* The trace's own scale, and after `traceDomain` these are the
                  DRAWN bounds rather than the window's extremes — the two
                  differ exactly when a session sits outside the fence, and the
                  footer says so when they do. Without them the shape is
                  unreadable in absolute terms, which is the complaint a
                  sparkline usually earns. */}
              {vals.length > 0 && (
                <div data-testid={`rotation-range-${p.key}`}
                     style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                              font: '600 9px \'Instrument Sans\', sans-serif', color: '#475569',
                              textAlign: 'right', flex: `0 0 ${AXIS_W}px`, width: AXIS_W,
                              fontVariantNumeric: 'tabular-nums' }}>
                  <span>{fmt(hi)}</span>
                  <span>{fmt(lo)}</span>
                </div>
              )}
              {/* 🔴 THE PLOT IS OUT OF FLOW, AND THAT IS A SIZING FIX, NOT A
                  LAYOUT ONE. An `<svg>` with a viewBox has an INTRINSIC ASPECT
                  RATIO, so its min-content height is a function of its width:
                  at page width each panel's automatic minimum became ~520px and
                  the lens demanded seventeen hundred pixels it never drew.
                  Absolutely positioned inside a relative wrapper it contributes
                  nothing to that calculation, so the panel's own minimum is what
                  its TEXT needs — which is the number that has to be right, since
                  it is what stops a wrapped verdict line from spilling over the
                  panel beneath it. */}
              <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <svg width="100%" height="100%" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none"
                   style={{ position: 'absolute', inset: 0, display: 'block' }}
                   aria-hidden="true"
                   onClick={(e) => {
                     const i = pointIndex(e)
                     if (i == null || !reachable[i]) return
                     onSeek?.(ascRows[i].date)
                   }}>
                {pts ? (
                  <>
                    {refY != null && (
                      <>
                        <line data-testid={`rotation-baseline-${p.key}`}
                              x1="0" y1={refY} x2="100" y2={refY} stroke="#475569" strokeWidth="0.8"
                              strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                        <line x1={refX} y1={TOP} x2={refX} y2={BOT} stroke="#334155" strokeWidth="0.8"
                              strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
                      </>
                    )}
                    <polyline data-testid={`rotation-spark-${p.key}`} points={pts} fill="none"
                              strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
                              vectorEffect="non-scaling-stroke" opacity={colors.fillOpacity}
                              stroke={deltaColor} />
                    {/* The head, as a round-capped hairline rather than a
                        `<circle>`: the box is stretched non-uniformly, so a
                        circle drawn in viewBox units renders as a flat ellipse
                        at page width. A non-scaling stroke is round in device
                        pixels whatever the box does. */}
                    {head && (
                      <line x1={X(head.i)} y1={Y(head.v)} x2={X(head.i)} y2={Y(head.v) + 0.01}
                            stroke={deltaColor} strokeWidth="3.4" strokeLinecap="round"
                            vectorEffect="non-scaling-stroke" opacity={colors.fillOpacity} />
                    )}
                  </>
                ) : (
                  <line x1="0" y1={H / 2} x2="100" y2={H / 2} stroke="#334155" strokeDasharray="2 2" />
                )}
                {pts && asc.map((v, i) => (v == null ? null : (
                  <rect key={ascRows[i]?.date ?? i} data-testid={`rotation-point-${p.key}-${i}`}
                        data-seek-idx={i} data-seek-date={ascRows[i]?.date}
                        x={Math.max(0, X(i) - colW / 2)}
                        y="0" width={colW} height={H} fill="transparent"
                        style={{ cursor: reachable[i] ? 'pointer' : 'default' }}>
                    <title>{`${ascRows[i]?.date} · ${p.sub} ${fmt(v)}`}</title>
                  </rect>
                )))}
              </svg>
              </div>
            </div>

            {/* Footer — the sentence this panel's direction means, and the
                reading the delta above was taken from. Wraps rather than
                truncates: the verdict is the panel's one claim in words. */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flex: '0 0 auto',
                          flexWrap: 'wrap', minWidth: 0 }}>
              <span data-testid={`rotation-verdict-${p.key}`}
                    style={{ font: '600 11px \'Instrument Sans\', sans-serif', color: '#94a3b8',
                             flex: '1 1 auto', minWidth: 0, lineHeight: 1.35 }}>
                {verdict}
              </span>
              {/* ⛔ A TRIMMED AXIS HAS TO SAY SO. Without this line a run held
                  against the ceiling reads as a plateau, and the two bounds
                  beside the trace would be quietly narrower than the window
                  they claim to scale. Every session keeps its true value in its
                  own tooltip either way. */}
              {clipped > 0 && (
                <span data-testid={`rotation-clip-${p.key}`}
                      style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#64748b',
                               whiteSpace: 'nowrap' }}>
                  {clipped} session{clipped === 1 ? '' : 's'} outside the drawn range
                  {' · full span '}{fmt(min)}–{fmt(max)}
                </span>
              )}
              {usable && (
                <span data-testid={`rotation-reference-${p.key}`}
                      style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#475569',
                               whiteSpace: 'nowrap' }}>
                  measured from {fmt(prior)} on {win[measured].date}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
