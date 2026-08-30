/**
 * Scoreboard — a card per metric: the current reading, big, over a sparkline of
 * the recent window (coloured by whether the move was bullish).
 *
 * 🔴 A WHOLE FAMILY OF ITS CARDS WAS PERMANENTLY BLANK. Advancing, Declining,
 * Up/Down From Open, Up/Down On Volume, the CBOE put/call and a quiet FTD all
 * render an em dash because the collector does not populate them — and they were
 * drawn at exactly the weight of a card carrying a number, competing for the
 * reader's eye with the ones that had something to say. A permanently blank card
 * is not a gap in the data; on screen it is noise.
 *
 * ⭐ THEY ARE GROUPED AND DE-EMPHASISED, NOT DELETED. Advancing and Declining
 * are being backfilled by separate work, and an FTD card is blank only until an
 * FTD fires inside the window — so "silent" is asked PER RENDER, off the same
 * `getFmt` the card would have printed, and a metric that gains a reading walks
 * straight back into the main grid. Nothing here holds a list of names.
 *
 * 🔴 AND THE CARDS TAKE THE HEIGHT. The grid left ~250px of a 726px panel black
 * while every sparkline was 16px tall; the rows share the offered space now and
 * the sparkline is what grows into it, because the sparkline is the only part of
 * a card that gets more readable with more room.
 */
import {
  drillProps, metricValue, sortVisibleMetrics, resolveViewColors,
} from './breadthViewShared'
import useHoverReadout from './useHoverReadout'
import HoverReadout from './HoverReadout'
import signalStyles from './signals.module.css'
import UIcon from '../../../components/ui/UIcon'

/**
 * Points carry the index of the SESSION they came from, not just their position
 * in the drawn line. A metric with gaps plots fewer points than the window has
 * sessions, so `k` (the k-th drawn point) and `i` (the k-th session) diverge —
 * and `i` is the one a click has to seek to.
 */
// ⛔ `bull` / `bear` HAVE NO DEFAULTS. They used to fall back to `#34d399` /
// `#f87171` — classic's two colours, verbatim — so a caller that lost its
// `colors` would paint a green line under `mono`, a palette with no green in it,
// and nothing would go red. The one caller resolves them from the palette; a
// missing argument should draw nothing rather than draw the wrong thing.
function buildSpark(entries, polarity, bull, bear) {
  const pts = entries.filter(e => e.v != null)
  if (pts.length < 2) return null
  const vals = pts.map(e => e.v)
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const marks = pts.map((e, k) => ({
    i: e.i,
    x: (k / (pts.length - 1)) * 60,
    y: 15 - ((e.v - min) / range) * 13,
  }))
  // Color by *bullish* direction: for bearish metrics (e.g. VIX, 52w lows) a
  // rising raw value is bearish, so invert.
  const rising = vals[vals.length - 1] >= vals[0]
  const bullish = polarity === 'bear' ? !rising : rising
  return {
    marks,
    pts: marks.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    color: bullish ? bull : bear,
  }
}

const markIndex = (e) => {
  const el = e.target?.closest?.('[data-seek-idx]')
  if (!el) return null
  const i = Number(el.getAttribute('data-seek-idx'))
  return Number.isInteger(i) ? i : null
}

/**
 * ⛔ "SILENT" IS ASKED OF `getFmt`, NOT OF A LIST OF KEYS.
 *
 * `getFmt` is exactly what the card would print, so a card is silent when the
 * card has nothing to print — today and anywhere in the window it draws. A typed
 * roster of "the fields the collector does not populate" would be a second
 * authority over the collector's own output: it would keep Advancing muted on
 * the day the backfill lands, and it would say nothing about the next field that
 * goes quiet.
 */
const BLANK = '—'
const isSilent = (m, currentRow, win) =>
  m.getFmt(currentRow) === BLANK && win.every(r => m.getFmt(r) === BLANK)

export default function ScoreboardView({
  currentRow, recentRows = [], metrics, onDrill, onSeek, canSeek,
  signalKey, notableKey, normalize, options = {},
}) {
  const { hostRef, tipRef, show, hide } = useHoverReadout()
  if (!currentRow || !metrics?.length) return null
  const sort = options.sort ?? 'group'
  const compact = options.density === 'compact'
  const win = options.sparkWindow ?? 20
  const ordered = normalize ? sortVisibleMetrics(metrics, sort, normalize, currentRow) : metrics
  const colors = resolveViewColors(options.palette, options.intensity)
  const asc = [...recentRows].slice(0, win).reverse()  // oldest → newest, windowed
  const reachable = asc.map(r => (canSeek ? !!canSeek(r.date) : false))
  const pad = compact ? 7 : 10
  const minW = compact ? 96 : 132
  // A sparkline point is a narrow target; give each one the full slice of the
  // 60-unit track it owns so the pointer does not have to land on the pixel.
  const hitW = asc.length > 1 ? 60 / (asc.length - 1) : 60

  const live = [], silent = []
  for (const m of ordered) (isSilent(m, currentRow, asc) ? silent : live).push(m)

  return (
    <div ref={hostRef}
         style={{ height: '100%', minHeight: 0, padding: '12px 18px', position: 'relative',
                  display: 'flex', flexDirection: 'column' }}>
      <div data-testid="scoreboard-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8, flex: '0 0 auto' }}>
        {`${live.length} reporting · sparkline spans ${asc.length} session${asc.length === 1 ? '' : 's'}`}
        {silent.length ? ` · ${silent.length} not reported in this window` : ''}
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto',
                    display: 'flex', flexDirection: 'column' }}>
        {/* ⭐ `gridAutoRows` IS A FLOOR AND A CEILING. Rows share what is spare
            so a card's sparkline grows into the panel, and stop growing so a
            three-metric board does not draw three billboards. */}
        <div data-testid="scoreboard-grid"
             style={{ flex: '1 1 auto',
                      display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minW}px, 1fr))`,
                      gridAutoRows: `minmax(${compact ? 66 : 84}px, ${compact ? 132 : 168}px)`,
                      alignContent: 'start', gap: 10 }}>
          {live.map(m => {
            const isSignal = m.key === signalKey
            const isNotable = m.key === notableKey
            const clickable = !!m.drillKey
            const sp = buildSpark(asc.map((r, i) => ({ v: metricValue(m, r), i })),
                                  m.polarity, colors.bull, colors.bear)
            return (
              <div key={m.key} {...drillProps(m, onDrill)}
                   className={isNotable ? signalStyles.pulse : undefined}
                   style={{ background: '#0e131a', borderRadius: 8, padding: pad,
                            border: isSignal ? '1px solid #c9a84c' : '1px solid rgba(255,255,255,0.05)',
                            display: 'flex', flexDirection: 'column', minHeight: 0,
                            cursor: clickable ? 'pointer' : 'default' }}>
                <div style={{ font: '700 8px Instrument Sans, sans-serif', letterSpacing: '.5px',
                              textTransform: 'uppercase', color: isSignal ? '#c9a84c' : '#94a3b8',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              flex: '0 0 auto' }}>
                  {isSignal ? <><UIcon name="star-fill" size={8} style={{ verticalAlign: '-1px', marginRight: 3 }} /></> : ''}{m.label}
                </div>
                <div style={{ font: `800 ${compact ? 18 : 24}px Instrument Sans, sans-serif`, color: '#e8e8ea',
                              lineHeight: 1.1, marginTop: 2, fontVariantNumeric: 'tabular-nums',
                              flex: '0 0 auto' }}>
                  {m.getFmt(currentRow)}
                </div>
                {/* `preserveAspectRatio: none` + a non-scaling stroke: the
                    sparkline stretches to whatever height the card was given
                    while the line stays 1.5px, which is what lets the same
                    markup read at a quarter pane and at full width. */}
                <svg width="100%" viewBox="0 0 60 16" preserveAspectRatio="none"
                     style={{ marginTop: 4, flex: '1 1 auto', minHeight: 16 }}
                     onClick={(e) => {
                       const i = markIndex(e)
                       if (i == null) return
                       // The card drills; a point seeks. Without this the click
                       // would do BOTH — open the drill modal on a date the
                       // cursor is in the middle of moving away from.
                       e.stopPropagation()
                       if (reachable[i]) onSeek?.(asc[i].date)
                     }}
                     onMouseOver={(e) => {
                       const i = markIndex(e)
                       if (i == null) { hide(); return }
                       show(e, `${m.key}:${i}`, asc[i].date, [`${m.label} · ${m.getFmt(asc[i])}`])
                     }}
                     onMouseLeave={hide}>
                  {sp
                    ? <polyline points={sp.pts} fill="none" stroke={sp.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                    : <line x1="0" y1="8" x2="60" y2="8" stroke="#334155" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
                  {sp?.marks.map(p => (
                    <rect key={p.i} data-testid={`scoreboard-point-${m.key}-${p.i}`}
                          data-seek-idx={p.i} data-seek-date={asc[p.i].date}
                          x={Math.max(0, p.x - hitW / 2)} y="0" width={hitW} height="16"
                          fill="transparent"
                          style={{ cursor: reachable[p.i] ? 'pointer' : 'default' }}>
                      <title>{`${asc[p.i].date} · ${m.label} ${m.getFmt(asc[p.i])}`}</title>
                    </rect>
                  ))}
                </svg>
              </div>
            )
          })}
        </div>

        {silent.length > 0 && (
          <div data-testid="scoreboard-silent" style={{ flex: '0 0 auto', marginTop: 12 }}>
            <div style={{ font: '700 8px Instrument Sans, sans-serif', letterSpacing: '.7px',
                          textTransform: 'uppercase', color: '#475569', marginBottom: 6 }}>
              Not reported in this window
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {silent.map(m => (
                <span key={m.key} data-testid={`scoreboard-silent-${m.key}`}
                      title={`${m.label} — no reading in the ${asc.length} sessions drawn here`}
                      style={{ font: '600 9px Instrument Sans, sans-serif', letterSpacing: '.4px',
                               textTransform: 'uppercase', color: '#475569',
                               border: '1px dashed rgba(148,163,184,0.22)', borderRadius: 6,
                               padding: '3px 8px', whiteSpace: 'nowrap' }}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <HoverReadout tipRef={tipRef} styleKey="scoreboard" />
    </div>
  )
}
