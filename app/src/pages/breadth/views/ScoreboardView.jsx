/**
 * Scoreboard — a card per metric: big current value + a sparkline of its recent
 * history (color = up/down vs the window start). Signal of the Day card has a
 * gold ★ + border; the notable card pulses.
 */
import { metricValue, sortVisibleMetrics, resolveViewColors } from './breadthViewShared'
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
function buildSpark(entries, polarity, bull = '#34d399', bear = '#f87171') {
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
  const minW = compact ? 96 : 120
  // A sparkline point is a narrow target; give each one the full slice of the
  // 60-unit track it owns so the pointer does not have to land on the pixel.
  const hitW = asc.length > 1 ? 60 / (asc.length - 1) : 60
  return (
    <div ref={hostRef}
         style={{ overflow: 'auto', height: '100%', padding: '14px 18px', position: 'relative' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minW}px, 1fr))`, gap: 10 }}>
        {ordered.map(m => {
          const isSignal = m.key === signalKey
          const isNotable = m.key === notableKey
          const clickable = !!m.drillKey
          const sp = buildSpark(asc.map((r, i) => ({ v: metricValue(m, r), i })),
                                m.polarity, colors.bull, colors.bear)
          return (
            <div key={m.key} onClick={clickable ? () => onDrill(m) : undefined}
                 role={clickable ? 'button' : undefined}
                 aria-label={clickable ? `${m.label} details` : undefined}
                 className={isNotable ? signalStyles.pulse : undefined}
                 style={{ background: '#0e131a', borderRadius: 8, padding: pad,
                          border: isSignal ? '1px solid #c9a84c' : '1px solid rgba(255,255,255,0.05)',
                          cursor: clickable ? 'pointer' : 'default' }}>
              <div style={{ font: '700 8px Instrument Sans, sans-serif', letterSpacing: '.5px',
                            textTransform: 'uppercase', color: isSignal ? '#c9a84c' : '#94a3b8' }}>
                {isSignal ? <><UIcon name="star-fill" size={8} style={{ verticalAlign: '-1px', marginRight: 3 }} /></> : ''}{m.label}
              </div>
              <div style={{ font: `800 ${compact ? 18 : 22}px Instrument Sans, sans-serif`, color: '#e8e8ea',
                            lineHeight: 1.15, marginTop: 2 }}>
                {m.getFmt(currentRow)}
              </div>
              <svg width="100%" height="16" viewBox="0 0 60 16" preserveAspectRatio="none" style={{ marginTop: 2 }}
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
                  : <line x1="0" y1="8" x2="60" y2="8" stroke="#334155" strokeDasharray="2 2" />}
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
      <HoverReadout tipRef={tipRef} styleKey="scoreboard" />
    </div>
  )
}
