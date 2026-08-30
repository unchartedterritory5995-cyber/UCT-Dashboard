/**
 * Timeline (Time Heatmap) — rows = metrics, columns = recent trading days,
 * cell color = the bright tier color. The one style that shows the time
 * dimension. Signal of the Day row label is gold ★; notable pulses.
 */
import { Fragment } from 'react'
import { metricColor, resolveViewColors } from './breadthViewShared'
import useHoverReadout from './useHoverReadout'
import HoverReadout from './HoverReadout'
import UIcon from '../../../components/ui/UIcon'
import signalStyles from './signals.module.css'

// One delegated listener for the whole grid — every cell names the metric and
// the column it belongs to, so the handler needs no per-cell closure.
const cellOf = (e) => {
  const el = e.target?.closest?.('[data-seek-idx]')
  if (!el) return null
  const i = Number(el.getAttribute('data-seek-idx'))
  return Number.isInteger(i) ? { i, mkey: el.getAttribute('data-mkey') } : null
}

export default function TimelineView({
  recentRows = [], metrics, onDrill, onSeek, canSeek, signalKey, notableKey, options = {},
}) {
  const { hostRef, tipRef, show, hide } = useHoverReadout()
  if (!metrics?.length || !recentRows.length) return null
  const win = options.windowDays ?? 20
  const days = [...recentRows].slice(0, win).reverse()  // oldest → newest, up to `win`
  const colors = resolveViewColors(options.palette, options.intensity)
  const cols = days.length
  const byKey = Object.fromEntries(metrics.map(m => [m.key, m]))
  const reachable = days.map(r => (canSeek ? !!canSeek(r.date) : false))
  return (
    <div ref={hostRef}
         style={{ overflow: 'auto', height: '100%', padding: '12px 18px', position: 'relative' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `92px repeat(${cols}, 1fr)`, gap: 2, minWidth: 320 }}
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
              <div onClick={clickable ? () => onDrill(m) : undefined}
                   role={clickable ? 'button' : undefined}
                   aria-label={clickable ? `${m.label} details` : undefined}
                   className={isNotable ? signalStyles.pulse : undefined}
                   style={{ font: '700 9px Instrument Sans, sans-serif', textTransform: 'uppercase',
                            letterSpacing: '.3px', color: isSignal ? '#c9a84c' : '#94a3b8',
                            display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
                            cursor: clickable ? 'pointer' : 'default' }}>
                {isSignal ? <><UIcon name="star-fill" size={9} style={{ verticalAlign: '-1px', marginRight: 3 }} /></> : ''}{m.label}
              </div>
              {days.map((row, i) => (
                <div key={i} data-testid={`cell-${m.key}-${i}`}
                     data-seek-idx={i} data-seek-date={row.date} data-mkey={m.key}
                     title={`${m.label} · ${row.date}: ${m.getFmt(row)}`}
                     style={{ height: 16, borderRadius: 2, cursor: reachable[i] ? 'pointer' : 'default',
                              background: metricColor(m, row, colors.tier), opacity: colors.fillOpacity }} />
              ))}
            </Fragment>
          )
        })}
      </div>
      <div style={{ font: '600 9px Instrument Sans, sans-serif', color: '#64748b', marginTop: 6, textAlign: 'right' }}>
        ← older · newer →
      </div>
      <HoverReadout tipRef={tipRef} styleKey="timeline" />
    </div>
  )
}
