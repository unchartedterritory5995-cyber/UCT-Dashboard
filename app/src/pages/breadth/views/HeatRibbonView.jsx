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

// The label gutter every row shares, so the playhead can be positioned over the
// strip without measuring the DOM. ONE declaration, read by the rows and by the
// playhead — two copies would drift by a pixel and the line would sit off the
// column it names.
const LABEL_W = 104
const LABEL_GAP = 8
const STRIP_LEFT = LABEL_W + LABEL_GAP

// How far a not-yet-current session is pushed back. Deliberately a MULTIPLIER on
// the intensity option's own opacity rather than a second opacity scale, so
// "subtle" stays subtler than "normal" on both sides of the playhead.
const AHEAD_DIM = 0.26

export default function HeatRibbonView({
  rows = [], rowIdx = 0, metrics = [], onDrill, onSeek, canSeek, options = {},
}) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const compact = options.density === 'compact'
  const { hostRef, tipRef, show, hide } = useHoverReadout()

  /**
   * 🔴 THIS USED TO BE `rows.slice(rowIdx)`, AND SCRUBBING BACK MADE THE RIBBON
   * SHORTER.
   *
   * Every other view answers "what did the board look like as of the cursor?",
   * and slicing is the right answer for all of them. This one is a STRIP OF
   * TIME: its whole claim is "here is the window, and here is where the regime
   * turned". Truncating it at the cursor meant playback ran the chart backwards
   * — press play at session 200 and you watched the strip GROW, which reads as
   * data arriving rather than as a cursor moving.
   *
   * So the ribbon holds the whole loaded window and the cursor becomes a
   * PLAYHEAD that sweeps across it. Sessions ahead of the playhead are still
   * drawn, in their own tier colours, pushed back to `AHEAD_DIM` — the tier
   * colours already mean something and inventing a second colour for "not yet"
   * would put two languages on one strip. They stay clickable, because they ARE
   * reachable: the cursor can move forward as well as back.
   *
   * `win`, not `window`: a local named `window` shadows the global for the whole
   * function body.
   */
  const win = [...rows].reverse()   // oldest → newest, left → right
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

  // `rows` is newest-first, so the cursor's column counted from the left is the
  // mirror of `rowIdx`. Clamped because a caller may hand a cursor past the end
  // of a window that shrank under it.
  const head = Math.min(win.length - 1, Math.max(0, win.length - 1 - rowIdx))
  const headRow = win[head]

  // ⭐ THE BASIS NOW DESCRIBES THE STRIP, NOT THE SLICE. It states the whole
  // window — which is what is drawn — and then where the playhead sits inside
  // it, so the reader is never left inferring which of the cells count as "now".
  const basis = `${win.length} sessions · since ${win[0].date}`
    + ` · playhead ${headRow?.date ?? '—'} (${head + 1} of ${win.length})`
  const cellH = compact ? 10 : 16
  // Asked once per session, not once per cell: the answer depends on the date,
  // and every metric row draws the same dates.
  const reachable = win.map(r => (canSeek ? !!canSeek(r.date) : false))
  const opacityAt = (i) => colors.fillOpacity * (i > head ? AHEAD_DIM : 1)

  return (
    <div ref={hostRef}
         style={{ overflow: 'auto', height: '100%', padding: '12px 18px', position: 'relative' }}>
      <div data-testid="ribbon-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8 }}>
        {basis}
      </div>
      <div style={{ position: 'relative' }}>
        {metrics.map(m => (
          <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: LABEL_GAP, marginBottom: 3 }}>
            <div style={{ width: LABEL_W, flex: `0 0 ${LABEL_W}px`, textAlign: 'right',
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
                     data-ahead={i > head ? 'true' : undefined}
                     title={`${row.date} · ${m.label} ${m.getFmt(row)}`}
                     style={{ height: cellH, borderRadius: 1,
                              cursor: reachable[i] ? 'pointer' : 'default',
                              opacity: opacityAt(i),
                              background: metricColor(m, row, colors.tier) }} />
              ))}
            </div>
          </div>
        ))}

        {/* ⭐ THE PLAYHEAD IS CHROME, NOT A TIER. It is the scrubber's cursor
            drawn on the strip, so it must be legible over every tier colour in
            every palette — a neutral hairline with a dark halo reads on the
            palest mint and the near-black crimson alike, and it borrows nothing
            from the language the cells are speaking. Positioned off the SAME
            gutter constants the rows lay out with, so it cannot drift off the
            column it marks. */}
        <div data-testid="ribbon-playhead" data-playhead-date={headRow?.date}
             aria-hidden="true"
             style={{ position: 'absolute', top: -2, bottom: 1, width: 1, pointerEvents: 'none',
                      left: `calc(${STRIP_LEFT}px + (100% - ${STRIP_LEFT}px) * ${(head + 0.5) / win.length})`,
                      background: 'rgba(226,232,240,0.92)',
                      boxShadow: '0 0 0 1px rgba(2,6,12,0.65)' }} />
      </div>
      <HoverReadout tipRef={tipRef} styleKey="ribbon" />
    </div>
  )
}
