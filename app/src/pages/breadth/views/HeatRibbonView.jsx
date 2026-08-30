/**
 * Heat Ribbon — one row per metric, one cell per session across the loaded
 * window, colored by that session's OWN tier. Answers "when did the regime
 * change?", which no snapshot view can.
 */
import { ALL_METRICS_HIDDEN, drillProps, fillsRow, metricColor, resolveViewColors } from './breadthViewShared'
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

/**
 * 🔴 THE BAND HEIGHT IS A FLOOR AND A CEILING, NOT A HEIGHT.
 *
 * This view is `height: 100%` of the box `BreadthViews` hands it, and it always
 * was — but every band inside it was a fixed `cellH` px, so the ink stopped at
 * ten times sixteen pixels and left ~400px of the offered height black. The
 * parent was never the problem: the height was offered and the content declined
 * it. Nothing that scrubs under a playhead should be 13px tall.
 *
 * So the rows FLEX. `RIBBON_MIN_H` is what a band shrinks to in a quarter-size
 * compare pane before the strip scrolls instead; `RIBBON_MAX_H` stops a
 * two-metric board from drawing two 200px slabs, which is the opposite mistake.
 * `density: compact` moves both, so the option still means what it says.
 */
const RIBBON_MIN_H = { compact: 10, normal: 16 }
const RIBBON_MAX_H = { compact: 28, normal: 52 }
// The space between two bands. ONE declaration, read by the `gap` that draws it
// and by the strip's own ceiling below — two copies would put the playhead's
// foot a few pixels off the last row it marks.
const ROW_GAP = 3

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
  const density = compact ? 'compact' : 'normal'
  const minH = RIBBON_MIN_H[density]
  const maxH = RIBBON_MAX_H[density]
  // Asked once per session, not once per cell: the answer depends on the date,
  // and every metric row draws the same dates.
  const reachable = win.map(r => (canSeek ? !!canSeek(r.date) : false))
  const opacityAt = (i) => colors.fillOpacity * (i > head ? AHEAD_DIM : 1)

  return (
    <div ref={hostRef}
         style={{ height: '100%', minHeight: 0, padding: '12px 18px', position: 'relative',
                  display: 'flex', flexDirection: 'column' }}>
      <div data-testid="ribbon-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    letterSpacing: '.4px', marginBottom: 8, flex: '0 0 auto' }}>
        {basis}
      </div>
      {/* ⭐ TWO BOXES, NOT ONE, AND THE SPLIT IS LOAD-BEARING. The outer one
          scrolls (a 30-metric board in a quarter-size pane still has to be
          reachable); the inner one is what the playhead is positioned against.
          Collapsing them would anchor the playhead to the scroll VIEWPORT, so
          it would slide off the rows it marks the moment the strip scrolled. */}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto',
                    display: 'flex', flexDirection: 'column' }}>
      {/* 🔴 THE STRIP HAS A CEILING, AND THE PLAYHEAD IS WHY.
          Bands stop growing at `RIBBON_MAX_H`, but this box did not: on a tall
          panel with few metrics it kept every leftover pixel, and the playhead
          — `top: 0; bottom: 0` of this box — ran ~90px past the last band into
          empty black. The line marks WHICH SESSION, and it was drawing that
          claim over rows that do not exist.
          ⛔ It is DERIVED from the same two constants the bands lay out with,
          never a second number: the tallest the strip can legitimately be is
          every band at its ceiling plus the gaps between them. When the room is
          smaller the cap is inert and the bands share what there is, so nothing
          about a quarter-size pane changes. */}
      <div style={{ position: 'relative', flex: '1 1 auto',
                    maxHeight: metrics.length * maxH + Math.max(0, metrics.length - 1) * ROW_GAP,
                    display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
        {metrics.map(m => (
          <div key={m.key} style={{ display: 'flex', alignItems: 'stretch', gap: LABEL_GAP,
                                    ...fillsRow(minH, maxH) }}>
            <div style={{ width: LABEL_W, flex: `0 0 ${LABEL_W}px`, textAlign: 'right',
                          font: '700 9px \'Instrument Sans\', sans-serif', letterSpacing: '.4px',
                          textTransform: 'uppercase', color: '#94a3b8',
                          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          cursor: m.drillKey ? 'pointer' : 'default' }}
                 {...drillProps(m, onDrill)}>
              {m.label}
            </div>
            <div style={{ display: 'grid', gap: 1, flex: 1, height: '100%',
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
                     style={{ height: '100%', borderRadius: 1,
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
             style={{ position: 'absolute', top: 0, bottom: 0, width: 1, pointerEvents: 'none',
                      left: `calc(${STRIP_LEFT}px + (100% - ${STRIP_LEFT}px) * ${(head + 0.5) / win.length})`,
                      background: 'rgba(226,232,240,0.92)',
                      boxShadow: '0 0 0 1px rgba(2,6,12,0.65)' }} />
      </div>
      </div>
      <HoverReadout tipRef={tipRef} styleKey="ribbon" />
    </div>
  )
}
