/**
 * Heat Ribbon — one row per metric, one cell per session across the loaded
 * window, colored by that session's OWN tier. Answers "when did the regime
 * change?", which no snapshot view can.
 */
import { ALL_METRICS_HIDDEN, metricColor, resolveViewColors } from './breadthViewShared'
import useHoverReadout from './useHoverReadout'
import HoverReadout from './HoverReadout'

/**
 * ⛔ ONE LISTENER PER METRIC ROW, NOT ONE PER CELL.
 *
 * A 16-metric board over a 365-day window is ~5,800 cells; binding click and
 * hover on each is a lot of closures to allocate on every render of a view
 * whose whole job is to be dense. The cell carries its index in a data
 * attribute and the row's handler reads it back — the same delegation the
 * Monitor table uses.
 */
const cellIndex = (e) => {
  const el = e.target?.closest?.('[data-seek-idx]')
  if (!el) return null
  const i = Number(el.getAttribute('data-seek-idx'))
  return Number.isInteger(i) ? i : null
}

export default function HeatRibbonView({
  rows = [], rowIdx = 0, metrics = [], onDrill, onSeek, canSeek, options = {},
}) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const compact = options.density === 'compact'
  const { hostRef, tipRef, show, hide } = useHoverReadout()
  // rows are newest-first from the cursor; display oldest → newest (left → right).
  // `win`, not `window`: a local named `window` shadows the global for the whole
  // function body.
  const win = rows.slice(rowIdx).reverse()
  if (!win.length) return null

  // 🔴 UNCHECK EVERY METRIC IN CUSTOMIZE AND THIS RENDERED `null` — a blank
  // panel, no message, indistinguishable from a view that crashed. The Monitor
  // tab has always explained this state; say the same thing here.
  if (!metrics.length) {
    return (
      <div data-testid="ribbon-refusal"
           style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        {ALL_METRICS_HIDDEN}
      </div>
    )
  }

  const basis = `${win.length} sessions · since ${win[0].date}`
  const cellH = compact ? 10 : 16
  // Asked once per session, not once per cell: the answer depends on the date,
  // and every metric row draws the same dates.
  const reachable = win.map(r => (canSeek ? !!canSeek(r.date) : false))

  return (
    <div ref={hostRef}
         style={{ overflow: 'auto', height: '100%', padding: '12px 18px', position: 'relative' }}>
      <div data-testid="ribbon-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8 }}>
        {basis}
      </div>
      {metrics.map(m => (
        <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <div style={{ width: 104, flex: '0 0 104px', textAlign: 'right',
                        font: '700 9px \'Instrument Sans\', sans-serif', letterSpacing: '.4px',
                        textTransform: 'uppercase', color: '#94a3b8',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        cursor: m.drillKey ? 'pointer' : 'default' }}
               role={m.drillKey ? 'button' : undefined}
               aria-label={m.drillKey ? `${m.label} details` : undefined}
               onClick={m.drillKey ? () => onDrill(m) : undefined}>
            {m.label}
          </div>
          <div style={{ display: 'grid', gap: 1, flex: 1,
                        gridTemplateColumns: `repeat(${win.length}, minmax(0, 1fr))` }}
               onClick={(e) => {
                 const i = cellIndex(e)
                 if (i == null || !reachable[i]) return
                 onSeek?.(win[i].date)
               }}
               onMouseOver={(e) => {
                 const i = cellIndex(e)
                 if (i == null) { hide(); return }
                 const row = win[i]
                 show(e, `${m.key}:${i}`, row.date, [`${m.label} · ${m.getFmt(row)}`])
               }}
               onMouseLeave={hide}>
            {win.map((row, i) => (
              <div key={row.date ?? i} data-testid={`ribbon-cell-${m.key}-${i}`}
                   data-seek-idx={i} data-seek-date={row.date}
                   title={`${row.date} · ${m.label} ${m.getFmt(row)}`}
                   style={{ height: cellH, borderRadius: 1,
                            cursor: reachable[i] ? 'pointer' : 'default',
                            opacity: colors.fillOpacity,
                            background: metricColor(m, row, colors.tier) }} />
            ))}
          </div>
        </div>
      ))}
      <HoverReadout tipRef={tipRef} styleKey="ribbon" />
    </div>
  )
}
